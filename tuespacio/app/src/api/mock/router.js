// Enrutador del backend simulado. Cada ruta corresponde a un endpoint REST
// documentado en docs/API.md; el backend real debe respetar el mismo contrato.
import { delay } from './db';
import { faults } from './demoControls';
import { ApiError } from '../errors';
import * as auth from './services/auth';
import * as catalog from './services/catalog';
import * as reservations from './services/reservations';
import * as panel from './services/panel';

const routes = [
  ['POST', '/auth/login', ({ body }) => auth.login(body)],
  ['POST', '/auth/register', ({ body }) => auth.register(body)],
  ['GET', '/me', ({ user }) => auth.me(user)],
  ['PATCH', '/me', ({ user, body }) => auth.updateMe(user, body)],

  ['GET', '/destinations', ({ query }) => catalog.searchDestinations(query)],
  ['GET', '/destinations/:id', ({ params }) => catalog.getDestination(params.id)],
  ['GET', '/spaces', ({ query }) => catalog.listSpaces(query)],
  ['GET', '/spaces/:id', ({ params, query }) => catalog.getSpace(params.id, query)],

  ['POST', '/reservations', ({ user, body }) => reservations.createReservation(user, body)],
  ['GET', '/me/reservations', ({ user }) => reservations.myReservations(user)],
  ['GET', '/reservations/:id', ({ user, params }) => reservations.getReservation(user, params.id)],
  ['POST', '/reservations/:id/cancel', ({ user, params }) => reservations.cancelReservation(user, params.id)],
  ['POST', '/reservations/:id/check-in', ({ user, params }) => reservations.checkIn(user, params.id)],
  ['POST', '/reservations/:id/check-out', ({ user, params }) => reservations.checkOut(user, params.id)],

  ['GET', '/owner/space', ({ user }) => panel.ownerSpace(user)],
  ['PATCH', '/spaces/:id', ({ user, params, body }) => panel.updateSpace(user, params.id, body)],
  ['POST', '/spaces/:id/occupancy', ({ user, params, body }) => panel.adjustOccupancy(user, params.id, body)],
  ['GET', '/spaces/:id/reservations', ({ user, params }) => panel.spaceReservations(user, params.id)],
  ['GET', '/host/spaces', ({ user }) => panel.hostSpaces(user)],
  ['POST', '/host/spaces', ({ user, body }) => panel.createHostSpace(user, body)],
  ['GET', '/host/reservations', ({ user }) => panel.hostReservations(user)],
  ['GET', '/host/earnings', ({ user }) => panel.hostEarnings(user)],

  ['GET', '/demo/transactions', () => reservations.transactionLog()],
];

const compiled = routes.map(([method, pattern, handler]) => {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    }) + '$'
  );
  return { method, regex, keys, handler };
});

function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  qs.split('&').forEach((pair) => {
    const [k, v = ''] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return out;
}

// Copia profunda para que la UI nunca mute el "estado del servidor" por referencia.
const clone = (data) => (data === undefined ? null : JSON.parse(JSON.stringify(data)));

export async function handle(method, url, body, { token }) {
  await delay(faults.latencyMs * (0.6 + Math.random() * 0.8));
  if (faults.offline) throw new ApiError('NETWORK', 'Sin conexión', 0);

  const [path, qs] = url.split('?');
  for (const route of compiled) {
    if (route.method !== method) continue;
    const match = path.match(route.regex);
    if (!match) continue;
    const params = {};
    route.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(match[i + 1]);
    });
    const user = auth.userFromToken(token);
    const result = await route.handler({ params, query: parseQuery(qs), body: clone(body), user });
    return clone(result);
  }
  throw new ApiError('NOT_FOUND', `Ruta no encontrada: ${method} ${path}`, 404);
}
