// Servicio: Panel del parqueadero y del anfitrión (cupos, tarifas, horarios, métricas, ingresos).
import { clock, getDb, findSpace, freeFor, nextId, usage, toSpaceDTO, toReservationDTO } from '../db';
import { ApiError } from '../../errors';
import { requireUser } from './auth';
import { VEHICLES, COMMISSION_RATE, DAY_OPTIONS, HOST_SPACE_TYPES } from '../../../domain/rules';
import { isValidTime } from '../../../utils/format';

function assertCanEdit(user, space) {
  if (space.ownerId !== user.id && space.hostId !== user.id) {
    throw new ApiError('FORBIDDEN', 'No administras este espacio.', 403);
  }
}

const sameDay = (iso) => new Date(iso).toDateString() === new Date(clock.now()).toDateString();

export function ownerSpace(user) {
  requireUser(user, 'owner');
  const space = getDb().spaces.find((s) => s.ownerId === user.id);
  if (!space) throw new ApiError('SPACE_NOT_FOUND', 'Tu cuenta aún no tiene un parqueadero asociado.', 404);
  const todays = getDb().reservations.filter((r) => r.spaceId === space.id && sameDay(r.createdAt) && r.status !== 'cancelled');
  const reservations = [...space.metrics.reservations];
  reservations[6] = todays.length;
  return {
    space: toSpaceDTO(space),
    plan: user.plan,
    metrics: { views: space.metrics.views, reservations },
  };
}

// Valida y normaliza los campos editables de un espacio. Devuelve errores por campo.
function validateSpaceInput(input, space) {
  const fields = {};
  if ('name' in input && input.name.trim().length < 3) fields.name = 'Escribe un nombre de al menos 3 letras.';
  if ('address' in input && input.address.trim().length < 5) fields.address = 'Escribe la dirección.';
  if (input.capacity) {
    Object.keys(VEHICLES).forEach((v) => {
      const cap = Number(input.capacity[v]);
      if (!Number.isInteger(cap) || cap < 0) fields['capacity.' + v] = 'Cupos no válidos.';
      else if (space) {
        const u = usage(space, v);
        const inUse = u.occupied + u.reserved + u.held;
        if (cap < inUse) fields['capacity.' + v] = `Hay ${inUse} en uso; no puedes bajar de ahí.`;
      }
    });
    const total = Object.keys(VEHICLES).reduce((acc, v) => acc + (Number(input.capacity[v]) || 0), 0);
    if (total === 0) fields.capacity = 'Debes ofrecer al menos un cupo.';
  }
  if (input.rates) {
    Object.keys(VEHICLES).forEach((v) => {
      const cap = Number((input.capacity || space.capacity)[v]);
      const rate = input.rates[v];
      if (cap > 0 && (!rate || !(Number(rate.price) > 0))) fields['rates.' + v] = 'Escribe una tarifa mayor a 0.';
    });
  }
  if (input.schedule) {
    if (!isValidTime(input.schedule.open)) fields['schedule.open'] = 'Usa formato HH:MM.';
    if (!isValidTime(input.schedule.close)) fields['schedule.close'] = 'Usa formato HH:MM.';
    if (!fields['schedule.open'] && !fields['schedule.close'] && input.schedule.open >= input.schedule.close) {
      fields['schedule.close'] = 'El cierre debe ser después de la apertura.';
    }
    if (!DAY_OPTIONS.includes(input.schedule.days)) fields['schedule.days'] = 'Elige los días.';
  }
  if ('status' in input && !['published', 'paused'].includes(input.status)) fields.status = 'Estado no válido.';
  if (input.conditions && input.conditions.maxHeight !== null && input.conditions.maxHeight !== undefined) {
    const h = Number(input.conditions.maxHeight);
    if (!(h >= 1.5 && h <= 4)) fields['conditions.maxHeight'] = 'Entre 1,50 y 4,00 m, o déjalo vacío.';
  }
  if (Object.keys(fields).length) throw new ApiError('VALIDATION', 'Revisa los campos marcados.', 422, { fields });
}

function normalizeRates(rates, capacity) {
  const out = {};
  Object.keys(VEHICLES).forEach((v) => {
    out[v] = capacity[v] > 0 && rates[v] ? { unit: rates[v].unit, price: Math.round(Number(rates[v].price)) } : null;
  });
  return out;
}

export function updateSpace(user, id, input = {}) {
  requireUser(user);
  const space = findSpace(id);
  assertCanEdit(user, space);
  validateSpaceInput(input, space);
  if (input.name) space.name = input.name.trim();
  if (input.address) space.address = input.address.trim();
  if (input.capacity) {
    Object.keys(VEHICLES).forEach((v) => {
      space.capacity[v] = Number(input.capacity[v]);
    });
  }
  if (input.rates) space.rates = normalizeRates(input.rates, space.capacity);
  if (input.schedule) space.schedule = { ...input.schedule };
  if (input.conditions) {
    space.conditions = {
      covered: !!input.conditions.covered,
      keys: !!input.conditions.keys,
      maxHeight: input.conditions.maxHeight === null || input.conditions.maxHeight === undefined ? null : Number(input.conditions.maxHeight),
    };
  }
  if (input.status) space.status = input.status === 'paused' ? 'paused' : 'published';
  return toSpaceDTO(space);
}

// Registro manual de entradas/salidas de vehículos que llegan sin reserva.
export function adjustOccupancy(user, id, { vehicle, delta }) {
  requireUser(user);
  const space = findSpace(id);
  assertCanEdit(user, space);
  if (!VEHICLES[vehicle]) throw new ApiError('VALIDATION', 'Vehículo no válido.', 422);
  if (delta !== 1 && delta !== -1) throw new ApiError('VALIDATION', 'El ajuste debe ser +1 o -1.', 422);
  if (delta > 0 && freeFor(space, vehicle) <= 0) throw new ApiError('NO_FREE_SPOTS', 'No quedan cupos libres para registrar una entrada.', 409);
  if (delta < 0 && space.occupied[vehicle] <= 0) throw new ApiError('NOTHING_TO_RELEASE', 'No hay vehículos sin reserva para registrar salida.', 409);
  space.occupied[vehicle] += delta > 0 ? 1 : -1;
  return toSpaceDTO(space);
}

export function spaceReservations(user, id) {
  requireUser(user);
  const space = findSpace(id);
  assertCanEdit(user, space);
  return getDb()
    .reservations.filter((r) => r.spaceId === id)
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))
    .map(toReservationDTO);
}

export function hostSpaces(user) {
  requireUser(user, 'host');
  return getDb().spaces.filter((s) => s.hostId === user.id).map(toSpaceDTO);
}

export function hostReservations(user) {
  requireUser(user, 'host');
  const ids = getDb().spaces.filter((s) => s.hostId === user.id).map((s) => s.id);
  return getDb()
    .reservations.filter((r) => ids.includes(r.spaceId))
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))
    .map(toReservationDTO);
}

export function createHostSpace(user, input = {}) {
  requireUser(user, 'host');
  const fields = {};
  if (!input.name || input.name.trim().length < 3) fields.name = 'Escribe un nombre de al menos 3 letras.';
  if (!input.address || input.address.trim().length < 5) fields.address = 'Escribe la dirección.';
  if (!getDb().destinations.some((d) => d.id === input.destinationId)) fields.destinationId = 'Elige la zona.';
  if (!HOST_SPACE_TYPES.includes(input.hostType)) fields.hostType = 'Elige el tipo de espacio.';
  if (!input.identityConsent) fields.identityConsent = 'La verificación de identidad es obligatoria para publicar.';
  if (Object.keys(fields).length) throw new ApiError('VALIDATION', 'Revisa los campos marcados.', 422, { fields });
  validateSpaceInput({ capacity: input.capacity, rates: input.rates, schedule: input.schedule, conditions: input.conditions }, null);

  const angle = Math.random() * Math.PI * 2;
  const r = 0.45 + Math.random() * 0.3;
  const capacity = { car: Number(input.capacity.car), moto: Number(input.capacity.moto) };
  const space = {
    id: nextId('s'),
    destinationId: input.destinationId,
    kind: 'particular',
    hostId: user.id,
    hostType: input.hostType,
    name: input.name.trim(),
    address: input.address.trim(),
    pos: { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
    distanceM: Math.round((r * 650) / 10) * 10,
    rates: normalizeRates(input.rates, capacity),
    capacity,
    occupied: { car: 0, moto: 0 },
    schedule: { ...input.schedule },
    conditions: {
      covered: !!input.conditions.covered,
      keys: !!input.conditions.keys,
      maxHeight: input.conditions.maxHeight ? Number(input.conditions.maxHeight) : null,
    },
    status: 'published',
  };
  getDb().spaces.push(space);
  if (user.identity === 'pending') user.identity = 'in_review';
  return toSpaceDTO(space);
}

export function hostEarnings(user) {
  requireUser(user, 'host');
  const items = hostReservations(user).filter((r) => r.status === 'completed' || r.status === 'active' || r.status === 'confirmed');
  const settled = items.filter((r) => r.status === 'completed');
  const gross = settled.reduce((acc, r) => acc + r.amount, 0);
  const pending = items.filter((r) => r.status !== 'completed').reduce((acc, r) => acc + r.amount, 0);
  return {
    gross,
    pending,
    commissionRate: COMMISSION_RATE,
    net: COMMISSION_RATE === null ? null : gross * (1 - COMMISSION_RATE),
    items,
  };
}
