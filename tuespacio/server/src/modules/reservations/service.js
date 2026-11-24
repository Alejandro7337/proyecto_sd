// Servicio de Disponibilidad y Reservas. createReservation coordina la transacción distribuida T0
// «Reservar cupo con pago» como SAGA (docs/T0.md):
//
//   T11 verificar → T12 retener (vence) → T21 preautorizar → T22 registrar tarifa/comisión
//   → [vencimiento: renovar o abortar] → T23 capturar → T13 confirmar
//
// Compensaciones: C12 liberar cupo · C21 anular autorización · C22 reversar registro · C23 reembolsar.
// Cada paso se escribe en saga_steps FUERA de las transacciones (queda aunque haya rollback) y se
// puede consultar en vivo (GET /reservations/attempts/:key). La garantía de no sobreventa está en el
// trigger assert_capacity() de PostgreSQL; aquí solo se traducen sus errores.
import {
  LIMITS,
  canTransition,
  checkInWindow,
  commissionFor,
  CURRENT_STATUSES,
  estimateCost,
  HISTORY_STATUSES,
  refundFor,
} from '../../../../app/src/domain/rules.js';
import { localTime, scheduleIssueWeekly } from '../../../../app/src/domain/schedule.js';
import { validateBookingWindow } from '../../../../app/src/domain/validation.js';
import { sha256 } from '../../lib/crypto.js';
import { newId, newReservationCode } from '../../lib/ids.js';
import { AppError, notFound, validationError } from '../../http/errors.js';
import { audit, recordChange } from '../audit/service.js';
import { loadSpace, loadSpaces, slotFrom } from '../catalog/repository.js';
import { PaymentError } from '../payments/errors.js';

const SCOPE = 'POST /reservations';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtCOP = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');
const shortName = (full) => {
  const [first, last] = String(full).trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
};

export function createReservationService({ db, config, payments, catalog, logger }) {
  const b = config.booking;
  const limits = {
    ...LIMITS,
    earlyCheckInMin: b.earlyCheckInMin,
    noShowGraceMin: b.noShowGraceMin,
    bookingHorizonDays: b.bookingHorizonDays,
    walkInHorizonMin: b.walkInHorizonMin,
  };

  // ───────── Registro de la saga ─────────
  const saga = {
    async start(userId, key, spaceId, meta) {
      const id = newId('saga');
      await db.query(`INSERT INTO sagas (id, user_id, space_id, idempotency_key, status, meta) VALUES ($1, $2, $3, $4, 'running', $5)`, [id, userId, spaceId, key, meta]);
      return id;
    },
    async step(id, step, status, detail) {
      await db.query('INSERT INTO saga_steps (saga_id, step, status, detail) VALUES ($1, $2, $3, $4)', [id, step, status, detail]);
      if (b.sagaStepDelayMs && (status === 'ok' || status === 'comp')) await sleep(b.sagaStepDelayMs);
    },
    async finish(id, status, fields = {}) {
      await db.query(`UPDATE sagas SET status = $2, failed_step = $3, error_code = $4, reservation_id = COALESCE($5, reservation_id), finished_at = clock_timestamp() WHERE id = $1`, [
        id,
        status,
        fields.failedStep || null,
        fields.errorCode || null,
        fields.reservationId || null,
      ]);
    },
  };

  async function commissionRate(kind) {
    if (kind === 'formal') return 0;
    if (b.commissionRate !== null && b.commissionRate !== undefined) return b.commissionRate;
    const row = await db.one(`SELECT rate FROM commission_rules WHERE space_kind = 'particular' AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1`);
    return row ? row.rate : null;
  }

  async function alternatives(space, vehicle, slot, viewer) {
    const candidates = await loadSpaces(
      db,
      `s.destination_id = $1 AND s.id <> $2 AND s.status = 'published'
       AND EXISTS (SELECT 1 FROM space_rates r WHERE r.space_id = s.id AND r.vehicle_type = $3 AND r.effective_to IS NULL)`,
      [space.destination_id, space.id, vehicle]
    );
    const list = await catalog.withAvailability(db, candidates, slot, viewer);
    return list.filter((s) => s.availability[vehicle].free > 0).sort((a, b2) => a.distanceM - b2.distanceM).slice(0, 3);
  }

  // ───────── DTO ─────────
  async function loadReservation(client, id) {
    return (
      await client.query(
        `SELECT r.*, lower(r.period) AS start_at, upper(r.period) AS end_at,
                s.name AS space_name, s.address AS space_address, s.kind AS space_kind, s.manager_id, s.timezone,
                s.covered, s.keys_required, s.max_height_m, s.destination_id,
                u.name AS driver_name, v.label AS vehicle_label, v.plate AS vehicle_plate,
                p.status AS payment_status, p.provider AS payment_provider, p.refunded_cop,
                pm.brand AS pm_brand, pm.last4 AS pm_last4
           FROM reservations r
           JOIN spaces s ON s.id = r.space_id
           JOIN users u ON u.id = r.driver_id
           LEFT JOIN vehicles v ON v.id = r.vehicle_id
           LEFT JOIN payments p ON p.reservation_id = r.id
           LEFT JOIN payment_methods pm ON pm.id = r.payment_method_id
          WHERE r.id = $1`,
        [id]
      )
    ).rows[0];
  }

  function reservationDTO(r, viewer) {
    const isDriver = viewer?.id === r.driver_id;
    const durationMin = Math.round((new Date(r.end_at) - new Date(r.start_at)) / 60000);
    const window = checkInWindow(r.start_at, limits);
    const now = Date.now();
    const paymentStatus = r.payment_status === 'refunded' || r.payment_status === 'partially_refunded' ? 'refunded' : r.payment_status || 'pending';
    return {
      id: r.id,
      code: r.code,
      spaceId: r.space_id,
      driverId: isDriver ? r.driver_id : undefined,
      driverName: shortName(r.driver_name),
      vehicle: r.vehicle_type,
      vehicleId: isDriver ? r.vehicle_id : undefined,
      vehicleLabel: isDriver ? r.vehicle_label : undefined,
      plate: isDriver ? r.vehicle_plate : undefined,
      status: r.status,
      startAt: r.start_at,
      endAt: r.end_at,
      durationMin,
      amount: r.amount_cop,
      commission: viewer?.id === r.manager_id ? r.commission_cop : undefined,
      commissionRate: viewer?.id === r.manager_id ? r.commission_rate : undefined,
      refund: r.refund_cop,
      createdAt: r.created_at,
      confirmedAt: r.confirmed_at,
      checkInAt: r.check_in_at,
      checkOutAt: r.check_out_at,
      cancelledAt: r.cancelled_at,
      expiredAt: r.expired_at,
      timezone: r.timezone,
      checkInWindow: { from: new Date(window.from).toISOString(), until: new Date(window.until).toISOString() },
      overstayMin: r.status === 'active' && new Date(r.end_at).getTime() < now ? Math.floor((now - new Date(r.end_at).getTime()) / 60000) : 0,
      canCancel: isDriver && r.status === 'confirmed',
      refundIfCancelled: r.status === 'confirmed' ? refundFor({ startAt: r.start_at, amount: r.amount_cop }, now) : null,
      space: {
        id: r.space_id,
        name: r.space_name,
        // La dirección exacta de un particular solo la ven el conductor con reserva y el anfitrión.
        address: r.space_kind === 'formal' || isDriver || viewer?.id === r.manager_id ? r.space_address : null,
        kind: r.space_kind,
        destinationId: r.destination_id,
        timezone: r.timezone,
        conditions: { covered: r.covered, keys: r.keys_required, maxHeight: r.max_height_m },
        rate: { unit: r.rate_unit, price: r.rate_price_cop },
      },
      payment: {
        method: r.pm_last4 ? `Medio de pago de prueba •••• ${r.pm_last4}` : 'Medio de pago de prueba',
        status: paymentStatus,
        refunded: r.refunded_cop || 0,
        provider: r.payment_provider,
        simulated: r.payment_provider !== 'gateway',
      },
    };
  }

  async function getVisible(client, id, viewer, { forUpdate = false } = {}) {
    const r = await loadReservation(client, id);
    if (!r || (r.driver_id !== viewer.id && r.manager_id !== viewer.id)) throw notFound('RESERVATION_NOT_FOUND');
    if (forUpdate) await client.query('SELECT 1 FROM reservations WHERE id = $1 FOR UPDATE', [id]);
    return r;
  }

  const changed = async (client, r) => {
    await recordChange(client, 'space', r.space_id);
    await recordChange(client, 'reservation', r.id, r.driver_id);
    await recordChange(client, 'reservation', r.id, r.manager_id);
  };

  // ───────── Idempotencia ─────────
  async function claimKey(userId, key, hash) {
    const inserted = await db.one(
      `INSERT INTO idempotency_keys (user_id, scope, key, request_hash, status, locked_until)
       VALUES ($1, $2, $3, $4, 'processing', now() + interval '5 minutes')
       ON CONFLICT DO NOTHING RETURNING key`,
      [userId, SCOPE, key, hash]
    );
    if (inserted) return { fresh: true };
    const row = await db.one('SELECT * FROM idempotency_keys WHERE user_id = $1 AND scope = $2 AND key = $3', [userId, SCOPE, key]);
    if (row.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED', 422);
    if (row.status === 'processing') throw new AppError('IDEMPOTENCY_IN_PROGRESS', 409, { retryAfterSec: 2 });
    return { fresh: false, row };
  }

  async function completeKey(userId, key, status, body) {
    await db.query(`UPDATE idempotency_keys SET status = 'completed', response_status = $4, response_body = $5, locked_until = NULL, updated_at = now() WHERE user_id = $1 AND scope = $2 AND key = $3`, [
      userId,
      SCOPE,
      key,
      status,
      body,
    ]);
  }

  // ───────── T0 ─────────
  async function runT0(req, input, scenario, sagaId) {
    const user = req.user;
    const actor = { id: user.id, role: user.role, requestId: req.id };
    const space = await loadSpace(db, input.spaceId);
    if (!space) throw notFound('SPACE_NOT_FOUND');
    if (space.status !== 'published') throw new AppError('SPACE_UNAVAILABLE', 409);
    const rate = space.rates[input.vehicle];
    if (!rate) throw new AppError('VEHICLE_NOT_ACCEPTED', 422);
    const slot = slotFrom(input);
    const fields = validateBookingWindow(input, Date.now(), limits);
    if (Object.keys(fields).length) throw validationError(fields);
    const issue = scheduleIssueWeekly(space.weekly, space.timezone, slot.start, slot.end);
    if (issue) throw new AppError('OUTSIDE_SCHEDULE', 409, { reason: issue });

    const vehicle = input.vehicleId
      ? await db.one('SELECT * FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL', [input.vehicleId, user.id])
      : await db.one('SELECT * FROM vehicles WHERE user_id = $1 AND type = $2 AND archived_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1', [user.id, input.vehicle]);
    if (input.vehicleId && (!vehicle || vehicle.type !== input.vehicle)) throw validationError({ vehicleId: 'VEHICLE_REQUIRED' });
    if (vehicle?.height_m && space.max_height_m && Number(vehicle.height_m) > Number(space.max_height_m)) throw new AppError('VEHICLE_TOO_TALL', 422);

    const method = input.paymentMethodId
      ? await db.one('SELECT * FROM payment_methods WHERE id = $1 AND user_id = $2', [input.paymentMethodId, user.id])
      : await db.one('SELECT * FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at LIMIT 1', [user.id]);
    if (input.paymentMethodId && !method) throw validationError({ paymentMethodId: 'REQUIRED' });
    let behavior = method?.test_behavior || 'approve';
    if (scenario === 'declined') behavior = 'decline';
    if (scenario === 'timeout') behavior = 'timeout';

    const amount = estimateCost(rate, slot.durationMin);
    const cRate = await commissionRate(space.kind);
    const commission = space.kind === 'particular' ? commissionFor('particular', amount, cRate) : cRate === 0 ? 0 : null;

    await saga.step(sagaId, 'T0', 'start', `Coordinador inicia T0 · ${space.name} · ${input.vehicle} · ${slot.durationMin} min`);

    // T11 · Verificar disponibilidad (lectura)
    const iso = (ms) => new Date(ms).toISOString();
    const [dto] = await catalog.withAvailability(db, [space], slot, user);
    let free = dto.availability[input.vehicle].free;
    if (scenario === 'taken') {
      await saga.step(sagaId, 'T11', 'info', 'Otro conductor confirmó el último cupo en el mismo instante (simulado, sin alterar datos)');
      free = 0;
    }
    if (free <= 0) {
      await saga.step(sagaId, 'T11', 'fail', 'Sin cupo en la franja → aborta T0 antes de cobrar');
      throw new AppError('SPACE_TAKEN', 409, { failedStep: 'T11', alternatives: await alternatives(space, input.vehicle, slot, user) });
    }
    await saga.step(sagaId, 'T11', 'ok', `Cupo libre verificado (${free} disponibles en la franja)`);

    // T12 · Retener el cupo (el trigger bloquea la fila de cupos y revalida: carrera T11→T12 cubierta)
    const reservationId = newId('res');
    const paymentKey = `${user.id}:${input.idempotencyKey}`;
    let paymentId;
    let holdExpires;
    try {
      ({ paymentId, holdExpires } = await db.tx(async (client) => {
        await client.query(
          `INSERT INTO reservations (id, code, space_id, driver_id, vehicle_id, vehicle_type, period, status, rate_unit, rate_price_cop,
                                     amount_cop, commission_rate, commission_cop, payment_method_id, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7, $8, '[)'), 'pending_payment', $9, $10, $11, $12, $13, $14, $15)`,
          [reservationId, newReservationCode(), space.id, user.id, vehicle?.id || null, input.vehicle, iso(slot.start), iso(slot.end), rate.unit, rate.price, amount, cRate, commission, method?.id || null, input.idempotencyKey]
        );
        const hold = (
          await client.query(
            `INSERT INTO holds (id, reservation_id, space_id, vehicle_type, period, expires_at, status)
             VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), now() + make_interval(mins => $7), 'active') RETURNING expires_at`,
            [newId('hold'), reservationId, space.id, input.vehicle, iso(slot.start), iso(slot.end), b.holdMinutes]
          )
        ).rows[0];
        const pid = await payments.createPayment(client, { reservationId, methodId: method?.id || null, amountCop: amount, idempotencyKey: paymentKey });
        await recordChange(client, 'space', space.id);
        return { paymentId: pid, holdExpires: hold.expires_at };
      }));
    } catch (err) {
      if (err.code === 'TE001') {
        await saga.step(sagaId, 'T12', 'fail', 'Otro conductor tomó el cupo entre T11 y T12 → aborta sin cobrar');
        throw new AppError('SPACE_TAKEN', 409, { failedStep: 'T12', alternatives: await alternatives(space, input.vehicle, slot, user) });
      }
      if (err.code === '23P01') {
        await saga.step(sagaId, 'T12', 'fail', 'El vehículo ya tiene otra reserva en esa franja');
        throw new AppError('OVERLAPPING_RESERVATION', 409, { failedStep: 'T12' });
      }
      throw err;
    }
    await saga.step(sagaId, 'T12', 'ok', `Cupo retenido hasta las ${localTime(holdExpires, space.timezone)} (${b.holdMinutes} min)`);
    await db.query('UPDATE sagas SET reservation_id = $2 WHERE id = $1', [sagaId, reservationId]);

    const done = { authorized: null, ledger: false, captured: false };

    // Compensaciones en orden inverso.
    async function compensate(reason) {
      try {
        if (done.captured) {
          await payments.refund(paymentId, { ref: done.authorized.ref, amountCop: amount, idempotencyKey: paymentKey });
          await payments.setStatus(paymentId, 'refunded', { refunded: amount });
          await saga.step(sagaId, 'C23', 'comp', `Compensación: reembolso total de ${fmtCOP(amount)} (simulado)`);
        }
        if (done.ledger) {
          await db.query(
            `INSERT INTO ledger_entries (reservation_id, saga_id, entry_type, account, amount_cop, reverses_id)
             SELECT reservation_id, $2, 'reversal', account, -amount_cop, id FROM ledger_entries
              WHERE reservation_id = $1 AND entry_type IN ('fare', 'commission')
                AND id NOT IN (SELECT reverses_id FROM ledger_entries WHERE reverses_id IS NOT NULL)`,
            [reservationId, sagaId]
          );
          await saga.step(sagaId, 'C22', 'comp', 'Compensación: registro de tarifa y comisión reversado');
        }
        if (done.authorized && !done.captured) {
          await payments.void(paymentId, { ref: done.authorized.ref, idempotencyKey: paymentKey });
          await payments.setStatus(paymentId, 'voided');
          await saga.step(sagaId, 'C21', 'comp', 'Compensación: preautorización anulada');
        }
        await db.tx(async (client) => {
          await client.query(`UPDATE holds SET status = 'released', released_at = now(), release_reason = $2 WHERE reservation_id = $1 AND status IN ('active', 'expired')`, [reservationId, reason]);
          await client.query(`UPDATE reservations SET status = 'failed' WHERE id = $1 AND status = 'pending_payment'`, [reservationId]);
          await recordChange(client, 'space', space.id);
          await audit(client, actor, 'reservation.failed', 'reservation', reservationId, { reason });
        });
        await saga.step(sagaId, 'C12', 'comp', 'Compensación: cupo liberado para otros conductores');
      } catch (err) {
        logger.error('saga.compensation_failed', { err, sagaId });
        await saga.step(sagaId, 'COMP', 'fail', 'Una compensación falló: queda pendiente de conciliación automática');
        await saga.finish(sagaId, 'compensation_failed', { failedStep: 'COMP', errorCode: reason, reservationId });
        throw new AppError(reason, reason === 'PAYMENT_DECLINED' ? 402 : 504, { failedStep: 'COMP', compensated: false });
      }
    }

    // T21 · Preautorizar
    try {
      done.authorized = await payments.authorize(paymentId, { amountCop: amount, behavior, idempotencyKey: paymentKey }, (attempt) =>
        saga.step(sagaId, 'T21', 'retry', `Intento ${attempt}/${config.payments.maxAttempts} sin respuesta · reintento con la misma llave`)
      );
      await payments.setStatus(paymentId, 'authorized', { ref: done.authorized.ref });
      await saga.step(sagaId, 'T21', 'ok', `Preautorización ${done.authorized.ref} por ${fmtCOP(amount)}`);
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err;
      const declined = err.kind === 'DECLINED';
      await payments.setStatus(paymentId, declined ? 'declined' : 'failed');
      await saga.step(sagaId, 'T21', 'fail', declined ? 'Pago rechazado por el emisor' : `La pasarela no respondió tras ${config.payments.maxAttempts} intentos`);
      await compensate(declined ? 'PAYMENT_DECLINED' : 'GATEWAY_TIMEOUT');
      throw new AppError(declined ? 'PAYMENT_DECLINED' : 'GATEWAY_TIMEOUT', declined ? 402 : 504, { failedStep: 'T21' });
    }

    // T22 · Registrar tarifa y comisión
    await db.tx(async (client) => {
      await client.query(`INSERT INTO ledger_entries (reservation_id, saga_id, entry_type, account, amount_cop) VALUES ($1, $2, 'fare', 'manager', $3)`, [reservationId, sagaId, amount]);
      if (commission > 0) {
        await client.query(
          `INSERT INTO ledger_entries (reservation_id, saga_id, entry_type, account, amount_cop) VALUES ($1, $2, 'commission', 'manager', $3), ($1, $2, 'commission', 'platform', $4)`,
          [reservationId, sagaId, -commission, commission]
        );
      }
    });
    done.ledger = true;
    await saga.step(
      sagaId,
      'T22',
      'ok',
      space.kind === 'particular'
        ? `Tarifa ${fmtCOP(amount)} registrada · comisión ${cRate === null ? 'por definir (Fase 0)' : `${Math.round(cRate * 1000) / 10} % = ${fmtCOP(commission)}`}`
        : `Tarifa ${fmtCOP(amount)} registrada · sin comisión (plan de mensualidad)`
    );

    // Vencimiento de la retención: si venció mientras se cobraba, se renueva (el trigger revalida el cupo).
    if (scenario === 'hold_expired') {
      await db.query(`UPDATE holds SET expires_at = now() - interval '1 second' WHERE reservation_id = $1`, [reservationId]);
      await saga.step(sagaId, 'T12', 'info', 'La retención venció mientras se procesaba el pago (simulado)');
    }
    const hold = await db.one('SELECT expires_at > now() AS alive FROM holds WHERE reservation_id = $1', [reservationId]);
    if (!hold?.alive) {
      let renewed = false;
      if (scenario !== 'hold_expired') {
        try {
          await db.tx((client) =>
            client.query(`UPDATE holds SET expires_at = now() + make_interval(mins => $2), renewals = renewals + 1 WHERE reservation_id = $1 AND status = 'active'`, [reservationId, b.holdMinutes])
          );
          renewed = true;
          await saga.step(sagaId, 'T12', 'ok', 'Retención vencida renovada: el cupo seguía libre');
        } catch (err) {
          if (err.code !== 'TE001') throw err;
        }
      }
      if (!renewed) {
        await saga.step(sagaId, 'T12', 'fail', 'La retención venció y el cupo ya no está disponible');
        await compensate('HOLD_EXPIRED');
        throw new AppError('HOLD_EXPIRED', 409, { failedStep: 'T12', alternatives: await alternatives(space, input.vehicle, slot, user) });
      }
    }

    // T23 · Capturar
    try {
      await payments.capture(paymentId, { ref: done.authorized.ref, amountCop: amount, idempotencyKey: paymentKey, behavior: scenario === 'capture_timeout' ? 'capture_timeout' : undefined }, (attempt) =>
        saga.step(sagaId, 'T23', 'retry', `Captura: intento ${attempt} sin respuesta · misma llave`)
      );
      done.captured = true;
      await payments.setStatus(paymentId, 'captured', { captured: amount });
      await saga.step(sagaId, 'T23', 'ok', `Pago capturado y acreditado al ${space.kind === 'formal' ? 'parqueadero' : 'anfitrión'} (simulado)`);
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err;
      await saga.step(sagaId, 'T23', 'fail', 'La captura no se completó');
      await compensate('GATEWAY_TIMEOUT');
      throw new AppError('GATEWAY_TIMEOUT', 504, { failedStep: 'T23' });
    }

    // T13 · Confirmar (actualización condicional: solo si la retención sigue viva)
    try {
      await db.tx(async (client) => {
        const conv = await client.query(`UPDATE holds SET status = 'converted' WHERE reservation_id = $1 AND status = 'active' AND expires_at > now()`, [reservationId]);
        if (conv.rowCount !== 1) throw new AppError('HOLD_EXPIRED', 409);
        await client.query(`UPDATE reservations SET status = 'confirmed', confirmed_at = now(), version = version + 1 WHERE id = $1 AND status = 'pending_payment'`, [reservationId]);
        await audit(client, actor, 'reservation.confirmed', 'reservation', reservationId, { spaceId: space.id, amount, sagaId });
        await recordChange(client, 'space', space.id);
        await recordChange(client, 'reservation', reservationId, user.id);
        await recordChange(client, 'reservation', reservationId, space.manager_id);
      });
    } catch (err) {
      const code = err instanceof AppError ? err.code : err.code === 'TE001' ? 'SPACE_TAKEN' : null;
      if (!code) throw err;
      await saga.step(sagaId, 'T13', 'fail', 'No se pudo confirmar: la retención ya no era válida');
      await compensate(code === 'SPACE_TAKEN' ? 'SPACE_TAKEN' : 'HOLD_EXPIRED');
      throw new AppError(code === 'SPACE_TAKEN' ? 'SPACE_TAKEN' : 'HOLD_EXPIRED', 409, { failedStep: 'T13', alternatives: await alternatives(space, input.vehicle, slot, user) });
    }
    const r = await loadReservation(db, reservationId);
    await saga.step(sagaId, 'T13', 'ok', `Reserva ${r.code} confirmada`);
    await saga.step(sagaId, 'async', 'info', 'Notificaciones y actualización del panel fuera de T0');
    await saga.finish(sagaId, 'committed', { reservationId });
    return reservationDTO(r, user);
  }

  return {
    reservationDTO,
    loadReservation,

    async createReservation(req, input, scenario = 'none') {
      const user = req.user;
      const hash = sha256(JSON.stringify([input.spaceId, input.vehicle, input.vehicleId || null, input.paymentMethodId || null, new Date(input.startAt).toISOString(), input.durationMin]));
      const claim = await claimKey(user.id, input.idempotencyKey, hash);
      if (!claim.fresh) {
        // Reintento con la misma llave: devuelve el resultado original (sin doble cobro).
        const { response_status: status, response_body: body } = claim.row;
        if (status === 201) {
          const r = await loadReservation(db, body.id);
          return { replayed: true, reservation: reservationDTO(r, user) };
        }
        throw new AppError(body.code, status, body.details || {});
      }
      const space = await db.one('SELECT name FROM spaces WHERE id = $1', [input.spaceId]);
      const sagaId = await saga.start(user.id, input.idempotencyKey, space ? input.spaceId : null, {
        space: space?.name || input.spaceId,
        vehicle: input.vehicle,
        startAt: input.startAt,
        durationMin: input.durationMin,
        idempotencyKey: input.idempotencyKey,
        scenario: scenario !== 'none' ? scenario : undefined,
      });
      try {
        const reservation = await runT0(req, input, scenario, sagaId);
        await completeKey(user.id, input.idempotencyKey, 201, { id: reservation.id });
        return { replayed: false, reservation };
      } catch (err) {
        const appErr = err instanceof AppError ? err : null;
        if (appErr) {
          const st = await db.one('SELECT status FROM sagas WHERE id = $1', [sagaId]);
          if (st.status === 'running') await saga.finish(sagaId, 'aborted', { failedStep: appErr.details?.failedStep || 'VALIDATION', errorCode: appErr.code });
          await completeKey(user.id, input.idempotencyKey, appErr.status, { code: appErr.code, details: appErr.details });
        } else {
          logger.error('saga.unexpected', { err, sagaId });
          await saga.step(sagaId, 'T0', 'fail', 'Error interno: el barrido revisará retenciones y pagos pendientes').catch(() => {});
          await saga.finish(sagaId, 'aborted', { failedStep: 'INTERNAL', errorCode: 'INTERNAL' }).catch(() => {});
          await completeKey(user.id, input.idempotencyKey, 500, { code: 'INTERNAL', details: {} }).catch(() => {});
        }
        throw err;
      }
    },

    async attempts(req, key) {
      const sagas = (await db.query('SELECT * FROM sagas WHERE user_id = $1 AND idempotency_key = $2 ORDER BY started_at DESC LIMIT 1', [req.user.id, key])).rows;
      if (!sagas.length) throw notFound();
      const steps = (await db.query('SELECT step, status, detail, at FROM saga_steps WHERE saga_id = $1 ORDER BY id', [sagas[0].id])).rows;
      return { id: sagas[0].id, status: sagas[0].status, failedStep: sagas[0].failed_step, errorCode: sagas[0].error_code, reservationId: sagas[0].reservation_id, steps };
    },

    async myReservations(req, { scope } = {}) {
      const statuses = scope === 'current' ? CURRENT_STATUSES : scope === 'history' ? HISTORY_STATUSES : [...CURRENT_STATUSES, ...HISTORY_STATUSES];
      const ids = (await db.query('SELECT id FROM reservations WHERE driver_id = $1 AND status = ANY($2) ORDER BY lower(period) DESC LIMIT 200', [req.user.id, statuses])).rows;
      const out = [];
      for (const { id } of ids) out.push(reservationDTO(await loadReservation(db, id), req.user));
      return out;
    },

    async getReservation(req, id) {
      return reservationDTO(await getVisible(db, id, req.user), req.user);
    },

    async listForSpaces(viewer, spaceIds, { status, from, to, code } = {}) {
      const params = [spaceIds];
      let where = "r.space_id = ANY($1) AND r.status NOT IN ('pending_payment', 'failed')";
      if (status) {
        params.push(status.split(','));
        where += ` AND r.status = ANY($${params.length})`;
      }
      if (from) {
        params.push(from);
        where += ` AND upper(r.period) >= $${params.length}::timestamptz`;
      }
      if (to) {
        params.push(to);
        where += ` AND lower(r.period) < $${params.length}::timestamptz`;
      }
      if (code) {
        params.push(code.trim().toUpperCase());
        where += ` AND r.code = $${params.length}`;
      }
      const ids = (await db.query(`SELECT r.id FROM reservations r WHERE ${where} ORDER BY lower(r.period) DESC LIMIT 300`, params)).rows;
      const out = [];
      for (const { id } of ids) out.push(reservationDTO(await loadReservation(db, id), viewer));
      return out;
    },

    // Cancelación por el conductor. [supuesto] Reembolso total antes de la hora de llegada.
    async cancel(req, id, { reason } = {}) {
      const r0 = await db.tx(async (client) => {
        const r = await getVisible(client, id, req.user, { forUpdate: true });
        if (r.driver_id !== req.user.id) throw new AppError('FORBIDDEN', 403);
        const fresh = await loadReservation(client, id);
        if (!canTransition(fresh.status, 'cancelled')) throw new AppError('INVALID_STATE', 409, { status: fresh.status });
        const refund = refundFor({ startAt: fresh.start_at, amount: fresh.amount_cop });
        await client.query(
          `UPDATE reservations SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, refund_cop = $4, version = version + 1 WHERE id = $1`,
          [id, req.user.id, reason || null, refund]
        );
        if (refund > 0) {
          await client.query(`INSERT INTO ledger_entries (reservation_id, entry_type, account, amount_cop) VALUES ($1, 'refund', 'manager', $2)`, [id, -refund]);
          if (fresh.commission_cop > 0) {
            await client.query(
              `INSERT INTO ledger_entries (reservation_id, entry_type, account, amount_cop) VALUES ($1, 'commission_refund', 'platform', $2), ($1, 'commission_refund', 'manager', $3)`,
              [id, -fresh.commission_cop, fresh.commission_cop]
            );
          }
        }
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'reservation.cancelled', 'reservation', id, { refund });
        await changed(client, fresh);
        return { ...fresh, refund };
      });
      // El reembolso se ejecuta después de confirmar la cancelación; si la pasarela falla, el barrido
      // lo reintenta (payments.refunded_cop < reservations.refund_cop).
      if (r0.refund > 0) await this.settleRefund(id).catch((err) => logger.warn('refund.deferred', { err, reservationId: id }));
      return this.getReservation(req, id);
    },

    async settleRefund(reservationId) {
      const p = await db.one(
        `SELECT p.*, r.refund_cop FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.reservation_id = $1 AND p.status = 'captured' AND r.refund_cop > p.refunded_cop`,
        [reservationId]
      );
      if (!p) return false;
      await payments.refund(p.id, { ref: p.provider_ref, amountCop: p.refund_cop, idempotencyKey: `${p.idempotency_key}:cancel` });
      await payments.setStatus(p.id, p.refund_cop >= p.captured_cop ? 'refunded' : 'partially_refunded', { refunded: p.refund_cop });
      return true;
    },

    async checkIn(req, id) {
      await db.tx(async (client) => {
        const r = await getVisible(client, id, req.user, { forUpdate: true });
        const fresh = await loadReservation(client, id);
        if (!canTransition(fresh.status, 'active')) throw new AppError('INVALID_STATE', 409, { status: fresh.status });
        const w = checkInWindow(fresh.start_at, limits);
        const now = Date.now();
        if (now < w.from) throw new AppError('TOO_EARLY', 409, { from: new Date(w.from).toISOString() });
        if (now > w.until) throw new AppError('TOO_LATE', 409, { until: new Date(w.until).toISOString() });
        await client.query(`UPDATE reservations SET status = 'active', check_in_at = now(), version = version + 1 WHERE id = $1`, [id]);
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'reservation.check_in', 'reservation', id, { by: r.driver_id === req.user.id ? 'driver' : 'manager' });
        await changed(client, fresh);
      });
      return this.getReservation(req, id);
    },

    async checkOut(req, id) {
      await db.tx(async (client) => {
        const r = await getVisible(client, id, req.user, { forUpdate: true });
        const fresh = await loadReservation(client, id);
        if (!canTransition(fresh.status, 'completed')) throw new AppError('INVALID_STATE', 409, { status: fresh.status });
        const overstayMin = Math.max(0, Math.floor((Date.now() - new Date(fresh.end_at).getTime()) / 60000));
        await client.query(`UPDATE reservations SET status = 'completed', check_out_at = now(), version = version + 1 WHERE id = $1`, [id]);
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'reservation.check_out', 'reservation', id, { by: r.driver_id === req.user.id ? 'driver' : 'manager', overstayMin });
        await changed(client, fresh);
      });
      return this.getReservation(req, id);
    },

    // Cambio de franja: misma duración y mismo precio; el trigger revalida el cupo en la nueva franja.
    async reschedule(req, id, { startAt }) {
      await db.tx(async (client) => {
        const r = await getVisible(client, id, req.user, { forUpdate: true });
        if (r.driver_id !== req.user.id) throw new AppError('FORBIDDEN', 403);
        const fresh = await loadReservation(client, id);
        if (fresh.status !== 'confirmed' || new Date(fresh.start_at).getTime() <= Date.now()) throw new AppError('INVALID_STATE', 409, { status: fresh.status });
        const durationMin = Math.round((new Date(fresh.end_at) - new Date(fresh.start_at)) / 60000);
        const fields = validateBookingWindow({ startAt, durationMin }, Date.now(), limits);
        if (Object.keys(fields).length) throw validationError(fields);
        const space = await loadSpace(client, fresh.space_id);
        const slot = slotFrom({ startAt, durationMin });
        const issue = scheduleIssueWeekly(space.weekly, space.timezone, slot.start, slot.end);
        if (issue) throw new AppError('OUTSIDE_SCHEDULE', 409, { reason: issue });
        try {
          await client.query('SAVEPOINT resched');
          await client.query(`UPDATE reservations SET period = tstzrange($2, $3, '[)'), version = version + 1 WHERE id = $1`, [id, new Date(slot.start).toISOString(), new Date(slot.end).toISOString()]);
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT resched');
          if (err.code === 'TE001') throw new AppError('SPACE_TAKEN', 409, { alternatives: [] });
          throw err;
        }
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'reservation.rescheduled', 'reservation', id, { from: fresh.start_at, to: new Date(slot.start).toISOString() });
        await changed(client, fresh);
      });
      return this.getReservation(req, id);
    },
  };
}
