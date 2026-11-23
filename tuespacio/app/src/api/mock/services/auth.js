// Servicio: Autenticación y usuarios (simulado, sin seguridad real).
import { getDb, publicUser } from '../db';
import { ApiError } from '../../errors';
import { ROLES, VEHICLES } from '../../../domain/rules';
import { isValidEmail } from '../../../utils/format';

export function userFromToken(token) {
  if (!token) return null;
  const id = token.replace('mock.', '');
  return getDb().users.find((u) => u.id === id) || null;
}

export function requireUser(user, role) {
  if (!user) throw new ApiError('UNAUTHORIZED', 'Inicia sesión para continuar.', 401);
  if (role && user.role !== role) throw new ApiError('FORBIDDEN', 'Tu perfil no tiene acceso a esta función.', 403);
  return user;
}

export function login({ email = '', password = '', role }) {
  const user = getDb().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || user.password !== password) {
    throw new ApiError('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.', 401);
  }
  if (role && user.role !== role) {
    throw new ApiError('ROLE_MISMATCH', `Esta cuenta está registrada como ${ROLES[user.role].label.toLowerCase()}.`, 403);
  }
  return { token: 'mock.' + user.id, user: publicUser(user) };
}

export function register({ name = '', email = '', password = '', role, vehicle }) {
  const fields = {};
  if (name.trim().length < 3) fields.name = 'Escribe tu nombre completo.';
  if (!isValidEmail(email)) fields.email = 'Correo no válido.';
  if (password.length < 6) fields.password = 'Mínimo 6 caracteres.';
  if (!['driver', 'host'].includes(role)) fields.role = 'Perfil no disponible para registro.';
  if (role === 'driver' && !VEHICLES[vehicle]) fields.vehicle = 'Elige tu tipo de vehículo.';
  if (Object.keys(fields).length) throw new ApiError('VALIDATION', 'Revisa los campos marcados.', 422, { fields });

  const db = getDb();
  if (db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
    throw new ApiError('EMAIL_IN_USE', 'Ya existe una cuenta con ese correo.', 409, { fields: { email: 'Ya existe una cuenta con ese correo.' } });
  }
  const user = {
    id: 'u-' + Date.now().toString(36),
    role,
    name: name.trim(),
    email: email.trim(),
    password,
    ...(role === 'driver' ? { vehicle } : { identity: 'pending' }),
  };
  db.users.push(user);
  return { token: 'mock.' + user.id, user: publicUser(user) };
}

export function me(user) {
  return publicUser(requireUser(user));
}

export function updateMe(user, { vehicle }) {
  requireUser(user);
  if (vehicle && VEHICLES[vehicle]) user.vehicle = vehicle;
  return publicUser(user);
}
