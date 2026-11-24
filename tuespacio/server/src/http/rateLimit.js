// Límite de peticiones por ventana fija. Store 'memory' (una instancia) o 'postgres' (compartido entre
// réplicas: correcto con escala horizontal, un UPSERT por petición limitada).
import { sha256 } from '../lib/crypto.js';
import { AppError } from './errors.js';

export function memoryStore() {
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  }, 60000);
  timer.unref?.();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || b.reset <= now) {
        const fresh = { count: 1, reset: now + windowMs };
        buckets.set(key, fresh);
        return fresh;
      }
      b.count += 1;
      return b;
    },
    reset: () => buckets.clear(),
  };
}

export function postgresStore(db) {
  return {
    async hit(key, windowMs) {
      const start = Math.floor(Date.now() / windowMs) * windowMs;
      const row = await db.one(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, to_timestamp($2 / 1000.0), 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
           window_start = EXCLUDED.window_start
         RETURNING count`,
        [key, start]
      );
      return { count: row.count, reset: start + windowMs };
    },
    reset: () => db.query('DELETE FROM rate_limits'),
  };
}

// keyFn(req) → string | string[] (por IP, por correo, por usuario…). Se guarda solo un hash.
export function rateLimit({ store, name, max, windowMs = 60000, keyFn = (req) => req.ip }) {
  return async (req, res, next) => {
    try {
      const raw = [].concat(keyFn(req)).filter(Boolean);
      for (const k of raw) {
        const { count, reset } = await store.hit(`${name}:${sha256(k).slice(0, 32)}`, windowMs);
        res.set({ 'RateLimit-Limit': String(max), 'RateLimit-Remaining': String(Math.max(0, max - count)), 'RateLimit-Reset': String(Math.ceil((reset - Date.now()) / 1000)) });
        if (count > max) {
          return next(new AppError('RATE_LIMITED', 429, { retryAfterSec: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) }));
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
