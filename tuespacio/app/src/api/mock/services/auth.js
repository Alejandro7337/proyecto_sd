// Servicio: Autenticación y usuarios (simulado).
// El token del modo mock NO es seguro: codifica usuario y vencimiento sin firma, solo para
// reproducir el ciclo de sesión (vence, se revoca, se restaura). El backend real debe emitir
// tokens firmados (p. ej. JWT) y guardar contraseñas con hash (ver docs/SECURITY.md).
import { clock, getDb, nextId, publicUser } from '../db';
import { ApiError } from '../../errors';
import { ROLES, SESSION_TTL_HOURS, VEHICLES } from '../../../domain/rules';
import { isValidEmail } from '../../../utils/format';

const TOKEN_PREFIX = 'mock.';

export function issueToken(user, ttlMs = SESSION_TTL_HOURS * 3600000) {
  return `${TOKEN_PREFIX}${user.id}.${clock.now() + ttlMs}`;
}

// Resuelve el token de la petición. Sin token → user null (la ruta decide si exige sesión).
// Token inválido, revocado o vencido → 401 inmediato, igual que haría un backend real.
export function resolveSession(token) {
  if (!token) return null;
  const db = getDb();
  const match = /^mock\.(.+)\.(\d+)$/.exec(token);
  const user = match && db.users.find((u) => u.id === match[1]);
  if (!user || db.revokedTokens.includes(token)) {
    throw new ApiError('UNAUTHORIZED', 'Tu sesión no es válida. Inicia sesión de nuevo.', 401);
  }
  if (Number(match[2]) <= clock.now()) {
    throw new ApiError('TOKEN_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.', 401);
  }
  return user;
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
  return { token: issueToken(user), user: publicUser(user) };
}

export function logout(token) {
  if (token && !getDb().revokedTokens.includes(token)) getDb().revokedTokens.push(token);
  return { ok: true };
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
    id: nextId('u'),
    role,
    name: name.trim(),
    email: email.trim(),
    password,
    ...(role === 'driver' ? { vehicle } : { identity: 'pending' }),
  };
  db.users.push(user);
  return { token: issueToken(user), user: publicUser(user) };
}

export function me(user) {
  return publicUser(requireUser(user));
}

export function updateMe(user, { vehicle } = {}) {
  requireUser(user);
  if (vehicle !== undefined && !VEHICLES[vehicle]) {
    throw new ApiError('VALIDATION', 'Revisa los campos marcados.', 422, { fields: { vehicle: 'Vehículo no válido.' } });
  }
  if (vehicle) user.vehicle = vehicle;
  return publicUser(user);
}
