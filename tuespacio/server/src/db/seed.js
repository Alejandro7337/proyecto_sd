// Datos FICTICIOS de demostración (mismos espacios que el modo mock de la app). Nombres, direcciones,
// cupos y tarifas son inventados; los correos usan el dominio reservado .test; no hay datos reales.
//   npm run seed        → carga la demo si la base está vacía (idempotente)
//   npm run reset-demo  → BORRA todos los datos operativos y vuelve a cargar la demo
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword } from '../lib/crypto.js';
import { newId, newReservationCode } from '../lib/ids.js';
import { TEST_PAYMENT_METHODS, estimateCost } from '../../../app/src/domain/rules.js';
import { normalizeWeekly, weeklyToList } from '../../../app/src/domain/schedule.js';

export const DEMO_PASSWORD = 'demo123';
export const DEMO_ACCOUNTS = [
  { email: 'conductor@demo.test', role: 'driver' },
  { email: 'parqueadero@demo.test', role: 'owner' },
  { email: 'anfitrion@demo.test', role: 'host' },
];

const DATA_TABLES = [
  'saga_steps', 'sagas', 'idempotency_keys', 'payment_events', 'payments', 'ledger_entries', 'holds', 'reservations',
  'sim_gateway_operations', 'space_metrics_daily', 'space_schedules', 'space_rates', 'space_inventory', 'spaces',
  'destinations', 'payment_methods', 'vehicles', 'outbox_messages', 'password_resets', 'sessions', 'audit_log',
  'change_log', 'rate_limits', 'users',
];

const DESTINATIONS = [
  { id: 'd-emp', name: 'Zona Empresarial · Calle 72', hint: 'Centros empresariales y oficinas', lat: 4.6584, lng: -74.056 },
  { id: 'd-uni', name: 'Zona Universitaria · Centro', hint: 'Universidades y sedes académicas', lat: 4.601, lng: -74.07 },
  { id: 'd-cli', name: 'Zona de Clínicas · Norte', hint: 'Clínicas y consultorios médicos', lat: 4.703, lng: -74.045 },
];

const minute = (price) => ({ unit: 'minute', price });
const hour = (price) => ({ unit: 'hour', price });
const sched = (open, close, days) => weeklyToList(normalizeWeekly({ open, close, days }));

// pos: posición relativa al destino (±1 ≈ 800 m), como en el mapa ilustrativo.
const SPACES = [
  { id: 's-emp-1', d: 'd-emp', kind: 'formal', owner: 'owner', plan: 'Destacado', name: 'Parqueadero Torre 72', address: 'Cra. 9 #72-15 (ficticia)', pos: [0.25, -0.2], rates: { car: minute(138), moto: minute(95) }, cap: { car: 40, moto: 12 }, walk: { car: 30, moto: 7 }, sched: sched('06:00', '22:00', 'Lun – Sáb'), cond: [true, false, 2.1] },
  { id: 's-emp-2', d: 'd-emp', kind: 'formal', owner: 'x1', plan: 'Básico', name: 'Parqueadero La Esquina 70', address: 'Cl. 70 #10-08 (ficticia)', pos: [-0.55, 0.35], rates: { car: hour(7500), moto: hour(3500) }, cap: { car: 25, moto: 20 }, walk: { car: 25, moto: 11 }, sched: sched('00:00', '23:59', 'Todos los días'), cond: [false, true, null] },
  { id: 's-emp-3', d: 'd-emp', kind: 'formal', owner: 'x2', plan: 'Básico', name: 'Edificio Ágora · Sótano', address: 'Cl. 73 #8-40 (ficticia)', pos: [0.6, 0.45], rates: { car: minute(150), moto: null }, cap: { car: 60, moto: 0 }, walk: { car: 41, moto: 0 }, sched: sched('05:30', '23:00', 'Todos los días'), cond: [true, false, 1.9] },
  { id: 's-emp-4', d: 'd-emp', kind: 'particular', host: 'host', hostType: 'Garaje', name: 'Garaje cubierto Cra. 11', address: 'Cra. 11 #71-20 (ficticia)', pos: [-0.3, -0.5], rates: { car: hour(5000), moto: null }, cap: { car: 1, moto: 0 }, walk: { car: 0, moto: 0 }, sched: sched('07:00', '19:00', 'Lun – Vie'), cond: [true, false, 2.0] },
  { id: 's-emp-5', d: 'd-emp', kind: 'particular', host: 'host2', hostType: 'Antejardín', name: 'Antejardín para motos', address: 'Cl. 74 #12-31 (ficticia)', pos: [-0.7, -0.1], rates: { car: null, moto: hour(2000) }, cap: { car: 0, moto: 3 }, walk: { car: 0, moto: 1 }, sched: sched('06:00', '20:00', 'Lun – Sáb'), cond: [false, false, null] },
  { id: 's-uni-1', d: 'd-uni', kind: 'formal', owner: 'x3', plan: 'Básico', name: 'Parqueadero Plaza Universitaria', address: 'Cl. 21 #5-12 (ficticia)', pos: [0.2, 0.3], rates: { car: minute(120), moto: minute(80) }, cap: { car: 80, moto: 40 }, walk: { car: 62, moto: 37 }, sched: sched('06:00', '21:00', 'Lun – Sáb'), cond: [false, false, null] },
  { id: 's-uni-2', d: 'd-uni', kind: 'formal', owner: 'x4', plan: 'Destacado', name: 'Parking Centro Histórico', address: 'Cra. 4 #18-50 (ficticia)', pos: [-0.45, -0.35], rates: { car: hour(6800), moto: hour(3000) }, cap: { car: 30, moto: 10 }, walk: { car: 18, moto: 10 }, sched: sched('06:30', '20:00', 'Lun – Vie'), cond: [true, true, 2.0] },
  { id: 's-uni-3', d: 'd-uni', kind: 'particular', host: 'host', hostType: 'Lote', name: 'Lote esquina Calle 20', address: 'Cl. 20 #3-15 (ficticia)', pos: [0.65, -0.4], rates: { car: hour(4500), moto: hour(2000) }, cap: { car: 4, moto: 4 }, walk: { car: 1, moto: 0 }, sched: sched('06:00', '19:00', 'Lun – Sáb'), cond: [false, false, null] },
  { id: 's-uni-4', d: 'd-uni', kind: 'formal', owner: 'x5', plan: 'Básico', name: 'Parqueadero El Rosario', address: 'Cl. 23 #6-30 (ficticia)', pos: [-0.2, 0.6], rates: { car: minute(130), moto: minute(85) }, cap: { car: 45, moto: 15 }, walk: { car: 44, moto: 3 }, sched: sched('06:00', '22:00', 'Lun – Sáb'), cond: [true, false, 2.05] },
  { id: 's-cli-1', d: 'd-cli', kind: 'formal', owner: 'x6', plan: 'Destacado', name: 'Parqueadero Salud 127', address: 'Cl. 127 #19-40 (ficticia)', pos: [0.15, -0.3], rates: { car: minute(145), moto: minute(90) }, cap: { car: 70, moto: 20 }, walk: { car: 55, moto: 12 }, sched: sched('00:00', '23:59', 'Todos los días'), cond: [true, false, 2.2] },
  { id: 's-cli-2', d: 'd-cli', kind: 'formal', owner: 'x7', plan: 'Básico', name: 'Autoparking Calle 134', address: 'Cl. 134 #17-22 (ficticia)', pos: [-0.5, 0.4], rates: { car: hour(8000), moto: hour(4000) }, cap: { car: 35, moto: 8 }, walk: { car: 20, moto: 2 }, sched: sched('06:00', '22:00', 'Todos los días'), cond: [false, true, null] },
  { id: 's-cli-3', d: 'd-cli', kind: 'particular', host: 'host3', hostType: 'Garaje', name: 'Garaje familiar Cedritos', address: 'Cra. 15 #140-12 (ficticia)', pos: [0.55, 0.35], rates: { car: hour(5500), moto: null }, cap: { car: 1, moto: 0 }, walk: { car: 0, moto: 0 }, sched: sched('06:00', '20:00', 'Lun – Sáb'), cond: [true, false, 2.0] },
  { id: 's-cli-4', d: 'd-cli', kind: 'particular', host: 'host3', hostType: 'Garaje', name: 'Garaje doble Calle 128', address: 'Cl. 128 #20-05 (ficticia)', pos: [-0.35, -0.55], rates: { car: hour(6000), moto: hour(2500) }, cap: { car: 2, moto: 1 }, walk: { car: 0, moto: 0 }, sched: sched('07:00', '21:00', 'Todos los días'), cond: [true, true, 1.95] },
];

// Reservas de ejemplo: [espacio, conductor, vehículo, inicio relativo (min), duración, estado]
const RESERVATIONS = [
  ['s-emp-1', 'diana', 'car', 40, 120, 'confirmed'],
  ['s-emp-1', 'sergio', 'car', -50, 180, 'active'],
  ['s-emp-1', 'paola', 'moto', -240, 60, 'completed'],
  ['s-emp-1', 'julian', 'car', -120, 60, 'cancelled'],
  ['s-uni-1', 'driver', 'car', -2 * 24 * 60, 120, 'completed'],
  ['s-emp-4', 'diana', 'car', -3 * 24 * 60, 240, 'completed'],
  ['s-uni-3', 'felipe', 'car', -24 * 60, 120, 'completed'],
  ['s-uni-3', 'camila', 'moto', 180, 120, 'confirmed'],
];

const USERS = {
  driver: { role: 'driver', name: 'Laura Gómez', email: 'conductor@demo.test', vehicle: 'car', login: true },
  owner: { role: 'owner', name: 'Carlos Pérez', email: 'parqueadero@demo.test', plan: 'Destacado', login: true },
  host: { role: 'host', name: 'Marta Rincón', email: 'anfitrion@demo.test', identity: 'in_review', login: true },
  host2: { role: 'host', name: 'Jorge Medina', email: 'jorge@demo.test', identity: 'in_review', login: true },
  host3: { role: 'host', name: 'Andrés Pardo', email: 'andres@demo.test', identity: 'verified', login: true },
  x1: { role: 'owner', name: 'Operador Esquina', email: 'operador1@demo.test', plan: 'Básico' },
  x2: { role: 'owner', name: 'Operador Ágora', email: 'operador2@demo.test', plan: 'Básico' },
  x3: { role: 'owner', name: 'Operador Plaza', email: 'operador3@demo.test', plan: 'Básico' },
  x4: { role: 'owner', name: 'Operador Centro', email: 'operador4@demo.test', plan: 'Destacado' },
  x5: { role: 'owner', name: 'Operador Rosario', email: 'operador5@demo.test', plan: 'Básico' },
  x6: { role: 'owner', name: 'Operador Salud', email: 'operador6@demo.test', plan: 'Destacado' },
  x7: { role: 'owner', name: 'Operador 134', email: 'operador7@demo.test', plan: 'Básico' },
  diana: { role: 'driver', name: 'Diana Ramírez', email: 'diana@demo.test', vehicle: 'car' },
  sergio: { role: 'driver', name: 'Sergio López', email: 'sergio@demo.test', vehicle: 'car' },
  paola: { role: 'driver', name: 'Paola Martínez', email: 'paola@demo.test', vehicle: 'moto' },
  julian: { role: 'driver', name: 'Julián Torres', email: 'julian@demo.test', vehicle: 'car' },
  felipe: { role: 'driver', name: 'Felipe Castro', email: 'felipe@demo.test', vehicle: 'car' },
  camila: { role: 'driver', name: 'Camila Suárez', email: 'camila@demo.test', vehicle: 'moto' },
};

const VIEWS_7D = [48, 55, 61, 52, 70, 66, 23];

export async function seedDemo(client, { reset = false } = {}) {
  if (reset) await client.query(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  else if ((await client.query('SELECT 1 FROM users LIMIT 1')).rowCount) return { skipped: true };

  const demoHash = await hashPassword(DEMO_PASSWORD);
  // Cuentas sin acceso (operadores y conductores de ejemplo): contraseña aleatoria que nadie conoce.
  const lockedHash = await hashPassword(newId('locked'));
  const ids = {};
  for (const [key, u] of Object.entries(USERS)) {
    ids[key] = key === 'driver' ? 'u-driver' : key === 'owner' ? 'u-owner' : key === 'host' ? 'u-host' : `u-${key}`;
    await client.query(`INSERT INTO users (id, role, name, email, password_hash, plan, identity_status) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      ids[key],
      u.role,
      u.name,
      u.email,
      u.login ? demoHash : lockedHash,
      u.plan || null,
      u.role === 'host' ? u.identity || 'pending' : null,
    ]);
    if (u.role === 'driver') {
      await client.query(`INSERT INTO vehicles (id, user_id, type, label, height_m, is_default) VALUES ($1, $2, $3, $4, $5, true)`, [
        `v-${key}`,
        ids[key],
        u.vehicle,
        u.vehicle === 'moto' ? 'Mi moto' : 'Mi carro',
        u.vehicle === 'car' ? 1.55 : null,
      ]);
      for (const [i, m] of TEST_PAYMENT_METHODS.entries()) {
        await client.query(`INSERT INTO payment_methods (id, user_id, brand, last4, label, test_behavior, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
          `pm-${key}-${m.last4}`,
          ids[key],
          m.brand,
          m.last4,
          m.label,
          m.behavior,
          i === 0,
        ]);
      }
    }
  }
  // La conductora demo también tiene una moto registrada.
  await client.query(`INSERT INTO vehicles (id, user_id, type, label, is_default) VALUES ('v-driver-moto', 'u-driver', 'moto', 'Moto de reparto', false)`);

  for (const d of DESTINATIONS) {
    const search = `${d.name} ${d.hint}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    await client.query(`INSERT INTO destinations (id, name, hint, city, lat, lng, timezone, search) VALUES ($1, $2, $3, 'Ciudad piloto', $4, $5, 'America/Bogota', $6)`, [d.id, d.name, d.hint, d.lat, d.lng, search]);
  }

  for (const s of SPACES) {
    const d = DESTINATIONS.find((x) => x.id === s.d);
    const lat = d.lat - (s.pos[1] * 800) / 110540;
    const lng = d.lng + (s.pos[0] * 800) / (111320 * Math.cos((d.lat * Math.PI) / 180));
    const fuzz = s.kind === 'particular' ? 0.0007 : 0;
    await client.query(
      `INSERT INTO spaces (id, kind, manager_id, destination_id, name, address, host_type, plan, lat, lng, public_lat, public_lng, covered, keys_required, max_height_m, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now() - interval '90 days')`,
      [s.id, s.kind, ids[s.owner || s.host], s.d, s.name, s.address, s.hostType || null, s.plan || null, lat, lng, lat + fuzz, lng - fuzz, s.cond[0], s.cond[1], s.cond[2]]
    );
    for (const v of ['car', 'moto']) {
      await client.query(`INSERT INTO space_inventory (space_id, vehicle_type, capacity, walk_in_occupied) VALUES ($1, $2, $3, $4)`, [s.id, v, s.cap[v], s.walk[v]]);
      if (s.rates[v]) await client.query(`INSERT INTO space_rates (space_id, vehicle_type, unit, price_cop, effective_from) VALUES ($1, $2, $3, $4, now() - interval '90 days')`, [s.id, v, s.rates[v].unit, s.rates[v].price]);
    }
    for (const day of s.sched) await client.query(`INSERT INTO space_schedules (space_id, weekday, open_time, close_time) VALUES ($1, $2, $3, $4)`, [s.id, day.weekday, day.open, day.close]);
  }

  for (let i = 0; i < VIEWS_7D.length; i += 1) {
    await client.query(`INSERT INTO space_metrics_daily (space_id, day, views) VALUES ('s-emp-1', (now() AT TIME ZONE 'America/Bogota')::date - $1::int, $2)`, [6 - i, VIEWS_7D[i]]);
  }

  for (const [n, [spaceId, who, vehicle, offset, duration, status]] of RESERVATIONS.entries()) {
    const s = SPACES.find((x) => x.id === spaceId);
    const rid = `r-${1001 + n}`;
    const amount = estimateCost(s.rates[vehicle], duration);
    const start = new Date(Date.now() + offset * 60000);
    const end = new Date(start.getTime() + duration * 60000);
    const commissionCop = s.kind === 'formal' ? 0 : null;
    await client.query(
      `INSERT INTO reservations (id, code, space_id, driver_id, vehicle_id, vehicle_type, period, status, rate_unit, rate_price_cop, amount_cop,
                                 commission_rate, commission_cop, payment_method_id, idempotency_key, created_at, confirmed_at, check_in_at, check_out_at, cancelled_at, cancelled_by, refund_cop)
       VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7, $8, '[)'), $9, $10, $11, $12, $13, $14, $15, $16, $17::timestamptz - interval '90 minutes', $17::timestamptz - interval '90 minutes',
               $18, $19, $20, $21, $22)`,
      [
        rid,
        newReservationCode(),
        spaceId,
        ids[who],
        `v-${who}`,
        vehicle,
        start.toISOString(),
        end.toISOString(),
        status,
        s.rates[vehicle].unit,
        s.rates[vehicle].price,
        amount,
        s.kind === 'formal' ? 0 : null,
        commissionCop,
        `pm-${who}-4242`,
        `seed-${rid}`,
        start.toISOString(),
        status === 'active' || status === 'completed' ? start.toISOString() : null,
        status === 'completed' ? end.toISOString() : null,
        status === 'cancelled' ? new Date(start.getTime() - 30 * 60000).toISOString() : null,
        status === 'cancelled' ? ids[who] : null,
        status === 'cancelled' ? amount : null,
      ]
    );
    const refunded = status === 'cancelled' ? amount : 0;
    await client.query(
      `INSERT INTO payments (id, reservation_id, provider, provider_ref, method_id, amount_cop, captured_cop, refunded_cop, status, idempotency_key)
       VALUES ($1, $2, 'simulated', $3, $4, $5, $5, $6, $7, $8)`,
      [`pay-${rid}`, rid, `sim_seed_${rid}`, `pm-${who}-4242`, amount, refunded, refunded ? 'refunded' : 'captured', `seed:${rid}`]
    );
    await client.query(`INSERT INTO ledger_entries (reservation_id, entry_type, account, amount_cop) VALUES ($1, 'fare', 'manager', $2)`, [rid, amount]);
    if (refunded) await client.query(`INSERT INTO ledger_entries (reservation_id, entry_type, account, amount_cop) VALUES ($1, 'refund', 'manager', $2)`, [rid, -refunded]);
  }
  return { skipped: false, users: Object.keys(USERS).length, spaces: SPACES.length, reservations: RESERVATIONS.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reset = process.argv.includes('--reset');
  if (reset && process.env.NODE_ENV === 'production' && process.env.DEMO_TOOLS !== 'true') {
    console.error('reset-demo está bloqueado en producción (requiere DEMO_TOOLS=true en un piloto controlado).');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await seedDemo(client, { reset });
    await client.query('COMMIT');
    console.log(out.skipped ? 'La base ya tiene datos: no se cargó la demo (usa npm run reset-demo para reiniciar).' : `Demo cargada: ${JSON.stringify(out)}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('No se pudo cargar la demo:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
