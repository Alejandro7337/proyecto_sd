// Cabeceras seguras, CORS con lista blanca, identificador de solicitud, idioma y log de acceso.
import { randomUUID } from 'node:crypto';
import { pickLanguage } from '../../../app/src/domain/messages.js';
import { sha256 } from '../lib/crypto.js';
import { AppError } from './errors.js';

export function securityHeaders(config) {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-site',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
      'Cache-Control': 'no-store',
    });
    if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// La app móvil nativa no envía Origin (CORS no aplica). Para la versión web se permite solo la lista
// CORS_ORIGINS; en desarrollo además localhost. No se usan cookies: credentials = false.
export function cors(config) {
  const allowed = new Set(config.corsOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const ok = allowed.has(origin) || (!config.isProd && DEV_ORIGIN.test(origin));
      if (!ok) {
        if (req.method === 'OPTIONS') return res.status(403).end();
        return next(new AppError('CORS_REJECTED', 403));
      }
      res.set({
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key,Accept-Language,X-Request-Id,X-Demo-Scenario,X-Demo-Token',
        'Access-Control-Expose-Headers': 'X-Request-Id,Retry-After,RateLimit-Limit,RateLimit-Remaining,RateLimit-Reset',
        'Access-Control-Max-Age': '600',
      });
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

export function requestContext(logger) {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.lang = pickLanguage(req.headers['accept-language']);
    res.set('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('http', {
        requestId: req.id,
        method: req.method,
        route: (req.baseUrl || '') + (req.route?.path || req.path),
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1000000n),
        user: req.user?.id,
        // IP seudonimizada: suficiente para correlacionar abuso sin guardar el dato personal.
        ipHash: sha256(req.ip || '').slice(0, 12),
      });
    });
    next();
  };
}
