// Cliente de la API de Tu Espacio. Las pantallas solo usan estas funciones;
// no conocen si el backend es real o simulado.
import { request } from './transport';

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

export const api = {
  // Autenticación y usuarios
  login: (email, password, role) => request('POST', '/auth/login', { email, password, role }),
  logout: () => request('POST', '/auth/logout'),
  register: (data) => request('POST', '/auth/register', data),
  region: () => request('GET', '/region'),
  getReceipt: (id) => request('GET', `/reservations/${id}/receipt`),
  me: () => request('GET', '/me'),
  updateMe: (data) => request('PATCH', '/me', data),

  // Catálogo y geolocalización
  searchDestinations: (q) => request('GET', '/destinations?' + qs({ q })),
  getDestination: (id) => request('GET', `/destinations/${id}`),
  listSpaces: (filters) => request('GET', '/spaces?' + qs(filters)),
  getSpace: (id, track) => request('GET', `/spaces/${id}?` + qs({ track })),

  // Disponibilidad y reservas
  createReservation: (data) => request('POST', '/reservations', data),
  myReservations: () => request('GET', '/me/reservations'),
  getReservation: (id) => request('GET', `/reservations/${id}`),
  cancelReservation: (id) => request('POST', `/reservations/${id}/cancel`),
  checkIn: (id) => request('POST', `/reservations/${id}/check-in`),
  checkOut: (id) => request('POST', `/reservations/${id}/check-out`),

  // Panel del parqueadero / anfitrión
  ownerSpace: () => request('GET', '/owner/space'),
  updateSpace: (id, data) => request('PATCH', `/spaces/${id}`, data),
  adjustOccupancy: (id, vehicle, delta) => request('POST', `/spaces/${id}/occupancy`, { vehicle, delta }),
  spaceReservations: (id) => request('GET', `/spaces/${id}/reservations`),
  hostSpaces: () => request('GET', '/host/spaces'),
  createHostSpace: (data) => request('POST', '/host/spaces', data),
  hostReservations: () => request('GET', '/host/reservations'),
  hostEarnings: () => request('GET', '/host/earnings'),

  // Solo prototipo
  demoTransactions: () => request('GET', '/demo/transactions'),
};

export const newIdempotencyKey = () =>
  'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
