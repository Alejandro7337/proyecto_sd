// Migraciones versionadas: archivos NNN_nombre.sql en ./migrations, aplicados en orden, cada uno en
// su transacción, con checksum (si un archivo ya aplicado cambia, se detiene). Un bloqueo consultivo
// evita que dos instancias migren a la vez al desplegar varias réplicas. Es idempotente.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 727274001;

export async function runMigrations(pool, log = () => {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));
    const files = (await readdir(DIR)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
    const done = [];
    for (const file of files) {
      const version = file.slice(0, 3);
      const sql = await readFile(path.join(DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(version)) {
        if (applied.get(version) !== checksum) {
          throw new Error(`La migración ${file} cambió después de aplicarse (checksum distinto). Crea una migración nueva.`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [version, file, checksum]);
        await client.query('COMMIT');
        log(`migración aplicada: ${file}`);
        done.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${file}: ${err.message}`);
      }
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Define DATABASE_URL (ver server/.env.example)');
    process.exit(1);
  }
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : process.env.DATABASE_SSL === 'no-verify' ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString: url, ssl });
  runMigrations(pool, console.log)
    .then((done) => console.log(done.length ? `${done.length} migración(es) aplicada(s)` : 'Esquema al día: nada que aplicar'))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
