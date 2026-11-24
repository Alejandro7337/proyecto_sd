// Base de datos del modo demo: integridad del seed, reinicio, aislamiento e invariantes.
// La base de datos real (PostgreSQL) se prueba en tuespacio/server/test.
import { call, DEMO, freshDb, login, reservationBody, setClock } from './support/backend';
import { createSeed } from '../src/api/mock/seed';
import { freeFor, getDb, resetDb, usage } from '../src/api/mock/db';
import { VEHICLES } from '../src/domain/rules';

beforeEach(() => {
  freshDb();
  setClock();
});

describe('integridad de los datos demo', () => {
  const seed = createSeed();

  test('ids únicos en cada colección', () => {
    for (const key of ['users', 'destinations', 'spaces', 'reservations']) {
      const ids = seed[key].map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('referencias válidas entre colecciones', () => {
    const users = new Set(seed.users.map((u) => u.id));
    const destinations = new Set(seed.destinations.map((d) => d.id));
    const spaces = new Set(seed.spaces.map((s) => s.id));
    seed.spaces.forEach((s) => {
      expect(destinations.has(s.destinationId)).toBe(true);
      if (s.hostId) expect(users.has(s.hostId)).toBe(true);
    });
    seed.reservations.forEach((r) => expect(spaces.has(r.spaceId)).toBe(true));
    // El dueño demo tiene exactamente un parqueadero.
    expect(seed.spaces.filter((s) => s.ownerId === 'u-owner')).toHaveLength(1);
  });

  test('ninguna ocupación inicial excede la capacidad', () => {
    seed.spaces.forEach((s) => {
      Object.keys(VEHICLES).forEach((v) => {
        expect(s.occupied[v]).toBeLessThanOrEqual(s.capacity[v]);
        if (s.capacity[v] > 0) expect(s.rates[v]?.price).toBeGreaterThan(0);
      });
    });
  });

  test('los datos demo no parecen reales: correos .test y direcciones marcadas como ficticias', () => {
    seed.users.forEach((u) => expect(u.email).toMatch(/@demo\.test$/));
    seed.spaces.forEach((s) => expect(s.address).toMatch(/\(ficticia\)$/));
  });
});

describe('reinicio de datos demo', () => {
  test('resetDb restaura el estado inicial y borra reservas, retenciones y registro', async () => {
    const driver = await login(DEMO.driver);
    await call('POST', '/reservations', reservationBody(), driver);
    getDb().spaces[0].name = 'Cambiado';
    resetDb();
    const db = getDb();
    expect(db.spaces[0].name).toBe(createSeed().spaces[0].name);
    expect(db.reservations).toHaveLength(createSeed().reservations.length);
    expect(db.txLog).toHaveLength(0);
    expect(db.holds).toHaveLength(0);
    expect(Object.keys(db.idempotency)).toHaveLength(0);
  });

  test('las cuentas creadas se pierden al reiniciar y su token deja de valer', async () => {
    const { data } = await call('POST', '/auth/register', { name: 'Temporal Uno', email: 't@demo.test', password: 'secreto1', role: 'driver', vehicle: 'car' });
    resetDb();
    expect((await call('GET', '/me', null, data.token)).error.code).toBe('UNAUTHORIZED');
  });
});

describe('aislamiento de respuestas', () => {
  test('modificar una respuesta no altera el estado del servidor', async () => {
    const { data } = await call('GET', '/spaces/s-emp-1');
    data.capacity.car = 0;
    data.rates.car.price = 1;
    expect((await call('GET', '/spaces/s-emp-1')).data.capacity.car).toBe(40);
  });

  test('modificar el cuerpo enviado después de la petición no altera lo guardado', async () => {
    const owner = await login(DEMO.owner);
    const body = { schedule: { open: '07:00', close: '20:00', days: 'Lun – Vie' } };
    await call('PATCH', '/spaces/s-emp-1', body, owner);
    body.schedule.open = '00:00';
    expect((await call('GET', '/spaces/s-emp-1')).data.schedule.open).toBe('07:00');
  });
});

describe('invariantes tras operaciones mezcladas', () => {
  test('libres nunca negativos y ocupados + reservados + retenidos ≤ capacidad', async () => {
    const driver = await login(DEMO.driver);
    const owner = await login(DEMO.owner);
    const ops = [];
    for (let i = 0; i < 15; i += 1) {
      ops.push(call('POST', '/reservations', reservationBody({ spaceId: 's-emp-1', vehicle: i % 3 ? 'car' : 'moto' }), driver));
      ops.push(call('POST', '/spaces/s-emp-1/occupancy', { vehicle: i % 2 ? 'car' : 'moto', delta: i % 4 ? 1 : -1 }, owner));
    }
    await Promise.all(ops);
    const space = getDb().spaces.find((s) => s.id === 's-emp-1');
    Object.keys(VEHICLES).forEach((v) => {
      const u = usage(space, v);
      expect(freeFor(space, v)).toBeGreaterThanOrEqual(0);
      expect(u.occupied + u.reserved + u.held).toBeLessThanOrEqual(space.capacity[v]);
    });
  });
});
