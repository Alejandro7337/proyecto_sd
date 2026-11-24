// Servicio: Disponibilidad y Reservas.
// createReservation reproduce la transacción distribuida T0 "Reservar cupo con pago"
// del documento del equipo: T11 verificar → T12 retener → T21 preautorizar →
// T22 registrar tarifa/comisión → T23 capturar → T13 confirmar, con compensaciones.
import {
  clock,
  delay,
  findReservation,
  findSpace,
  freeFor,
  getDb,
  holdIsValid,
  nextId,
  nowIso,
  releaseHold,
  shortName,
  toReservationDTO,
  toSpaceDTO,
  tryHold,
} from '../db';
import { ApiError } from '../../errors';
import { faults } from '../demoControls';
import { requireUser } from './auth';
import * as payments from './payments';
import {
  COMMISSION_RATE,
  HOLD_MINUTES,
  MAX_DURATION_MIN,
  PAST_START_TOLERANCE_MIN,
  SCHEDULE_ISSUES,
  VEHICLES,
  estimateCost,
  scheduleIssue,
} from '../../../domain/rules';
import { formatTime } from '../../../utils/format';

const STEP_MS = 280;

function beginTx(meta) {
  const tx = { id: nextId('tx'), startedAt: nowIso(), outcome: 'running', meta, steps: [] };
  getDb().txLog.unshift(tx);
  return {
    id: tx.id,
    log: (step, status, detail) => tx.steps.push({ step, status, detail, at: nowIso() }),
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

const randomCode = () => 'TE-' + Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');

// Huella de la petición: la misma llave con otro contenido es un error del cliente.
const fingerprint = ({ spaceId, vehicle, startAt, durationMin }) => JSON.stringify([spaceId, vehicle, startAt, durationMin]);

function validateBody(body) {
  const { spaceId, vehicle, startAt, durationMin, idempotencyKey } = body;
  const start = new Date(startAt);
  const fields = {};
  if (!spaceId) fields.spaceId = 'Falta el espacio.';
  if (!VEHICLES[vehicle]) fields.vehicle = 'Vehículo no válido.';
  if (!Number.isInteger(durationMin) || durationMin <= 0 || durationMin > MAX_DURATION_MIN) fields.durationMin = 'Duración no válida.';
  if (!startAt || Number.isNaN(start.getTime())) fields.startAt = 'Hora de llegada no válida.';
  else if (start.getTime() < clock.now() - PAST_START_TOLERANCE_MIN * 60000) fields.startAt = 'La hora de llegada ya pasó.';
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) fields.idempotencyKey = 'Falta la llave de idempotencia.';
  if (Object.keys(fields).length) throw new ApiError('VALIDATION', 'Datos de reserva incompletos.', 422, { fields });
  return start;
}

export async function createReservation(user, body = {}) {
  requireUser(user, 'driver');
  validateBody(body);
  const db = getDb();

  // Idempotencia: la llave se registra ANTES de empezar, por usuario. Un reintento concurrente
  // espera el mismo resultado; uno posterior recibe la reserva ya creada (sin doble cobro).
  const key = `${user.id}:${body.idempotencyKey}`;
  const existing = db.idempotency[key];
  if (existing) {
    if (existing.fingerprint !== fingerprint(body)) {
      throw new ApiError('IDEMPOTENCY_KEY_REUSED', 'Esta llave ya se usó para otra reserva.', 422);
    }
    if (existing.reservationId) return toReservationDTO(findReservation(existing.reservationId));
    return existing.promise;
  }
  const entry = { fingerprint: fingerprint(body), reservationId: null, promise: null };
  db.idempotency[key] = entry;
  entry.promise = runT0(user, body)
    .then((reservation) => {
      entry.reservationId = reservation.id;
      return toReservationDTO(reservation);
    })
    .catch((e) => {
      // Un aborto definitivo libera la llave: no quedó nada creado ni cobrado.
      if (db.idempotency[key] === entry) delete db.idempotency[key];
      throw e;
    });
  return entry.promise;
}

async function runT0(user, body) {
  const { spaceId, vehicle, startAt, durationMin, idempotencyKey } = body;
  const space = findSpace(spaceId);
  if (space.status !== 'published') throw new ApiError('SPACE_UNAVAILABLE', 'Este espacio no está publicado ahora.', 409);
  const rate = space.rates[vehicle];
  if (!rate || !space.capacity[vehicle]) throw new ApiError('VEHICLE_NOT_ACCEPTED', 'Este espacio no recibe ese tipo de vehículo.', 422);

  const start = new Date(startAt);
  const end = new Date(start.getTime() + durationMin * 60000);
  const issue = scheduleIssue(space.schedule, start, end);
  if (issue) {
    throw new ApiError('OUTSIDE_SCHEDULE', SCHEDULE_ISSUES[issue], 409, { reason: issue, schedule: space.schedule });
  }

  const fault = faults.nextReservation;
  faults.nextReservation = 'none';
  const tx = beginTx({ space: space.name, vehicle, idempotencyKey, driver: shortName(user.name) });
  tx.log('T0', 'start', `Coordinador inicia T0 · ${space.name} · ${shortName(user.name)}`);

  await delay(STEP_MS);
  if (fault === 'taken') {
    // Simula que otro conductor tomó el último cupo un instante antes.
    space.occupied[vehicle] += freeFor(space, vehicle);
    tx.log('T11', 'info', 'Otro conductor confirmó el último cupo en el mismo instante (simulado)');
  }

  // T11 + T12 · Verificar y retener de forma atómica (sin ceder el control entre ambos).
  const freeBefore = freeFor(space, vehicle);
  const hold = tryHold(space, vehicle);
  if (!hold) {
    tx.log('T11', 'fail', 'Cupo ocupado → aborta T0 antes de cobrar');
    tx.end('aborted');
    throw new ApiError('SPACE_TAKEN', 'El cupo ya no está disponible.', 409, {
      failedStep: 'hold',
      alternatives: alternativesFor(space, vehicle),
      txId: tx.id,
    });
  }
  tx.log('T11', 'ok', `Cupo libre verificado (${freeBefore} disponibles)`);
  tx.log('T12', 'ok', `Cupo retenido hasta las ${formatTime(new Date(hold.expiresAt).toISOString())} (${HOLD_MINUTES} min)`);
  await delay(STEP_MS);

  const amount = estimateCost(rate, durationMin);

  // T21 · Preautorizar el pago
  let auth;
  try {
    auth = await payments.authorize({ amount, idempotencyKey, fault, log: tx.log });
    tx.log('T21', 'ok', `Preautorización ${auth.id} por ${amount} COP`);
  } catch (e) {
    tx.log('T21', 'fail', e.message);
    releaseHold(hold);
    tx.log('C12', 'comp', 'Compensación: cupo liberado');
    tx.end('aborted');
    e.details = { ...e.details, txId: tx.id };
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

  if (fault === 'expired') {
    // Simula una pasarela que respondió después de que venció la retención.
    hold.expiresAt = clock.now() - 1;
    tx.log('T12', 'info', 'La retención venció mientras la pasarela respondía (simulado)');
  }

  // Antes de capturar se comprueba que la retención siga vigente: si venció, otro conductor
  // pudo tomar el cupo, así que se anula la preautorización en lugar de cobrar.
  if (!holdIsValid(hold)) {
    tx.log('T23', 'fail', 'Retención vencida → no se captura el pago');
    tx.log('C22', 'comp', 'Compensación: registro de tarifa reversado');
    await payments.voidAuthorization(auth.id);
    tx.log('C21', 'comp', `Compensación: preautorización ${auth.id} anulada`);
    releaseHold(hold);
    tx.log('C12', 'comp', 'Compensación: retención liberada');
    tx.end('aborted');
    throw new ApiError('HOLD_EXPIRED', 'La retención del cupo venció antes de confirmar.', 409, { failedStep: 'capture', txId: tx.id });
  }

  // T23 · Capturar el pago y acreditar al propietario
  await payments.capture(auth.id);
  tx.log('T23', 'ok', 'Pago capturado y acreditado al propietario (simulado)');

  // T13 · Confirmar la reserva (la retención se convierte en reserva en el mismo paso)
  await delay(STEP_MS);
  const reservation = {
    id: nextId('r'),
    code: randomCode(),
    spaceId,
    driverId: user.id,
    driverName: shortName(user.name),
    vehicle,
    status: 'confirmed',
    durationMin,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    amount,
    createdAt: nowIso(),
    checkInAt: null,
    txId: tx.id,
  };
  getDb().reservations.unshift(reservation);
  releaseHold(hold);
  tx.log('T13', 'ok', `Reserva ${reservation.code} confirmada`);
  tx.log('async', 'info', 'Notificaciones y actualización del panel fuera de T0');
  tx.end('committed');
  return reservation;
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

function findManageable(user, id) {
  requireUser(user);
  const r = findReservation(id);
  if (!canManage(user, r)) throw new ApiError('FORBIDDEN', 'No tienes acceso a esta reserva.', 403);
  return r;
}

export function getReservation(user, id) {
  return toReservationDTO(findManageable(user, id));
}

export async function cancelReservation(user, id) {
  const r = findManageable(user, id);
  if (r.status !== 'confirmed') throw new ApiError('INVALID_STATE', 'Solo puedes cancelar reservas que aún no han iniciado.', 409);
  // Se marca antes de esperar a la pasarela: dos cancelaciones simultáneas no reembolsan dos veces.
  r.status = 'cancelled';
  r.cancelledBy = user.id;
  await payments.refund(r.id);
  r.refundedAt = nowIso();
  return toReservationDTO(r);
}

export function checkIn(user, id) {
  const r = findManageable(user, id);
  if (r.status !== 'confirmed') throw new ApiError('INVALID_STATE', 'La reserva no está pendiente de llegada.', 409);
  r.status = 'active';
  r.checkInAt = nowIso();
  return toReservationDTO(r);
}

export function checkOut(user, id) {
  const r = findManageable(user, id);
  if (r.status !== 'active') throw new ApiError('INVALID_STATE', 'La reserva no está en curso.', 409);
  r.status = 'completed';
  r.checkOutAt = nowIso();
  return toReservationDTO(r);
}

export function transactionLog() {
  return getDb().txLog.slice(0, 15);
}
