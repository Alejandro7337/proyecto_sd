// Capa de pagos independiente. Elige el adaptador por configuración (simulado por defecto), aplica
// timeout + reintentos con la MISMA llave de idempotencia y deja un registro auditable de cada intento.
import { newId } from '../../lib/ids.js';
import { PaymentError } from './errors.js';
import { createSimulatedGateway } from './simulated.js';
import { createGatewayAdapter } from './gateway.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPayments({ db, config, logger }) {
  const p = config.payments;
  const adapter =
    p.provider === 'gateway'
      ? createGatewayAdapter({ ...p.gateway, live: p.live, timeoutMs: p.timeoutMs })
      : createSimulatedGateway({ db, latencyMs: p.simLatencyMs });

  async function event(paymentId, operation, outcome, attempt, idempotencyKey, extra = {}) {
    await db.query(
      `INSERT INTO payment_events (payment_id, operation, outcome, attempt, provider_ref, error_code, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [paymentId, operation, outcome, attempt, extra.ref || null, extra.error || null, idempotencyKey]
    );
  }

  function withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new PaymentError('TIMEOUT')), p.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Ejecuta una operación con reintentos. onRetry(attempt) permite registrar en la saga.
  async function run(paymentId, operation, idempotencyKey, fn, onRetry = () => {}) {
    let last;
    for (let attempt = 1; attempt <= p.maxAttempts; attempt += 1) {
      try {
        const result = await withTimeout(fn());
        await event(paymentId, operation, 'ok', attempt, idempotencyKey, { ref: result.ref });
        return result;
      } catch (err) {
        last = err instanceof PaymentError ? err : new PaymentError('UNAVAILABLE');
        if (!(err instanceof PaymentError)) logger.warn('payments.adapter_error', { err, operation });
        const outcome = last.kind === 'DECLINED' ? 'declined' : last.kind === 'TIMEOUT' ? 'timeout' : 'error';
        await event(paymentId, operation, outcome, attempt, idempotencyKey, { ref: last.providerRef, error: last.kind });
        if (!last.retryable || attempt === p.maxAttempts) break;
        await onRetry(attempt, last);
        await sleep(Math.min(100 * 2 ** (attempt - 1), 1000));
      }
    }
    throw last;
  }

  return {
    provider: adapter.name,
    live: adapter.live,

    async createPayment(client, { reservationId, methodId, amountCop, idempotencyKey }) {
      const id = newId('pay');
      await client.query(
        `INSERT INTO payments (id, reservation_id, provider, method_id, amount_cop, live, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
        [id, reservationId, adapter.name, methodId, amountCop, !!adapter.live, idempotencyKey]
      );
      return id;
    },

    async setStatus(paymentId, status, fields = {}) {
      await db.query(
        `UPDATE payments SET status = $2, provider_ref = COALESCE($3, provider_ref),
                captured_cop = COALESCE($4, captured_cop), refunded_cop = COALESCE($5, refunded_cop), updated_at = now()
          WHERE id = $1`,
        [paymentId, status, fields.ref ?? null, fields.captured ?? null, fields.refunded ?? null]
      );
    },

    authorize: (paymentId, args, onRetry) => run(paymentId, 'authorize', `${args.idempotencyKey}:auth`, () => adapter.authorize({ ...args, idempotencyKey: `${args.idempotencyKey}:auth` }), onRetry),
    capture: (paymentId, args, onRetry) => run(paymentId, 'capture', `${args.idempotencyKey}:capture`, () => adapter.capture({ ...args, idempotencyKey: `${args.idempotencyKey}:capture` }), onRetry),
    void: (paymentId, args) => run(paymentId, 'void', `${args.idempotencyKey}:void`, () => adapter.void({ ...args, idempotencyKey: `${args.idempotencyKey}:void` })),
    refund: (paymentId, args) => run(paymentId, 'refund', `${args.idempotencyKey}:refund`, () => adapter.refund({ ...args, idempotencyKey: `${args.idempotencyKey}:refund` })),
  };
}
