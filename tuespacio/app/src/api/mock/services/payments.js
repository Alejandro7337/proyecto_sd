// Servicio: Pagos y facturación — pasarela SIMULADA. No mueve dinero ni contacta proveedores.
import { delay, nextId } from '../db';
import { ApiError } from '../../errors';

const MAX_ATTEMPTS = 3;

export async function authorize({ amount, idempotencyKey, fault, log }) {
  if (fault === 'declined') {
    await delay(350);
    throw new ApiError('PAYMENT_DECLINED', 'Pago rechazado por el emisor (simulado).', 402, { failedStep: 'payment' });
  }
  if (fault === 'timeout') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await delay(300);
      log('T21', 'retry', `Intento ${attempt}/${MAX_ATTEMPTS} sin respuesta · llave ${idempotencyKey.slice(0, 8)}`);
    }
    throw new ApiError('GATEWAY_TIMEOUT', 'La pasarela no respondió (simulado).', 504, { failedStep: 'payment' });
  }
  await delay(350);
  return { id: nextId('auth'), amount };
}

// Compensación de T21: libera la preautorización sin que el dinero llegue a moverse.
export async function voidAuthorization(authId) {
  await delay(150);
  return { id: authId, status: 'voided' };
}

export async function capture(authId) {
  await delay(250);
  return { id: authId, status: 'captured' };
}

export async function refund(reservationId) {
  await delay(200);
  return { id: 'ref_' + reservationId, status: 'refunded' };
}
