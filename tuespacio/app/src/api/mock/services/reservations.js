// Servicio: Disponibilidad y Reservas.
// createReservation reproduce la transacción distribuida T0 "Reservar cupo con pago"
// del documento del equipo: T11 verificar → T12 retener → T21 preautorizar →
// T22 registrar tarifa/comisión → T23 capturar → T13 confirmar, con compensaciones.
import { getDb, delay, findSpace, findReservation, freeFor, usage, toSpaceDTO, toReservationDTO, shortName } from '../db';
import { ApiError } from '../../errors';
import { faults } from '../demoControls';
import { requireUser } from './auth';
import * as payments from './payments';
import { estimateCost, HOLD_MINUTES, VEHICLES, COMMISSION_RATE } from '../../../domain/rules';
import { formatTime } from '../../../utils/format';

const STEP_MS = 280;
const inFlight = new Map();

function beginTx(meta) {
  const tx = { id: 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), startedAt: new Date().toISOString(), outcome: 'running', meta, steps: [] };
  getDb().txLog.unshift(tx);
  return {
    log: (step, status, detail) => tx.steps.push({ step, status, detail, at: new Date().toISOString() }),
    end: (outcome) => {
      tx.outcome = outcome;
    },
  };
}

function alternativesFor(space, vehicle) {
  return getDb()
    .spaces.filter((s) => s.id !== space.id && s.destinationId === space.destinationId && s.status === 'published')
    .filter((s) => s.rates[vehicle] && freeFor(s, vehicle) > 0)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 3)
    .map(toSpaceDTO);
}

const randomCode = () => 'TE-' + Math.random().toString(36).slice(2, 6).toUpperCase();

export async function createReservation(user, body = {}) {
  requireUser(user, 'driver');
  const scope = `${user.id}:${body.idempotencyKey}`;
  const signature = JSON.stringify([body.spaceId, body.vehicle, body.startAt, body.durationMin, body.expectedAmount]);
  const completed = getDb().idempotency[scope];
  const running = inFlight.get(scope);
  if ((completed && completed.signature !== signature) || (running && running.signature !== signature)) {
    throw new ApiError('IDEMPOTENCY_CONFLICT', 'Esta llave ya fue usada con otros datos.', 409);
  }
  if (completed) return toReservationDTO(findReservation(completed.id));
  if (running) return running.promise;
  const promise = performReservation(user, body, scope, signature).finally(() => inFlight.delete(scope));
  inFlight.set(scope, { signature, promise });
  return promise;
}

async function performReservation(user, body, scope, signature) {
  requireUser(user, 'driver');
  const { spaceId, vehicle, startAt, durationMin, idempotencyKey } = body;
  if (!spaceId || !VEHICLES[vehicle] || !Number.isInteger(durationMin) || durationMin < 15 || durationMin > 480 || typeof startAt !== 'string' || !Number.isFinite(new Date(startAt).getTime()) || !idempotencyKey) {
    throw new ApiError('VALIDATION', 'Datos de reserva incompletos.', 422);
  }
  const db = getDb();

  const space = findSpace(spaceId);
  if (space.status !== 'published') throw new ApiError('SPACE_UNAVAILABLE', 'Este espacio no está publicado ahora.', 409);
  const rate = space.rates[vehicle];
  if (!rate || !space.capacity[vehicle]) throw new ApiError('VEHICLE_NOT_ACCEPTED', 'Este espacio no recibe ese tipo de vehículo.', 422);
  if (body.expectedAmount !== undefined && body.expectedAmount !== estimateCost(rate, durationMin)) throw new ApiError('PRICE_CHANGED', 'La tarifa cambió. Actualiza y revisa el nuevo total.', 409);

  const fault = faults.nextReservation;
  faults.nextReservation = 'none';
  const tx = beginTx({ space: space.name, vehicle, idempotencyKey });
  tx.log('T0', 'start', `Coordinador inicia T0 · ${space.name}`);

  // T11 · Verificar que el cupo esté libre
  await delay(STEP_MS);
  if (fault === 'taken') {
    // Simula que otro conductor tomó el último cupo un instante antes.
    const u = usage(space, vehicle);
    space.occupied[vehicle] = space.capacity[vehicle] - u.reserved - u.held;
    tx.log('T11', 'info', 'Otro conductor confirmó el último cupo en el mismo instante (simulado)');
  }
  if (freeFor(space, vehicle) <= 0) {
    tx.log('T11', 'fail', 'Cupo ocupado → aborta T0 antes de cobrar');
    tx.end('aborted');
    throw new ApiError('SPACE_TAKEN', 'El cupo ya no está disponible.', 409, {
      failedStep: 'hold',
      alternatives: alternativesFor(space, vehicle),
    });
  }
  tx.log('T11', 'ok', `Cupo libre verificado (${freeFor(space, vehicle)} disponibles)`);

  // La comprobación y el incremento deben ocurrir en el mismo turno, sin await.
  space.held[vehicle] += 1;
  const holdUntil = new Date(Date.now() + HOLD_MINUTES * 60000).toISOString();
  tx.log('T12', 'ok', `Cupo retenido hasta las ${formatTime(holdUntil)} (${HOLD_MINUTES} min)`);
  const releaseHold = () => {
    space.held[vehicle] = Math.max(0, space.held[vehicle] - 1);
  };

  const amount = estimateCost(rate, durationMin);

  // T21 · Preautorizar el pago
  let auth;
  try {
    auth = await payments.authorize({ amount, idempotencyKey, fault, log: tx.log });
    tx.log('T21', 'ok', `Preautorización ${auth.id} por ${amount} COP`);
  } catch (e) {
    tx.log('T21', 'fail', e.message);
    releaseHold();
    tx.log('C12', 'comp', 'Compensación: cupo liberado');
    tx.end('aborted');
    throw e;
  }

  // T22 · Registrar tarifa y comisión
  await delay(STEP_MS);
  tx.log(
    'T22',
    'ok',
    space.kind === 'particular'
      ? `Tarifa registrada · comisión ${COMMISSION_RATE === null ? 'por definir (Fase 0)' : COMMISSION_RATE * 100 + '%'}`
      : 'Tarifa registrada · sin comisión (plan de mensualidad)'
  );

  // T23 · Capturar el pago y acreditar al propietario
  await payments.capture(auth.id);
  tx.log('T23', 'ok', 'Pago capturado y acreditado al propietario (simulado)');

  // T13 · Confirmar la reserva
  await delay(STEP_MS);
  releaseHold();
  const start = new Date(startAt);
  const reservation = {
    id: 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    code: randomCode(),
    spaceId,
    driverId: user.id,
    driverName: shortName(user.name),
    vehicle,
    status: 'confirmed',
    durationMin,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationMin * 60000).toISOString(),
    amount,
    createdAt: new Date().toISOString(),
    checkInAt: null,
  };
  db.reservations.unshift(reservation);
  db.idempotency[scope] = { id: reservation.id, signature };
  tx.log('T13', 'ok', `Reserva ${reservation.code} confirmada`);
  tx.log('async', 'info', 'Notificaciones y actualización del panel fuera de T0');
  tx.end('committed');
  return toReservationDTO(reservation);
}

export function myReservations(user) {
  requireUser(user, 'driver');
  return getDb()
    .reservations.filter((r) => r.driverId === user.id)
    .map(toReservationDTO);
}

function canManage(user, r) {
  const space = findSpace(r.spaceId);
  return r.driverId === user.id || space.ownerId === user.id || space.hostId === user.id;
}

export function getReservation(user, id) {
  requireUser(user);
  const r = findReservation(id);
  if (!canManage(user, r)) throw new ApiError('FORBIDDEN', 'No tienes acceso a esta reserva.', 403);
  return toReservationDTO(r);
}

export async function cancelReservation(user, id) {
  requireUser(user);
  const r = findReservation(id);
  if (!canManage(user, r)) throw new ApiError('FORBIDDEN', 'No tienes acceso a esta reserva.', 403);
  if (r.status !== 'confirmed') throw new ApiError('INVALID_STATE', 'Solo puedes cancelar reservas que aún no han iniciado.', 409);
  await payments.refund(r.id);
  r.status = 'cancelled';
  return toReservationDTO(r);
}

export function checkIn(user, id) {
  requireUser(user);
  const r = findReservation(id);
  if (!canManage(user, r)) throw new ApiError('FORBIDDEN', 'No tienes acceso a esta reserva.', 403);
  if (r.status !== 'confirmed') throw new ApiError('INVALID_STATE', 'La reserva no está pendiente de llegada.', 409);
  r.status = 'active';
  r.checkInAt = new Date().toISOString();
  return toReservationDTO(r);
}

export function checkOut(user, id) {
  requireUser(user);
  const r = findReservation(id);
  if (!canManage(user, r)) throw new ApiError('FORBIDDEN', 'No tienes acceso a esta reserva.', 403);
  if (r.status !== 'active') throw new ApiError('INVALID_STATE', 'La reserva no está en curso.', 409);
  r.status = 'completed';
  r.checkOutAt = new Date().toISOString();
  return toReservationDTO(r);
}

export function transactionLog() {
  return getDb().txLog.slice(0, 15);
}
