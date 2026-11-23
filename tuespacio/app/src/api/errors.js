// Error de API con el mismo formato que devolvería el backend real:
// { "error": { "code": "SPACE_TAKEN", "message": "...", "details": { ... } } }
export class ApiError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ERROR_COPY = {
  NETWORK: { title: 'Sin conexión', message: 'No pudimos comunicarnos con el servidor. Revisa tu conexión e inténtalo de nuevo.' },
  SPACE_TAKEN: { title: 'El cupo ya fue tomado', message: 'Otro conductor reservó el último cupo hace un instante. No se realizó ningún cobro.' },
  PAYMENT_DECLINED: { title: 'Pago rechazado', message: 'El medio de pago no autorizó la operación. Liberamos el cupo y no se realizó ningún cobro.' },
  GATEWAY_TIMEOUT: { title: 'La pasarela no respondió', message: 'Reintentamos sin duplicar el cobro, pero no hubo respuesta. Liberamos el cupo y no se realizó ningún cobro.' },
};

export function describeError(error) {
  if (!error) return null;
  return ERROR_COPY[error.code] || { title: 'Algo salió mal', message: error.message || 'Inténtalo de nuevo.' };
}
