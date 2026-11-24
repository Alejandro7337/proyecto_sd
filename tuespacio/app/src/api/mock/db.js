// Persistencia en memoria del backend simulado. Se reinicia al recargar la app.
// Equivale a la base de datos transaccional del backend real (ver docs/DATABASE.md).
import { createSeed } from './seed';
import { availabilityStatus, isOpenAt, HOLD_MINUTES, VEHICLES } from '../../domain/rules';
import { ApiError } from '../errors';
import { faults } from './demoControls';

const store = { db: createSeed() };

export const getDb = () => store.db;
export const resetDb = () => {
  store.db = createSeed();
};

// Reloj del "servidor". Las pruebas lo sustituyen para simular vencimientos.
export const clock = { now: () => Date.now() };
export const nowIso = () => new Date(clock.now()).toISOString();

// Con latencia 0 (pruebas automáticas) se cede con una microtarea: las operaciones concurrentes
// se siguen intercalando en cada await, pero sin depender de temporizadores.
export const delay = (ms) => {
  const wait = ms * faults.timeScale;
  return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
};

// Identificadores únicos aunque se creen varios en el mismo milisegundo.
let seq = 0;
export const nextId = (prefix) => `${prefix}-${clock.now().toString(36)}${(seq++).toString(36)}`;

export function findSpace(id) {
  const space = store.db.spaces.find((s) => s.id === id);
  if (!space) throw new ApiError('SPACE_NOT_FOUND', 'El espacio no existe.', 404);
  return space;
}

export function findReservation(id) {
  const r = store.db.reservations.find((x) => x.id === id);
  if (!r) throw new ApiError('RESERVATION_NOT_FOUND', 'La reserva no existe.', 404);
  return r;
}

export function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
}

export function shortName(full) {
  const [first, last] = full.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}

const holdsSpot = (r) => r.status === 'confirmed' || r.status === 'active';

// Una retención vencida deja de contar aunque el coordinador no la haya liberado
// (p. ej., si el proceso se cayó a mitad de la T0).
const activeHolds = (space, vehicle) =>
  store.db.holds.filter((h) => h.spaceId === space.id && h.vehicle === vehicle && h.expiresAt > clock.now());

export function usage(space, vehicle) {
  const reserved = store.db.reservations.filter(
    (r) => r.spaceId === space.id && r.vehicle === vehicle && holdsSpot(r)
  ).length;
  return { occupied: space.occupied[vehicle], reserved, held: activeHolds(space, vehicle).length };
}

export function freeFor(space, vehicle) {
  const u = usage(space, vehicle);
  return Math.max(0, space.capacity[vehicle] - u.occupied - u.reserved - u.held);
}

// T11 + T12 en un solo paso atómico: verificar y retener sin ceder el control entre ambos.
// En el backend real es un UPDATE condicional (… WHERE libres > 0) o un SELECT … FOR UPDATE.
export function tryHold(space, vehicle) {
  if (freeFor(space, vehicle) <= 0) return null;
  const hold = {
    id: nextId('h'),
    spaceId: space.id,
    vehicle,
    expiresAt: clock.now() + HOLD_MINUTES * 60000,
  };
  store.db.holds.push(hold);
  return hold;
}

export function releaseHold(hold) {
  store.db.holds = store.db.holds.filter((h) => h.id !== hold.id);
}

export const holdIsValid = (hold) => store.db.holds.some((h) => h.id === hold.id && h.expiresAt > clock.now());

export function toSpaceDTO(space) {
  const availability = {};
  Object.keys(VEHICLES).forEach((v) => {
    const free = freeFor(space, v);
    availability[v] = {
      free,
      capacity: space.capacity[v],
      ...usage(space, v),
      status: availabilityStatus(free, space.capacity[v], space.status !== 'published'),
    };
  });
  const host = space.hostId ? store.db.users.find((u) => u.id === space.hostId) : null;
  return {
    id: space.id,
    kind: space.kind,
    name: space.name,
    address: space.address,
    destinationId: space.destinationId,
    pos: space.pos,
    distanceM: space.distanceM,
    rates: space.rates,
    capacity: space.capacity,
    schedule: space.schedule,
    openNow: isOpenAt(space.schedule, new Date(clock.now())),
    conditions: space.conditions,
    status: space.status,
    plan: space.plan || null,
    hostType: space.hostType || null,
    host: host ? { name: shortName(host.name), identity: host.identity } : null,
    availability,
  };
}

export function toReservationDTO(r) {
  const space = store.db.spaces.find((s) => s.id === r.spaceId);
  return {
    ...r,
    space: {
      id: space.id,
      name: space.name,
      address: space.address,
      kind: space.kind,
      conditions: space.conditions,
      rate: space.rates[r.vehicle],
    },
    payment: {
      method: 'Medio de pago de prueba •••• 4242',
      status: r.status === 'cancelled' ? 'refunded' : 'captured',
      refundedAt: r.refundedAt || null,
    },
  };
}
