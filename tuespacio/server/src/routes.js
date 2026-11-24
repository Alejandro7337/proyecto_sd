// Rutas REST (contrato en docs/API.md y GET /openapi.json). Cada entrada valida con zod (objetos
// estrictos), exige sesión/rol donde corresponde y delega en los servicios de dominio.
import { Router } from 'express';
import { authenticate, requireAuth, requireRole } from './http/auth.js';
import { AppError } from './http/errors.js';
import { rateLimit } from './http/rateLimit.js';
import { boolString, id, intString, isoDate, localDateStr, parse, vehicleType, z } from './http/validate.js';
import { normalizeEmail } from '../../app/src/domain/validation.js';

const DEMO_SCENARIOS = ['none', 'taken', 'declined', 'timeout', 'hold_expired', 'capture_timeout'];

const S = {
  login: z.strictObject({ email: z.string().max(254), password: z.string().min(1, 'PASSWORD_REQUIRED').max(128), role: z.enum(['driver', 'owner', 'host']).optional() }),
  register: z.strictObject({
    name: z.string().max(80),
    email: z.string().max(254),
    password: z.string().max(128),
    role: z.string().max(20),
    vehicle: vehicleType.optional(),
  }),
  refresh: z.strictObject({ refreshToken: z.string().min(20).max(200) }),
  forgot: z.strictObject({ email: z.string().max(254) }),
  reset: z.strictObject({ email: z.string().max(254), code: z.string().min(4).max(16), password: z.string().max(128) }),
  changePassword: z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: z.string().max(128) }),
  updateMe: z.strictObject({
    name: z.string().max(80).optional(),
    vehicle: vehicleType.optional(),
    preferences: z.strictObject({ dark: z.boolean().optional(), language: z.enum(['es', 'en', 'pt', 'it', 'de', 'fr', 'ja']).optional(), notifications: z.boolean().optional() }).optional(),
  }),
  vehicle: z.strictObject({
    type: vehicleType.optional(),
    label: z.string().max(40).optional(),
    plate: z.string().max(10).nullable().optional(),
    heightM: z.union([z.number(), z.string().max(5), z.null()]).optional(),
    isDefault: z.boolean().optional(),
  }),
  listSpaces: z.object({
    destinationId: id,
    vehicle: vehicleType.optional(),
    covered: boolString,
    noKeys: boolString,
    availableOnly: boolString,
    kind: z.enum(['formal', 'particular']).optional(),
    sort: z.enum(['distance', 'price']).optional(),
    startAt: isoDate.optional(),
    durationMin: intString(1, 24 * 60),
  }),
  getSpace: z.object({ track: boolString, startAt: isoDate.optional(), durationMin: intString(1, 24 * 60), vehicle: vehicleType.optional() }),
  dayAvailability: z.object({ date: localDateStr.optional(), vehicle: vehicleType.optional(), durationMin: intString(30, 24 * 60), stepMin: intString(15, 120) }),
  quote: z.object({ vehicle: vehicleType, startAt: isoDate, durationMin: intString(30, 24 * 60).pipe(z.number()) }),
  createReservation: z.strictObject({
    spaceId: id,
    vehicle: vehicleType,
    vehicleId: id.optional(),
    paymentMethodId: id.optional(),
    startAt: isoDate,
    durationMin: z.number().int(),
    idempotencyKey: z.string().min(8).max(120).regex(/^[\w:.-]+$/).optional(),
    simulate: z.enum(DEMO_SCENARIOS).optional(),
  }),
  cancel: z.strictObject({ reason: z.string().max(200).optional() }),
  reschedule: z.strictObject({ startAt: isoDate }),
  updateSpace: z.strictObject({
    name: z.string().max(80).optional(),
    address: z.string().max(120).optional(),
    capacity: z.record(z.string(), z.union([z.number(), z.string().max(5)])).optional(),
    rates: z.record(z.string(), z.strictObject({ unit: z.string().max(10), price: z.union([z.number(), z.string().max(7)]) }).nullable()).optional(),
    schedule: z.union([
      z.strictObject({ weekly: z.array(z.strictObject({ weekday: z.number().int(), open: z.string().max(5), close: z.string().max(5) })).max(7) }),
      z.strictObject({ open: z.string().max(5), close: z.string().max(5), days: z.string().max(30) }),
      z.strictObject({ open: z.string().max(5), close: z.string().max(5), days: z.string().max(30), weekly: z.array(z.any()).max(7) }),
    ]).optional(),
    conditions: z.strictObject({ covered: z.boolean().optional(), keys: z.boolean().optional(), maxHeight: z.union([z.number(), z.string().max(5), z.null()]).optional() }).optional(),
    status: z.string().max(20).optional(),
    version: z.number().int().optional(),
  }),
  occupancy: z.strictObject({ vehicle: vehicleType, delta: z.union([z.literal(1), z.literal(-1)]) }),
  spaceReservations: z.object({ status: z.string().max(80).optional(), from: isoDate.optional(), to: isoDate.optional(), code: z.string().max(12).optional() }),
  validateCode: z.strictObject({ code: z.string().min(4).max(12) }),
  metrics: z.object({ from: localDateStr.optional(), to: localDateStr.optional(), spaceId: id.optional() }),
  sync: z.object({ cursor: intString(0, Number.MAX_SAFE_INTEGER) }),
};

export function buildRouter({ config, db, services, limiterStore }) {
  const r = Router();
  const { auth, catalog, reservations, panel, sync, demo } = services;
  const lim = (name, max, keyFn) => rateLimit({ store: limiterStore, name, max, keyFn });
  const authLimit = lim('auth', config.rateLimit.authPerMin);
  const emailLimit = lim('auth-email', config.rateLimit.authPerMin, (req) => (req.body?.email ? normalizeEmail(req.body.email) : null));
  const writeLimit = lim('write', config.rateLimit.writePerMin, (req) => req.user?.id || req.ip);
  const ctx = (req) => ({ requestId: req.id, userAgent: req.headers['user-agent'] });
  const ok = (res, data, status = 200) => res.status(status).json(data);

  r.use(authenticate(db));

  // ── Salud ──
  r.get('/health', (req, res) => ok(res, { status: 'ok' }));
  r.get('/ready', async (req, res) => {
    await db.query('SELECT 1');
    ok(res, { status: 'ready', payments: { provider: config.payments.provider, live: config.payments.live }, demoTools: config.demo.enabled });
  });

  // ── Autenticación ──
  r.post('/auth/register', authLimit, emailLimit, async (req, res) => ok(res, await auth.register(parse(S.register, req.body), ctx(req)), 201));
  r.post('/auth/login', authLimit, emailLimit, async (req, res) => ok(res, await auth.login(parse(S.login, req.body), ctx(req))));
  r.post('/auth/refresh', authLimit, async (req, res) => ok(res, await auth.refresh(parse(S.refresh, req.body), ctx(req))));
  r.post('/auth/logout', requireAuth, async (req, res) => {
    await auth.logout(req);
    res.status(204).end();
  });
  r.post('/auth/logout-all', requireAuth, async (req, res) => {
    await auth.logout(req, { all: true });
    res.status(204).end();
  });
  r.post('/auth/password/forgot', authLimit, emailLimit, async (req, res) => {
    await auth.forgotPassword(parse(S.forgot, req.body), ctx(req));
    ok(res, { accepted: true, delivery: config.mail.provider === 'outbox' ? 'simulated' : 'disabled' }, 202);
  });
  r.post('/auth/password/reset', authLimit, emailLimit, async (req, res) => {
    await auth.resetPassword(parse(S.reset, req.body), ctx(req));
    res.status(204).end();
  });
  r.post('/auth/password/change', requireAuth, authLimit, async (req, res) => {
    await auth.changePassword(req, parse(S.changePassword, req.body));
    res.status(204).end();
  });

  // ── Perfil ──
  r.get('/me', requireAuth, async (req, res) => ok(res, await auth.me(req)));
  r.patch('/me', requireAuth, writeLimit, async (req, res) => ok(res, await auth.updateMe(req, parse(S.updateMe, req.body))));
  r.get('/me/vehicles', requireRole('driver'), async (req, res) => ok(res, await auth.listVehicles(req)));
  r.post('/me/vehicles', requireRole('driver'), writeLimit, async (req, res) => ok(res, await auth.saveVehicle(req, null, parse(S.vehicle, req.body)), 201));
  r.patch('/me/vehicles/:id', requireRole('driver'), writeLimit, async (req, res) => ok(res, await auth.saveVehicle(req, parse(id, req.params.id), parse(S.vehicle, req.body))));
  r.delete('/me/vehicles/:id', requireRole('driver'), writeLimit, async (req, res) => {
    await auth.archiveVehicle(req, parse(id, req.params.id));
    res.status(204).end();
  });
  r.get('/me/payment-methods', requireRole('driver'), async (req, res) => ok(res, await auth.listPaymentMethods(req)));
  r.post('/me/payment-methods/:id/default', requireRole('driver'), writeLimit, async (req, res) => ok(res, await auth.setDefaultPaymentMethod(req, parse(id, req.params.id))));

  // ── Catálogo (público; con sesión cuenta el rol para métricas) ──
  r.get('/destinations', async (req, res) => ok(res, await catalog.searchDestinations({ q: String(req.query.q || '').slice(0, 80) })));
  r.get('/destinations/:id', async (req, res) => ok(res, await catalog.getDestination(parse(id, req.params.id))));
  r.get('/spaces', async (req, res) => ok(res, await catalog.listSpaces(parse(S.listSpaces, req.query), req.user)));
  r.get('/spaces/:id', async (req, res) => ok(res, await catalog.getSpace(parse(id, req.params.id), parse(S.getSpace, req.query), req.user)));
  r.get('/spaces/:id/availability', async (req, res) => ok(res, await catalog.dayAvailability(parse(id, req.params.id), parse(S.dayAvailability, req.query), req.user)));
  r.get('/spaces/:id/quote', async (req, res) => ok(res, await catalog.quote(parse(id, req.params.id), parse(S.quote, req.query), req.user)));

  // ── Reservas (T0) ──
  r.post('/reservations', requireRole('driver'), writeLimit, async (req, res) => {
    const body = parse(S.createReservation, req.body);
    const key = body.idempotencyKey || req.headers['idempotency-key'];
    if (!key || !/^[\w:.-]{8,120}$/.test(String(key))) throw new AppError('VALIDATION', 422, { fields: { idempotencyKey: 'REQUIRED' } });
    let scenario = req.headers['x-demo-scenario'] || body.simulate || 'none';
    if (!DEMO_SCENARIOS.includes(scenario)) scenario = 'none';
    // Los escenarios de falla solo existen con herramientas de demo y pasarela simulada.
    if (!config.demo.enabled || config.payments.provider !== 'simulated') scenario = 'none';
    const { simulate, ...input } = body;
    void simulate;
    const out = await reservations.createReservation(req, { ...input, idempotencyKey: String(key) }, scenario);
    res.set('Idempotent-Replayed', out.replayed ? 'true' : 'false');
    ok(res, out.reservation, out.replayed ? 200 : 201);
  });
  r.get('/reservations/attempts/:key', requireRole('driver'), async (req, res) => ok(res, await reservations.attempts(req, String(req.params.key).slice(0, 120))));
  r.get('/me/reservations', requireRole('driver'), async (req, res) => ok(res, await reservations.myReservations(req, { scope: req.query.scope })));
  r.get('/reservations/:id', requireAuth, async (req, res) => ok(res, await reservations.getReservation(req, parse(id, req.params.id))));
  r.post('/reservations/:id/cancel', requireRole('driver'), writeLimit, async (req, res) => ok(res, await reservations.cancel(req, parse(id, req.params.id), parse(S.cancel, req.body))));
  r.post('/reservations/:id/check-in', requireAuth, writeLimit, async (req, res) => ok(res, await reservations.checkIn(req, parse(id, req.params.id))));
  r.post('/reservations/:id/check-out', requireAuth, writeLimit, async (req, res) => ok(res, await reservations.checkOut(req, parse(id, req.params.id))));
  r.post('/reservations/:id/reschedule', requireRole('driver'), writeLimit, async (req, res) => ok(res, await reservations.reschedule(req, parse(id, req.params.id), parse(S.reschedule, req.body))));

  // ── Panel: dueño (owner) y anfitrión (host) ──
  const manager = requireRole('owner', 'host');
  r.get('/owner/space', requireRole('owner'), async (req, res) => ok(res, await panel.ownerSpace(req)));
  r.get('/owner/metrics', manager, async (req, res) => ok(res, await panel.metrics(req, parse(S.metrics, req.query))));
  r.patch('/spaces/:id', manager, writeLimit, async (req, res) => ok(res, await panel.updateSpace(req, parse(id, req.params.id), parse(S.updateSpace, req.body))));
  r.post('/spaces/:id/occupancy', manager, writeLimit, async (req, res) => ok(res, await panel.adjustOccupancy(req, parse(id, req.params.id), parse(S.occupancy, req.body))));
  r.get('/spaces/:id/reservations', manager, async (req, res) => ok(res, await panel.spaceReservations(req, parse(id, req.params.id), parse(S.spaceReservations, req.query))));
  r.post('/spaces/:id/validate-code', manager, writeLimit, async (req, res) => ok(res, await panel.validateCode(req, parse(id, req.params.id), parse(S.validateCode, req.body))));
  r.get('/spaces/:id/history', manager, async (req, res) => ok(res, await panel.history(req, parse(id, req.params.id), { limit: req.query.limit })));
  r.get('/host/spaces', requireRole('host'), async (req, res) => ok(res, await panel.hostSpaces(req)));
  r.post('/host/spaces', requireRole('host'), writeLimit, async (req, res) => ok(res, await panel.createHostSpace(req, req.body || {}), 201));
  r.get('/host/reservations', requireRole('host'), async (req, res) => ok(res, await panel.hostReservations(req, parse(S.spaceReservations, req.query))));
  r.get('/host/earnings', requireRole('host'), async (req, res) => ok(res, await panel.hostEarnings(req)));
  r.post('/host/identity', requireRole('host'), writeLimit, async (req, res) => ok(res, await panel.requestIdentity(req)));

  // ── Sincronización (polling de cambios; ver docs/BACKEND.md § Tiempo real) ──
  r.get('/sync', async (req, res) => ok(res, await sync.changes(req, parse(S.sync, req.query))));

  // ── Herramientas de demostración (solo DEMO_TOOLS=true) ──
  r.use('/demo', (req, res, next) => (config.demo.enabled ? next() : next(new AppError('DEMO_DISABLED', 404))));
  r.get('/demo/transactions', async (req, res) => ok(res, await demo.transactions()));
  r.get('/demo/outbox', async (req, res) => ok(res, await demo.outbox(String(req.query.email || ''))));
  r.post('/demo/identity/:userId/:decision', async (req, res) => ok(res, await demo.decideIdentity(parse(id, req.params.userId), req.params.decision)));
  r.post('/demo/sweep', async (req, res) => ok(res, await demo.sweep()));
  r.post('/demo/reset', async (req, res) => ok(res, await demo.reset(req.headers['x-demo-token'])));

  return r;
}
