// Errores de la API y manejador centralizado. Formato de respuesta (docs/API.md):
//   { "error": { "code": "SPACE_TAKEN", "message": "...", "details": { ... }, "requestId": "..." } }
// Los mensajes se traducen según Accept-Language (es/en). Nunca se filtran trazas ni SQL al cliente.
import { message, translateFields } from '../../../app/src/domain/messages.js';

export class AppError extends Error {
  constructor(code, status = 400, details = {}, params = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
    this.params = params;
  }
}

export const validationError = (fields, params = {}) => new AppError('VALIDATION', 422, { fields }, params);
export const notFound = (code = 'NOT_FOUND') => new AppError(code, 404);
export const forbidden = (code = 'FORBIDDEN') => new AppError(code, 403);
export const conflict = (code, details = {}, params = {}) => new AppError(code, 409, details, params);

// Traduce errores de PostgreSQL a errores de dominio.
export function fromDatabase(err) {
  switch (err.code) {
    case 'TE001':
      return new AppError('SPACE_TAKEN', 409);
    case 'TE002':
      return new AppError('CAPACITY_BELOW_USE', 409, { fields: { capacity: 'CAPACITY_BELOW_USE' } });
    case '23P01':
      return new AppError('OVERLAPPING_RESERVATION', 409);
    case '23505':
      return new AppError('CONFLICT', 409);
    case '23503':
      return new AppError('NOT_FOUND', 404);
    case '23514':
      return new AppError('VALIDATION', 422, { constraint: err.constraint });
    case '57014':
    case 'ECONNREFUSED':
    case '57P01':
    case '53300':
      return new AppError('SERVICE_UNAVAILABLE', 503);
    default:
      return null;
  }
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const lang = req.lang || 'es';
    let e = err instanceof AppError ? err : null;
    if (!e && err?.type === 'entity.parse.failed') e = new AppError('BAD_REQUEST', 400);
    if (!e && err?.type === 'entity.too.large') e = new AppError('PAYLOAD_TOO_LARGE', 413);
    if (!e && err?.code) e = fromDatabase(err);
    if (!e) {
      logger.error('request.unhandled', { err, requestId: req.id, route: req.route?.path, method: req.method });
      e = new AppError('INTERNAL', 500);
    } else if (e.status >= 500) {
      logger.warn('request.degraded', { code: e.code, requestId: req.id, err });
    }
    const details = { ...e.details };
    if (details.fields) details.fields = translateFields(details.fields, lang, e.params.fields || {});
    if (e.status === 429 && details.retryAfterSec) res.set('Retry-After', String(details.retryAfterSec));
    if (e.status === 503) res.set('Retry-After', '10');
    res.status(e.status).json({
      error: {
        code: e.code,
        message: message(e.code, lang, e.params),
        details,
        requestId: req.id,
      },
    });
  };
}

export const notFoundHandler = (req, res, next) => next(new AppError('NOT_FOUND', 404, { path: req.path }));

// Envuelve controladores async (Express 5 ya propaga promesas rechazadas; se deja explícito).
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
