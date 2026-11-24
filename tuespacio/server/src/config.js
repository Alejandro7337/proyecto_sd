// Configuración por ambiente. Todo viene de variables de entorno (ver .env.example); nada secreto
// vive en el código. La validación es estricta: el servidor no arranca con una configuración insegura.
import { z } from 'zod';

const bool = (def) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));
const int = (def, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(8080, 1, 65535),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  DATABASE_POOL_MAX: int(10, 1, 200),
  DATABASE_SSL: z.enum(['false', 'true', 'no-verify']).default('false'),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default('false'),
  ACCESS_TOKEN_TTL_MIN: int(15, 1, 24 * 60),
  REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
  PASSWORD_RESET_TTL_MIN: int(30, 5, 24 * 60),
  MAIL_PROVIDER: z.enum(['outbox', 'disabled']).default('outbox'),
  PAYMENT_PROVIDER: z.enum(['simulated', 'gateway']).default('simulated'),
  PAYMENTS_LIVE: bool(false),
  PAYMENT_GATEWAY_URL: z.string().default(''),
  PAYMENT_GATEWAY_KEY_ID: z.string().default(''),
  PAYMENT_GATEWAY_SECRET: z.string().default(''),
  PAYMENT_TIMEOUT_MS: int(4000, 100, 60000),
  PAYMENT_MAX_ATTEMPTS: int(3, 1, 6),
  SIM_GATEWAY_LATENCY_MS: int(250, 0, 10000),
  HOLD_MINUTES: int(10, 1, 60),
  HOST_COMMISSION_RATE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .pipe(z.number().min(0).max(0.5).nullable()),
  EARLY_CHECKIN_MIN: int(15, 0, 240),
  NO_SHOW_GRACE_MIN: int(30, 0, 240),
  WALKIN_HORIZON_MIN: int(180, 0, 24 * 60),
  BOOKING_HORIZON_DAYS: int(7, 1, 90),
  DEMO_TOOLS: bool(false),
  ALLOW_DEMO_TOOLS_IN_PRODUCTION: bool(false),
  DEMO_RESET_TOKEN: z.string().default(''),
  SAGA_STEP_DELAY_MS: int(0, 0, 5000),
  RATE_LIMIT_STORE: z.enum(['memory', 'postgres']).default('memory'),
  RATE_LIMIT_AUTH_PER_MIN: int(10, 1, 10000),
  RATE_LIMIT_WRITE_PER_MIN: int(60, 1, 100000),
  RATE_LIMIT_GLOBAL_PER_MIN: int(600, 1, 1000000),
  SWEEPER_ENABLED: bool(true),
  SWEEPER_INTERVAL_MS: int(30000, 1000, 3600000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error('Configuración inválida → ' + issues);
  }
  const c = parsed.data;
  const prod = c.NODE_ENV === 'production';

  if (c.PAYMENTS_LIVE) {
    // El cobro real exige pasarela configurada, producción y sin herramientas de demo.
    if (c.PAYMENT_PROVIDER !== 'gateway') throw new Error('PAYMENTS_LIVE=true requiere PAYMENT_PROVIDER=gateway');
    if (!prod) throw new Error('PAYMENTS_LIVE=true solo se permite con NODE_ENV=production');
    if (c.DEMO_TOOLS) throw new Error('PAYMENTS_LIVE=true es incompatible con DEMO_TOOLS=true');
  }
  if (c.PAYMENT_PROVIDER === 'gateway' && (!c.PAYMENT_GATEWAY_URL || !c.PAYMENT_GATEWAY_KEY_ID || !c.PAYMENT_GATEWAY_SECRET)) {
    throw new Error('PAYMENT_PROVIDER=gateway requiere PAYMENT_GATEWAY_URL, PAYMENT_GATEWAY_KEY_ID y PAYMENT_GATEWAY_SECRET');
  }
  if (prod && c.DEMO_TOOLS && !c.ALLOW_DEMO_TOOLS_IN_PRODUCTION) {
    throw new Error('DEMO_TOOLS=true en producción requiere ALLOW_DEMO_TOOLS_IN_PRODUCTION=true (solo pilotos controlados)');
  }
  if (prod && !c.CORS_ORIGINS) throw new Error('En producción define CORS_ORIGINS (lista separada por comas)');
  if (c.DEMO_RESET_TOKEN && c.DEMO_RESET_TOKEN.length < 24) throw new Error('DEMO_RESET_TOKEN debe tener al menos 24 caracteres');

  const trustProxy = c.TRUST_PROXY === 'false' ? false : c.TRUST_PROXY === 'true' ? true : Number(c.TRUST_PROXY);

  return {
    env: c.NODE_ENV,
    isProd: prod,
    isTest: c.NODE_ENV === 'test',
    port: c.PORT,
    db: {
      url: c.DATABASE_URL,
      poolMax: c.DATABASE_POOL_MAX,
      ssl: c.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: c.DATABASE_SSL === 'true' },
    },
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy,
    auth: {
      accessTtlMin: c.ACCESS_TOKEN_TTL_MIN,
      refreshTtlDays: c.REFRESH_TOKEN_TTL_DAYS,
      resetTtlMin: c.PASSWORD_RESET_TTL_MIN,
    },
    mail: { provider: c.MAIL_PROVIDER },
    payments: {
      provider: c.PAYMENT_PROVIDER,
      live: c.PAYMENTS_LIVE,
      gateway: { url: c.PAYMENT_GATEWAY_URL, keyId: c.PAYMENT_GATEWAY_KEY_ID, secret: c.PAYMENT_GATEWAY_SECRET },
      timeoutMs: c.PAYMENT_TIMEOUT_MS,
      maxAttempts: c.PAYMENT_MAX_ATTEMPTS,
      simLatencyMs: c.SIM_GATEWAY_LATENCY_MS,
    },
    booking: {
      holdMinutes: c.HOLD_MINUTES,
      commissionRate: c.HOST_COMMISSION_RATE,
      earlyCheckInMin: c.EARLY_CHECKIN_MIN,
      noShowGraceMin: c.NO_SHOW_GRACE_MIN,
      walkInHorizonMin: c.WALKIN_HORIZON_MIN,
      bookingHorizonDays: c.BOOKING_HORIZON_DAYS,
      sagaStepDelayMs: c.SAGA_STEP_DELAY_MS,
    },
    demo: { enabled: c.DEMO_TOOLS, resetToken: c.DEMO_RESET_TOKEN },
    rateLimit: {
      store: c.RATE_LIMIT_STORE,
      authPerMin: c.RATE_LIMIT_AUTH_PER_MIN,
      writePerMin: c.RATE_LIMIT_WRITE_PER_MIN,
      globalPerMin: c.RATE_LIMIT_GLOBAL_PER_MIN,
    },
    sweeper: { enabled: c.SWEEPER_ENABLED, intervalMs: c.SWEEPER_INTERVAL_MS },
    logLevel: c.LOG_LEVEL,
  };
}
