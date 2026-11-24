// Errores normalizados de pasarela. Cada adaptador traduce las respuestas de su proveedor a estos códigos;
// el resto del sistema nunca ve mensajes crudos del proveedor (mensajes seguros para el usuario).
export class PaymentError extends Error {
  constructor(kind, providerRef = null) {
    super(`payment:${kind}`);
    this.kind = kind; // DECLINED | TIMEOUT | UNAVAILABLE | INVALID
    this.providerRef = providerRef;
    this.retryable = kind === 'TIMEOUT' || kind === 'UNAVAILABLE';
  }
}
