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
  HOLD_EXPIRED: { title: 'La retención venció', message: 'El pago tardó más que la retención del cupo. Anulamos la preautorización y no se realizó ningún cobro.' },
  OUTSIDE_SCHEDULE: { title: 'Fuera del horario', message: 'El espacio no atiende en la franja elegida. Cambia la hora de llegada o la duración.' },
  TIMEOUT: { title: 'El servidor no respondió', message: 'La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo.' },
  TOKEN_EXPIRED: { title: 'Tu sesión expiró', message: 'Por seguridad cerramos tu sesión. Inicia sesión de nuevo.' },
  UNAUTHORIZED: { title: 'Inicia sesión', message: 'Tu sesión no es válida. Inicia sesión de nuevo.' },
  FORBIDDEN: { title: 'Sin acceso', message: 'Tu perfil no tiene acceso a esta información.' },
  CONFIG: { title: 'Configuración incompleta', message: 'La app no tiene un servidor configurado. Revisa las variables EXPO_PUBLIC_* (docs/ENVIRONMENT.md).' },
};

export function describeError(error) {
  if (!error) return null;
  const copy = ERROR_COPY[error.code];
  // Para OUTSIDE_SCHEDULE el servidor explica el motivo concreto (antes de abrir, después de cerrar…).
  if (copy && error.code === 'OUTSIDE_SCHEDULE' && error.message) return { ...copy, message: error.message + ' ' + copy.message };
  return copy || { title: 'Algo salió mal', message: error.message || 'Inténtalo de nuevo.' };
}
