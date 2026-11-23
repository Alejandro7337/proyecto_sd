// Persistencia en memoria del backend simulado. Se reinicia al recargar la app.
import { createSeed } from './seed';
import { availabilityStatus, VEHICLES } from '../../domain/rules';
import { ApiError } from '../errors';

const store = { db: createSeed() };

export const getDb = () => store.db;
export const resetDb = () => {
  store.db = createSeed();
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const holdsSpot =(r) => r.status === 'confirmed' || r.status === 'active';

export function usage(space, vehicle) {
  const reserved = store.db.reservations.filter(
    (r) => r.spaceId === space.id && r.vehicle === vehicle && holdsSpot(r)
  ).length;
  return { occupied: space.occupied[vehicle], reserved, held: space.held[vehicle] };
}

export function freeFor(space, vehicle) {
  const u = usage(space, vehicle);
  return Math.max(0, space.capacity[vehicle] - u.occupied - u.reserved - u.held);
}

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
    },
  };
}
