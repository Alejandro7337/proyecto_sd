// Punto de entrada del servidor. Migra (opcional), inicia HTTP y el barrido, y se apaga ordenadamente.
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { seedDemo } from './db/seed.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const { app, db, sweeper } = await createApp(config, { logger }).catch(async (err) => {
  // Primer arranque: si las tablas no existen aún y MIGRATE_ON_START=true, migra y reintenta.
  if (process.env.MIGRATE_ON_START === 'true' && err.code === '42P01') {
    const { createDb } = await import('./db/pool.js');
    const tmp = createDb(config, logger);
    await runMigrations(tmp.pool, (m) => logger.info('migrate', { m }));
    await tmp.close();
    return createApp(config, { logger });
  }
  throw err;
});

if (process.env.MIGRATE_ON_START === 'true') await runMigrations(db.pool, (m) => logger.info('migrate', { m }));
if (process.env.SEED_ON_START === 'true' && !config.isProd) {
  await db.tx((client) => seedDemo(client)).then((r) => logger.info('seed', r));
}
if (config.sweeper.enabled) sweeper.start();

const server = app.listen(config.port, () => {
  logger.info('server.started', {
    port: config.port,
    env: config.env,
    payments: config.payments.provider,
    live: config.payments.live,
    demoTools: config.demo.enabled,
  });
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('server.stopping', { signal });
  sweeper.stop();
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('process.unhandled_rejection', { err }));
