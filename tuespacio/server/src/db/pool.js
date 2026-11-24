// Acceso a PostgreSQL. `tx` ejecuta una función dentro de una transacción y reintenta ante
// fallas de serialización o interbloqueos (40001, 40P01), que son seguras de repetir.
import pg from 'pg';

// timestamptz → string ISO; int8/numeric → number (los montos son enteros COP pequeños).
pg.types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const RETRYABLE = new Set(['40001', '40P01']);

export function createDb(config, logger) {
  const pool = new pg.Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    ssl: config.db.ssl,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    application_name: 'tu-espacio-api',
  });
  pool.on('error', (err) => logger?.error('db.pool_error', { err }));

  async function tx(fn, { retries = 3 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (RETRYABLE.has(err.code) && attempt < retries) continue;
        throw err;
      } finally {
        client.release();
      }
    }
  }

  return {
    pool,
    query: (text, params) => pool.query(text, params),
    one: async (text, params) => (await pool.query(text, params)).rows[0] || null,
    tx,
    close: () => pool.end(),
  };
}
