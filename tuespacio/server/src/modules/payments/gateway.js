// Adaptador PREPARADO para una pasarela real (proveedor por definir: ver docs/DECISIONES pendientes).
// Habla un contrato REST genérico (autorizar, capturar, anular, reembolsar) con:
//   · llave de idempotencia por operación (cabecera Idempotency-Key),
//   · firma HMAC-SHA256 del cuerpo con PAYMENT_GATEWAY_SECRET (nunca se registra),
//   · timeout por intento (los reintentos los hace payments/index.js con la MISMA llave).
// No está certificado contra ningún proveedor: al elegirlo hay que mapear sus rutas y códigos aquí.
// Solo se activa con PAYMENT_PROVIDER=gateway; el cobro real exige además PAYMENTS_LIVE=true.
import { createHmac } from 'node:crypto';
import { PaymentError } from './errors.js';

export function createGatewayAdapter({ url, keyId, secret, live, timeoutMs }) {
  async function call(path, body, idempotencyKey) {
    const payload = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    let res;
    try {
      res = await fetch(new URL(path, url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Key-Id': keyId,
          'X-Signature': signature,
          'X-Live-Mode': live ? 'true' : 'false',
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new PaymentError(err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE');
    }
    const json = await res.json().catch(() => ({}));
    if (res.status === 402 || json.status === 'declined') throw new PaymentError('DECLINED', json.id || null);
    if (res.status >= 500 || res.status === 429) throw new PaymentError('UNAVAILABLE');
    if (!res.ok) throw new PaymentError('INVALID');
    return json;
  }

  return {
    name: 'gateway',
    live,
    async authorize({ amountCop, idempotencyKey, methodToken }) {
      const r = await call('/v1/authorizations', { amount: amountCop, currency: 'COP', payment_method: methodToken, capture: false }, idempotencyKey);
      return { ref: r.id, status: 'authorized' };
    },
    async capture({ ref, amountCop, idempotencyKey }) {
      await call(`/v1/authorizations/${encodeURIComponent(ref)}/capture`, { amount: amountCop }, idempotencyKey);
      return { ref, status: 'captured' };
    },
    async void({ ref, idempotencyKey }) {
      await call(`/v1/authorizations/${encodeURIComponent(ref)}/void`, {}, idempotencyKey);
      return { ref, status: 'voided' };
    },
    async refund({ ref, amountCop, idempotencyKey }) {
      const r = await call('/v1/refunds', { authorization: ref, amount: amountCop }, idempotencyKey);
      return { ref: r.id, status: 'refunded' };
    },
  };
}
