// Capa de transporte. En modo "mock" las peticiones se resuelven en el backend simulado
// (src/api/mock). En modo "http" se envían al backend real definido en EXPO_PUBLIC_API_URL.
// La app no guarda credenciales ni secretos: solo el token de sesión que entrega el backend.
// Las variables EXPO_PUBLIC_* se incrustan en el paquete al compilar: nunca pongas secretos en ellas.
import { ApiError } from './errors';
import { handle as mockHandle } from './mock/router';

const MODES = ['mock', 'http'];
const MODE = process.env.EXPO_PUBLIC_API_MODE || 'mock';
const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS) || 15000;

// Error de configuración visible en la app (en lugar de fallar en silencio).
export const configError = !MODES.includes(MODE)
  ? `EXPO_PUBLIC_API_MODE="${MODE}" no es válido. Usa "mock" o "http".`
  : MODE === 'http' && !/^https?:\/\//.test(BASE_URL)
    ? 'EXPO_PUBLIC_API_MODE=http requiere EXPO_PUBLIC_API_URL con http(s)://'
    : null;

export const apiMode = MODE;
// Modo demo = backend simulado: datos ficticios, fallas forzables y escenarios guiados.
export const isDemoMode = MODE !== 'http';

let sessionToken = null;
export const setSessionToken = (token) => {
  sessionToken = token;
};

// La sesión la observa AppContext: un 401 con token enviado cierra la sesión local.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function httpRequest(method, path, body, token) {
  if (configError) throw new ApiError('CONFIG', configError, 0);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body && body.idempotencyKey ? { 'Idempotency-Key': body.idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'El servidor tardó demasiado en responder.', 0);
    throw new ApiError('NETWORK', 'Sin conexión', 0);
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json.error || {};
    throw new ApiError(err.code || 'HTTP_' + res.status, err.message || 'Error del servidor', res.status, err.details || {});
  }
  return json.data !== undefined ? json.data : json;
}

export async function request(method, path, body) {
  const token = sessionToken;
  try {
    if (MODE === 'http') return await httpRequest(method, path, body, token);
    return await mockHandle(method, path, body, { token });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && token && token === sessionToken && onUnauthorized) {
      onUnauthorized(e);
    }
    throw e;
  }
}
