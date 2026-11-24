// Permisos: cada rol solo accede a lo suyo (acceso entre roles no autorizado → 403).
import { call, DEMO, freshDb, login, reservationBody } from './support/backend';

let tokens;
beforeEach(async () => {
  freshDb();
  tokens = {
    driver: await login(DEMO.driver),
    driver2: await login(DEMO.driver2, 'TuEspacio2026!'),
    owner: await login(DEMO.owner),
    host: await login(DEMO.host),
    host3: await login(DEMO.host3),
  };
});

const expectForbidden = async (method, path, body, token) => {
  const { error } = await call(method, path, body, token);
  expect(error).toMatchObject({ status: 403 });
};

test.each([
  ['host', 'GET', '/owner/space'],
  ['driver', 'GET', '/owner/space'],
  ['owner', 'GET', '/host/spaces'],
  ['driver', 'GET', '/host/earnings'],
  ['owner', 'GET', '/me/reservations'],
  ['host', 'POST', '/reservations'],
  ['driver', 'POST', '/host/spaces'],
])('%s no puede %s %s', async (role, method, path) => {
  await expectForbidden(method, path, method === 'POST' ? reservationBody() : null, tokens[role]);
});

test('un dueño no edita ni ve reservas de un espacio ajeno', async () => {
  await expectForbidden('PATCH', '/spaces/s-emp-2', { status: 'paused' }, tokens.owner);
  await expectForbidden('POST', '/spaces/s-emp-2/occupancy', { vehicle: 'car', delta: 1 }, tokens.owner);
  await expectForbidden('GET', '/spaces/s-emp-2/reservations', null, tokens.owner);
});

test('un anfitrión no edita el espacio de otro anfitrión', async () => {
  await expectForbidden('PATCH', '/spaces/s-cli-3', { status: 'paused' }, tokens.host);
});

test('un conductor no puede ver, cancelar ni registrar llegada de la reserva de otro', async () => {
  const { data: r } = await call('POST', '/reservations', reservationBody(), tokens.driver);
  for (const [method, suffix] of [['GET', ''], ['POST', '/cancel'], ['POST', '/check-in']]) {
    await expectForbidden(method, `/reservations/${r.id}${suffix}`, null, tokens.driver2);
  }
});

test('el dueño del espacio sí ve y gestiona la reserva recibida', async () => {
  const { data: r } = await call('POST', '/reservations', reservationBody({ spaceId: 's-emp-1' }), tokens.driver);
  // s-emp-1 pertenece a parqueadero@demo.test.
  expect((await call('GET', `/reservations/${r.id}`, null, tokens.owner)).data.id).toBe(r.id);
  expect((await call('POST', `/reservations/${r.id}/check-in`, null, tokens.owner)).data.status).toBe('active');
});

test('las métricas del anfitrión no incluyen espacios de otros anfitriones', async () => {
  const { data } = await call('GET', '/host/spaces', null, tokens.host);
  expect(data.length).toBeGreaterThan(0);
  expect(data.every((s) => ['s-emp-4', 's-uni-3'].includes(s.id))).toBe(true);
});
