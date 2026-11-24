// Barrido periódico. Seguro con varias réplicas: cada tarea toma filas con FOR UPDATE SKIP LOCKED o
// usa actualizaciones condicionales, así dos instancias nunca procesan lo mismo.
//  1. Vence retenciones caducadas (libera el cupo de forma explícita para auditoría).
//  2. Recupera sagas colgadas (caída del servidor a mitad de T0): anula autorizaciones y libera cupo.
//  3. Marca como vencidas las reservas confirmadas sin llegada (no-show).
//  4. Reintenta reembolsos pendientes de cancelaciones.
//  5. Limpia datos efímeros (sesiones, límites, feed de cambios, llaves de idempotencia viejas).
import { audit, recordChange } from '../modules/audit/service.js';

export function createSweeper({ db, config, logger, payments, reservations }) {
  const sys = { id: null, role: 'system', requestId: 'sweeper' };

  async function expireHolds() {
    const rows = (
      await db.query(`UPDATE holds SET status = 'expired', released_at = now(), release_reason = 'expired'
                       WHERE id IN (SELECT id FROM holds WHERE status = 'active' AND expires_at < now() - interval '30 seconds' FOR UPDATE SKIP LOCKED)
                       RETURNING space_id, reservation_id`)
    ).rows;
    for (const r of rows) await recordChange(db, 'space', r.space_id);
    return rows.length;
  }

  async function recoverStuckSagas() {
    let n = 0;
    const stuck = (await db.query(`SELECT id, reservation_id, user_id, idempotency_key FROM sagas WHERE status = 'running' AND started_at < now() - interval '15 minutes' LIMIT 20`)).rows;
    for (const s of stuck) {
      const claimed = await db.query(`UPDATE sagas SET status = 'aborted', failed_step = 'RECOVERY', error_code = 'INTERNAL', finished_at = clock_timestamp() WHERE id = $1 AND status = 'running'`, [s.id]);
      if (!claimed.rowCount) continue;
      n += 1;
      if (s.reservation_id) {
        const p = await db.one(`SELECT * FROM payments WHERE reservation_id = $1`, [s.reservation_id]);
        try {
          if (p?.status === 'authorized') {
            await payments.void(p.id, { ref: p.provider_ref, idempotencyKey: p.idempotency_key });
            await payments.setStatus(p.id, 'voided');
          } else if (p?.status === 'captured') {
            const r = await db.one(`SELECT status FROM reservations WHERE id = $1`, [s.reservation_id]);
            if (r.status === 'pending_payment') {
              await payments.refund(p.id, { ref: p.provider_ref, amountCop: p.captured_cop, idempotencyKey: p.idempotency_key });
              await payments.setStatus(p.id, 'refunded', { refunded: p.captured_cop });
            }
          }
        } catch (err) {
          logger.error('sweeper.recovery_payment_failed', { err, sagaId: s.id });
        }
        await db.tx(async (client) => {
          await client.query(`UPDATE holds SET status = 'released', released_at = now(), release_reason = 'recovery' WHERE reservation_id = $1 AND status IN ('active', 'expired')`, [s.reservation_id]);
          await client.query(`UPDATE reservations SET status = 'failed' WHERE id = $1 AND status = 'pending_payment'`, [s.reservation_id]);
          await audit(client, sys, 'saga.recovered', 'reservation', s.reservation_id, { sagaId: s.id });
        });
      }
      await db.query('INSERT INTO saga_steps (saga_id, step, status, detail) VALUES ($1, $2, $3, $4)', [s.id, 'RECOVERY', 'comp', 'Saga interrumpida: autorización anulada y cupo liberado por el barrido']);
      await db.query(
        `UPDATE idempotency_keys SET status = 'completed', response_status = 500, response_body = '{"code":"INTERNAL","details":{}}', locked_until = NULL
          WHERE user_id = $1 AND key = $2 AND status = 'processing'`,
        [s.user_id, s.idempotency_key]
      );
    }
    return n;
  }

  async function expireNoShows() {
    const rows = (
      await db.query(
        `UPDATE reservations SET status = 'expired', expired_at = now(), version = version + 1
          WHERE id IN (SELECT id FROM reservations WHERE status = 'confirmed' AND lower(period) + make_interval(mins => $1) < now() FOR UPDATE SKIP LOCKED)
          RETURNING id, space_id, driver_id`,
        [config.booking.noShowGraceMin]
      )
    ).rows;
    for (const r of rows) {
      await audit(db, sys, 'reservation.expired', 'reservation', r.id, {});
      await recordChange(db, 'space', r.space_id);
      await recordChange(db, 'reservation', r.id, r.driver_id);
    }
    return rows.length;
  }

  async function retryRefunds() {
    const rows = (
      await db.query(`SELECT r.id FROM reservations r JOIN payments p ON p.reservation_id = r.id
                       WHERE r.status = 'cancelled' AND r.refund_cop > p.refunded_cop AND p.status = 'captured' LIMIT 20`)
    ).rows;
    let n = 0;
    for (const r of rows) if (await reservations.settleRefund(r.id).catch(() => false)) n += 1;
    return n;
  }

  async function cleanup() {
    await db.query(`DELETE FROM sessions WHERE refresh_expires_at < now() - interval '7 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`);
    await db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'`);
    await db.query(`DELETE FROM change_log WHERE at < now() - interval '1 day'`);
    await db.query(`DELETE FROM idempotency_keys WHERE status = 'completed' AND created_at < now() - interval '2 days'`);
    await db.query(`DELETE FROM password_resets WHERE created_at < now() - interval '2 days'`);
  }

  async function runOnce() {
    const out = { holds: await expireHolds(), sagas: await recoverStuckSagas(), noShows: await expireNoShows(), refunds: await retryRefunds() };
    await cleanup();
    if (out.holds || out.sagas || out.noShows || out.refunds) logger.info('sweeper.run', out);
    return out;
  }

  let timer = null;
  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => runOnce().catch((err) => logger.error('sweeper.failed', { err })), config.sweeper.intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
