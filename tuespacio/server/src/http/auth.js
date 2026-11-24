// Autenticación por token opaco (Authorization: Bearer te_at_…) y autorización por rol.
// Cada petición valida la sesión en la base: la revocación es inmediata y funciona con varias réplicas.
import { sha256 } from '../lib/crypto.js';
import { AppError } from './errors.js';

export function authenticate(db) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const match = /^Bearer\s+(te_at_[\w-]{20,})$/.exec(header);
      if (!header) return next();
      if (!match) throw new AppError('UNAUTHORIZED', 401);
      const row = await db.one(
        `SELECT s.id AS session_id, s.access_expires_at, s.revoked_at,
                u.id, u.role, u.name, u.email, u.status, u.plan, u.identity_status, u.must_change_password, u.preferences, u.created_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.access_hash = $1`,
        [sha256(match[1])]
      );
      if (!row) throw new AppError('UNAUTHORIZED', 401);
      if (row.revoked_at) throw new AppError('SESSION_REVOKED', 401);
      if (new Date(row.access_expires_at).getTime() <= Date.now()) throw new AppError('TOKEN_EXPIRED', 401);
      if (row.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 401);
      req.sessionId = row.session_id;
      req.user = row;
      // Marca de uso como máximo una vez por minuto (evita una escritura por petición).
      db.query("UPDATE sessions SET last_used_at = now() WHERE id = $1 AND last_used_at < now() - interval '1 minute'", [row.session_id]).catch(() => {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAuth = (req, res, next) => (req.user ? next() : next(new AppError('UNAUTHORIZED', 401)));

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError('UNAUTHORIZED', 401));
    if (!roles.includes(req.user.role)) return next(new AppError('FORBIDDEN', 403));
    next();
  };

export const actorOf = (req) => ({ id: req.user?.id || null, role: req.user?.role || null, requestId: req.id });
