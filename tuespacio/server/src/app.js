// Composición de la aplicación: configuración → base de datos → servicios → HTTP.
// Sin estado en memoria que importe entre peticiones (sesiones, retenciones, idempotencia y límites
// viven en PostgreSQL), por lo que se pueden correr varias réplicas detrás de un balanceador.
import express from 'express';
import { createDb } from './db/pool.js';
import { createLogger } from './logger.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { cors, requestContext, securityHeaders } from './http/security.js';
import { memoryStore, postgresStore } from './http/rateLimit.js';
import { buildRouter } from './routes.js';
import { openapi } from './openapi.js';
import { createAuthService } from './modules/auth/service.js';
import { createCatalogService } from './modules/catalog/service.js';
import { createPayments } from './modules/payments/index.js';
import { createReservationService } from './modules/reservations/service.js';
import { createPanelService } from './modules/panel/service.js';
import { createSyncService } from './modules/sync/service.js';
import { createDemoService } from './modules/demo/service.js';
import { createSweeper } from './jobs/sweeper.js';

export async function createApp(config, { logger = createLogger(config.logLevel), db: injectedDb } = {}) {
  const db = injectedDb || createDb(config, logger);
  // Los triggers leen estos parámetros: se sincronizan desde la configuración en cada arranque.
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ('walk_in_horizon_min', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(config.booking.walkInHorizonMin)]
  );

  const payments = createPayments({ db, config, logger });
  const auth = createAuthService({ db, config });
  const catalog = createCatalogService({ db, config });
  const reservations = createReservationService({ db, config, payments, catalog, logger });
  const panel = createPanelService({ db, config, catalog, reservations });
  const sync = createSyncService({ db });
  const sweeper = createSweeper({ db, config, logger, payments, reservations });
  const demo = createDemoService({ db, config, sweeper });
  const services = { auth, catalog, reservations, panel, sync, demo, payments };
  const limiterStore = config.rateLimit.store === 'postgres' ? postgresStore(db) : memoryStore();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);
  app.use(requestContext(logger));
  app.use(securityHeaders(config));
  app.use(cors(config));
  app.use(express.json({ limit: '64kb', strict: true }));
  app.get('/openapi.json', (req, res) => res.json(openapi(config)));
  app.use(buildRouter({ config, db, services, limiterStore }));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return { app, db, services, sweeper, limiterStore, logger };
}
