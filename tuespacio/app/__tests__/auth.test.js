// Autenticación: inicio y cierre de sesión, registro, vencimiento y revocación del token.
import { call, DEMO, freshDb, login, setClock } from './support/backend';
import { SESSION_TTL_HOURS } from '../src/domain/rules';

beforeEach(() => freshDb());

describe('inicio de sesión', () => {
  test('credenciales demo correctas devuelven token y usuario sin contraseña', async () => {
    const { data } = await call('POST', '/auth/login', { email: DEMO.driver, password: 'demo123' });
    expect(data.token).toEqual(expect.any(String));
    expect(data.user).toMatchObject({ role: 'driver', email: DEMO.driver });
    expect(data.user).not.toHaveProperty('password');
  });

  test('el correo no distingue mayúsculas ni espacios', async () => {
    const { data } = await call('POST', '/auth/login', { email: '  CONDUCTOR@demo.TEST ', password: 'demo123' });
    expect(data.user.role).toBe('driver');
  });

  test.each([
    [DEMO.driver, 'mala-clave'],
    ['nadie@demo.test', 'demo123'],
    ['', ''],
  ])('credenciales inválidas (%s) → 401 INVALID_CREDENTIALS', async (email, password) => {
    const { error } = await call('POST', '/auth/login', { email, password });
    expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  });

  test('entrar por el login de otro rol → 403 ROLE_MISMATCH', async () => {
    const { error } = await call('POST', '/auth/login', { email: DEMO.owner, password: 'demo123', role: 'driver' });
    expect(error).toMatchObject({ code: 'ROLE_MISMATCH', status: 403 });
  });
});

describe('registro', () => {
  const valid = { name: 'Ana Prueba', email: 'ana@demo.test', password: 'secreto1', role: 'driver', vehicle: 'moto' };

  test('conductor nuevo queda con sesión iniciada y puede consultar /me', async () => {
    const { data } = await call('POST', '/auth/register', valid);
    const me = await call('GET', '/me', null, data.token);
    expect(me.data).toMatchObject({ name: 'Ana Prueba', role: 'driver', vehicle: 'moto' });
  });

  test('anfitrión nuevo queda con verificación de identidad pendiente', async () => {
    const { data } = await call('POST', '/auth/register', { ...valid, role: 'host', vehicle: undefined });
    expect(data.user.identity).toBe('pending');
  });

  test('validación por campo (422)', async () => {
    const { error } = await call('POST', '/auth/register', { name: 'A', email: 'x', password: '1', role: 'driver' });
    expect(error.status).toBe(422);
    expect(Object.keys(error.details.fields).sort()).toEqual(['email', 'name', 'password', 'vehicle']);
  });

  test('los dueños de parqueadero no se registran solos', async () => {
    const { error } = await call('POST', '/auth/register', { ...valid, role: 'owner' });
    expect(error.details.fields.role).toBeDefined();
  });

  test('correo repetido → 409 EMAIL_IN_USE', async () => {
    const { error } = await call('POST', '/auth/register', { ...valid, email: 'Conductor@Demo.test' });
    expect(error).toMatchObject({ code: 'EMAIL_IN_USE', status: 409 });
  });
});

describe('ciclo de vida del token', () => {
  test('sin token, una ruta protegida responde 401 UNAUTHORIZED', async () => {
    const { error } = await call('GET', '/me');
    expect(error).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  test('token alterado o de un usuario inexistente → 401', async () => {
    for (const token of ['basura', 'mock.u-nadie.99999999999999', 'mock.u-driver']) {
      const { error } = await call('GET', '/me', null, token);
      expect(error.status).toBe(401);
    }
  });

  test('el token vence a las SESSION_TTL_HOURS y entonces responde 401 TOKEN_EXPIRED', async () => {
    const clock = setClock();
    const token = await login(DEMO.driver);
    clock.advance(SESSION_TTL_HOURS * 3600000 - 1000);
    expect((await call('GET', '/me', null, token)).data.role).toBe('driver');
    clock.advance(2000);
    expect((await call('GET', '/me', null, token)).error).toMatchObject({ code: 'TOKEN_EXPIRED', status: 401 });
  });

  test('con token vencido se puede volver a iniciar sesión', async () => {
    const clock = setClock();
    const old = await login(DEMO.driver);
    clock.advance(SESSION_TTL_HOURS * 3600000 + 1);
    const { data } = await call('POST', '/auth/login', { email: DEMO.driver, password: 'demo123' }, old);
    expect(data.token).not.toBe(old);
  });

  test('cerrar sesión revoca el token en el servidor', async () => {
    const token = await login(DEMO.driver);
    await call('POST', '/auth/logout', null, token);
    expect((await call('GET', '/me', null, token)).error.code).toBe('UNAUTHORIZED');
  });

  test('PATCH /me valida el vehículo', async () => {
    const token = await login(DEMO.driver);
    expect((await call('PATCH', '/me', { vehicle: 'moto' }, token)).data.vehicle).toBe('moto');
    expect((await call('PATCH', '/me', { vehicle: 'avion' }, token)).error.status).toBe(422);
  });
});
