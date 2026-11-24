// Pasarela SIMULADA. No mueve dinero ni contacta a nadie. Imita lo que importa de una pasarela real:
// idempotencia del lado del proveedor (la misma llave devuelve el mismo resultado), latencia,
// rechazos y falta de respuesta. El resultado depende del medio de pago ficticio elegido:
//   approve · decline · timeout · timeout_then_approve (primer intento sin respuesta, luego aprueba)
import { randomBytes } from 'node:crypto';
import { PaymentError } from './errors.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`;

export function createSimulatedGateway({ db, latencyMs = 250 }) {
  async function previous(key) {
    return db.one('SELECT * FROM sim_gateway_operations WHERE idempotency_key = $1', [key]);
  }
  async function save(key, operation, providerRef, status, amount) {
    await db.query(
      `INSERT INTO sim_gateway_operations (idempotency_key, operation, provider_ref, status, amount_cop) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, provider_ref = EXCLUDED.provider_ref, attempts = sim_gateway_operations.attempts + 1`,
      [key, operation, providerRef, status, amount]
    );
  }

  return {
    name: 'simulated',
    live: false,

    async authorize({ amountCop, behavior = 'approve', idempotencyKey }) {
      await sleep(latencyMs);
      const prev = await previous(idempotencyKey);
      if (prev?.status === 'authorized') return { ref: prev.provider_ref, status: 'authorized', replayed: true };
      if (prev?.status === 'declined') throw new PaymentError('DECLINED', prev.provider_ref);
      if (behavior === 'decline') {
        const r = ref('sim_dec');
        await save(idempotencyKey, 'authorize', r, 'declined', amountCop);
        throw new PaymentError('DECLINED', r);
      }
      if (behavior === 'timeout') {
        await save(idempotencyKey, 'authorize', 'none', 'no_response', amountCop);
        await sleep(latencyMs);
        throw new PaymentError('TIMEOUT');
      }
      if (behavior === 'timeout_then_approve' && !prev) {
        await save(idempotencyKey, 'authorize', 'none', 'no_response', amountCop);
        throw new PaymentError('TIMEOUT');
      }
      const r = ref('sim_auth');
      await save(idempotencyKey, 'authorize', r, 'authorized', amountCop);
      return { ref: r, status: 'authorized' };
    },

    async capture({ ref: authRef, amountCop, idempotencyKey, behavior }) {
      await sleep(Math.round(latencyMs / 2));
      const prev = await previous(idempotencyKey);
      if (prev?.status === 'captured') return { ref: prev.provider_ref, status: 'captured', replayed: true };
      if (behavior === 'capture_timeout') {
        await save(idempotencyKey, 'capture', authRef, 'no_response', amountCop);
        throw new PaymentError('TIMEOUT');
      }
      await save(idempotencyKey, 'capture', authRef, 'captured', amountCop);
      return { ref: authRef, status: 'captured' };
    },

    async void({ ref: authRef, idempotencyKey }) {
      await sleep(Math.round(latencyMs / 2));
      await save(idempotencyKey, 'void', authRef, 'voided', null);
      return { ref: authRef, status: 'voided' };
    },

    async refund({ ref: authRef, amountCop, idempotencyKey }) {
      await sleep(Math.round(latencyMs / 2));
      const prev = await previous(idempotencyKey);
      if (prev?.status === 'refunded') return { ref: prev.provider_ref, status: 'refunded', replayed: true };
      const r = ref('sim_ref');
      await save(idempotencyKey, 'refund', r, 'refunded', amountCop);
      return { ref: r, status: 'refunded', authRef };
    },
  };
}
