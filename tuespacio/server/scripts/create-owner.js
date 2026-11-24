// Alta de un dueño de parqueadero por el EQUIPO COMERCIAL (los dueños no se registran desde la app).
// Crea la cuenta con una contraseña temporal aleatoria (se muestra UNA vez y debe cambiarse al entrar)
// y, opcionalmente, su parqueadero en pausa para completar cupos, tarifas y horario desde el panel.
//
//   npm run owner:create -- --email dueno@empresa.test --name "Nombre Apellido" --plan Básico \
//        [--space-name "Parqueadero X" --address "Cl. 1 #2-3" --destination d-emp --car 20 --moto 5]
import { parseArgs } from 'node:util';
import pg from 'pg';
import { hashPassword, randomCode } from '../src/lib/crypto.js';
import { newId } from '../src/lib/ids.js';
import { isValidEmail, normalizeEmail } from '../../app/src/domain/validation.js';

const { values: a } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    plan: { type: 'string', default: 'Básico' },
    'space-name': { type: 'string' },
    address: { type: 'string' },
    destination: { type: 'string' },
    car: { type: 'string', default: '0' },
    moto: { type: 'string', default: '0' },
  },
});

if (!a.email || !isValidEmail(a.email) || !a.name || !['Básico', 'Destacado'].includes(a.plan)) {
  console.error('Uso: --email <correo> --name "<nombre>" [--plan Básico|Destacado] [--space-name … --address … --destination … --car N --moto N]');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const temp = `${randomCode(4)}-${randomCode(4)}-${randomCode(2)}7`;
try {
  await client.query('BEGIN');
  const id = newId('usr');
  await client.query(
    `INSERT INTO users (id, role, name, email, password_hash, plan, must_change_password) VALUES ($1, 'owner', $2, $3, $4, $5, true)`,
    [id, a.name.trim(), normalizeEmail(a.email), await hashPassword(temp), a.plan]
  );
  if (a['space-name']) {
    const d = (await client.query('SELECT * FROM destinations WHERE id = $1', [a.destination])).rows[0];
    if (!d) throw new Error('Destino no encontrado (--destination)');
    const sid = newId('spc');
    await client.query(
      `INSERT INTO spaces (id, kind, manager_id, destination_id, name, address, plan, lat, lng, public_lat, public_lng, timezone, status)
       VALUES ($1, 'formal', $2, $3, $4, $5, $6, $7, $8, $7, $8, $9, 'paused')`,
      [sid, id, d.id, a['space-name'], a.address || 'Dirección por completar', a.plan, d.lat, d.lng, d.timezone]
    );
    for (const v of ['car', 'moto']) await client.query('INSERT INTO space_inventory (space_id, vehicle_type, capacity) VALUES ($1, $2, $3)', [sid, v, Number(a[v]) || 0]);
    console.log(`Parqueadero creado en pausa: ${sid}`);
  }
  await client.query(`INSERT INTO audit_log (actor_role, action, entity_type, entity_id, data) VALUES ('commercial', 'owner.created', 'user', $1, '{}')`, [id]);
  await client.query('COMMIT');
  console.log(`Dueño creado: ${normalizeEmail(a.email)}\nContraseña temporal (entrégala por un canal seguro; no se vuelve a mostrar): ${temp}`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('No se pudo crear el dueño:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
