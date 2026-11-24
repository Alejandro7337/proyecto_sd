// Capa de transporte: modo mock, modo HTTP (contra un servidor HTTP real), sin conexión,
// timeout, configuración inválida y manejo de sesión vencida.
import http from 'http';
import { DEMO, freshDb, reservationBody } from './support/backend';
import { SESSION_TTL_HOURS } from '../src/domain/rules';
import { nodeFetch } from './support/nodeFetch';

const jestFetch = global.fetch;
beforeAll(() => {
  global.fetch = nodeFetch;
});
afterAll(() => {
  global.fetch = jestFetch;
});

// Carga transport + api con variables de entorno propias (Expo las lee al cargar el módulo).
// Todo se carga en un registro aislado; `mock` es el backend simulado de ese mismo registro.
function loadClient(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  let mod;
  jest.isolateModules(() => {
    mod = {
      transport: require('../src/api/transport'),
      api: require('../src/api').api,
      mock: {
        faults: require('../src/api/mock/demoControls').faults,
        clock: require('../src/api/mock/db').clock,
        handle: require('../src/api/mock/router').handle,
      },
    };
  });
  process.env = saved;
  mod.mock.faults.latencyMs = 0;
  mod.mock.faults.timeScale = 0;
  return mod;
}

// Servidor HTTP que expone el router simulado con el contrato de docs/API.md.
function startServer(handle, { hang = false } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    await new Promise((r) => req.on('end', r));
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (hang) return; // nunca responde
    const token = (req.headers.authorization || '').replace(/^Bearer /, '') || null;
    try {
      const data = await handle(req.method, req.url, raw ? JSON.parse(raw) : undefined, { token });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (e) {
      res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: e.code, message: e.message, details: e.details } }));
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }))
  );
}

beforeEach(() => freshDb());

describe('modo mock (por defecto)', () => {
  test('sin variables usa el backend simulado y se declara modo demo', async () => {
    const { transport, api } = loadClient({ EXPO_PUBLIC_API_MODE: '' });
    expect(transport.apiMode).toBe('mock');
    expect(transport.isDemoMode).toBe(true);
    expect(transport.configError).toBeNull();
    expect((await api.searchDestinations('')).length).toBe(3);
  });

  test('sin conexión simulada → error NETWORK; al reconectar vuelve a funcionar', async () => {
    const { api, mock } = loadClient({});
    mock.faults.offline = true;
    await expect(api.searchDestinations('')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    mock.faults.offline = false;
    await expect(api.searchDestinations('')).resolves.toHaveLength(3);
  });

  test('ruta desconocida → 404 NOT_FOUND', async () => {
    const { transport } = loadClient({});
    await expect(transport.request('GET', '/nada')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('configuración', () => {
  test.each([
    [{ EXPO_PUBLIC_API_MODE: 'grpc' }, /no es válido/],
    [{ EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_URL: '' }, /requiere EXPO_PUBLIC_API_URL/],
    [{ EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_URL: 'api.ejemplo.co' }, /requiere EXPO_PUBLIC_API_URL/],
  ])('%j → error de configuración visible', async (env, message) => {
    const { transport } = loadClient(env);
    expect(transport.configError).toMatch(message);
    if (env.EXPO_PUBLIC_API_MODE === 'http') {
      await expect(transport.request('GET', '/me')).rejects.toMatchObject({ code: 'CONFIG' });
    }
  });
});

describe('modo HTTP contra un servidor real', () => {
  let srv;
  // El "servidor" usa su propio backend simulado, separado del cliente (como en producción).
  const backend = () => loadClient({}).mock.handle;
  afterEach(() => new Promise((r) => (srv ? srv.server.close(r) : r())));

  test('flujo completo: login, reserva con Idempotency-Key, consulta y errores con su código', async () => {
    srv = await startServer(backend());
    const { transport, api } = loadClient({ EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_URL: srv.url + '/' });
    expect(transport.isDemoMode).toBe(false);

    const session = await api.login(DEMO.driver, 'demo123');
    transport.setSessionToken(session.token);
    const body = reservationBody();
    const r = await api.createReservation(body);
    expect(r.status).toBe('confirmed');
    // Reintento por red con la misma llave: misma reserva.
    expect((await api.createReservation(body)).id).toBe(r.id);
    expect((await api.getReservation(r.id)).code).toBe(r.code);

    const post = srv.seen.find((x) => x.method === 'POST' && x.url === '/reservations');
    expect(post.headers.authorization).toBe('Bearer ' + session.token);
    expect(post.headers['idempotency-key']).toBe(body.idempotencyKey);
    expect(post.headers['content-type']).toMatch(/application\/json/);
    // La barra final de la URL base no duplica separadores.
    expect(srv.seen.every((x) => !x.url.startsWith('//'))).toBe(true);

    await expect(api.login(DEMO.driver, 'mala')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    await expect(api.ownerSpace()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  test('el error de validación conserva los campos (422 details.fields)', async () => {
    srv = await startServer(backend());
    const { api } = loadClient({ EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_URL: srv.url });
    await expect(api.register({ name: 'A', email: 'x', password: '1', role: 'driver' })).rejects.toMatchObject({
      status: 422,
      details: { fields: expect.objectContaining({ email: expect.any(String) }) },
    });
  });

  test('servidor que no responde → TIMEOUT tras EXPO_PUBLIC_API_TIMEOUT_MS', async () => {
    srv = await startServer(backend(), { hang: true });
    const { api } = loadClient({ EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_URL: srv.url, EXPO_PUBLIC_API_TIMEOUT_MS: '300' });
    const started = Date.now();
    await expect(api.searchDestinations('')).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('servidor caído → NETWORK', async () => {
    srv = await startServer(backend());
    const url = srv.url;
    await new Promise((r) => srv.server.close(r));
    srv = null;
    const { api } = loadClient({ EXPO_PUBLIC_API_MODE: 'http', EXPO_PUBLIC_API_URL: url });
    await expect(api.searchDestinations('')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('sesión vencida', () => {
  test('un 401 con la sesión actual avisa al manejador de sesión una sola vez', async () => {
    const { transport, api, mock } = loadClient({});
    let t = Date.now();
    mock.clock.now = () => t;
    const session = await api.login(DEMO.driver, 'demo123');
    transport.setSessionToken(session.token);
    const onUnauthorized = jest.fn();
    transport.setUnauthorizedHandler(onUnauthorized);
    t += SESSION_TTL_HOURS * 3600000 + 1;
    await expect(api.me()).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized.mock.calls[0][0].code).toBe('TOKEN_EXPIRED');
  });

  test('credenciales incorrectas en el login (sin token) no disparan el cierre de sesión', async () => {
    const { transport, api } = loadClient({});
    const onUnauthorized = jest.fn();
    transport.setUnauthorizedHandler(onUnauthorized);
    await expect(api.login(DEMO.driver, 'mala')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
