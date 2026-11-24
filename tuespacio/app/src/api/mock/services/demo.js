// Escenarios guiados para la presentación. Solo existen en el backend simulado: ejecutan la T0
// real del mock con cuentas demo para mostrar cada camino (éxito, fallas y compensaciones).
// Nunca contactan pasarelas reales ni cobran dinero.
import { clock, findSpace, freeFor, getDb } from '../db';
import { ApiError } from '../../errors';
import { faults } from '../demoControls';
import { createReservation } from './reservations';

// Parqueadero 24 h todos los días: los escenarios funcionan a cualquier hora de la presentación.
const DEMO_SPACE = 's-cli-1';
const VEHICLE = 'car';
const user = (id) => getDb().users.find((u) => u.id === id);
const key = (label) => `demo-${label}-${clock.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const body = (idempotencyKey) => ({
  spaceId: DEMO_SPACE,
  vehicle: VEHICLE,
  startAt: new Date(clock.now() + 15 * 60000).toISOString(),
  durationMin: 60,
  idempotencyKey,
});

const settle = async (promise) => {
  try {
    const r = await promise;
    return { ok: true, reservationId: r.id, code: r.code, amount: r.amount };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }
};

// Deja exactamente un cupo libre de carro en el espacio demo.
function leaveOneSpot() {
  const space = findSpace(DEMO_SPACE);
  const free = freeFor(space, VEHICLE);
  space.occupied[VEHICLE] = Math.max(0, space.occupied[VEHICLE] + free - 1);
  return freeFor(space, VEHICLE);
}

const FAULT_SCENARIOS = { success: 'none', taken: 'taken', declined: 'declined', timeout: 'timeout', expired: 'expired' };

export async function runScenario(name) {
  const driver = user('u-driver');
  if (FAULT_SCENARIOS[name]) {
    faults.nextReservation = FAULT_SCENARIOS[name];
    const result = await settle(createReservation(driver, body(key(name))));
    return { scenario: name, results: [{ driver: 'Laura G.', ...result }] };
  }

  if (name === 'idempotency') {
    // Mismo pedido enviado tres veces con la misma llave: dos a la vez y un reintento posterior.
    const k = key('idem');
    const b = body(k);
    const concurrent = await Promise.all([settle(createReservation(driver, b)), settle(createReservation(driver, b))]);
    const retry = await settle(createReservation(driver, b));
    const all = [...concurrent, retry];
    const ids = new Set(all.filter((r) => r.ok).map((r) => r.reservationId));
    const charged = getDb().txLog.filter((tx) => tx.meta.idempotencyKey === k && tx.outcome === 'committed').length;
    return {
      scenario: name,
      results: all.map((r, i) => ({ driver: i < 2 ? `Envío simultáneo ${i + 1}` : 'Reintento', ...r })),
      sameReservation: ids.size === 1,
      transactionsCharged: charged,
    };
  }

  if (name === 'race') {
    const freeAtStart = leaveOneSpot();
    const [a, b] = await Promise.all([
      settle(createReservation(driver, body(key('race-a')))),
      settle(createReservation(user('u-juan'), body(key('race-b')))),
    ]);
    return {
      scenario: name,
      freeAtStart,
      results: [
        { driver: 'Laura G.', ...a },
        { driver: 'Juan M.', ...b },
      ],
      freeAtEnd: freeFor(findSpace(DEMO_SPACE), VEHICLE),
    };
  }

  throw new ApiError('NOT_FOUND', `Escenario desconocido: ${name}`, 404);
}
