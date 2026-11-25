// Capa de transporte. En modo "mock" las peticiones se resuelven en el backend simulado
// (src/api/mock). En modo "http" se envían al backend real definido en EXPO_PUBLIC_API_URL.
// La app no guarda credenciales ni secretos: solo el token de sesión que entrega el backend.
import { ApiError } from './errors';
import { handle as mockHandle } from './mock/router';
import { faults } from './mock/demoControls';

const MODE = process.env.EXPO_PUBLIC_API_MODE || 'mock';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

let sessionToken = null;
export const setSessionToken = (token) => {
  sessionToken = token;
};
export const apiMode = MODE;

async function httpRequest(method, path, body) {
  if (!BASE_URL) throw new ApiError('CONFIGURATION', 'Configura EXPO_PUBLIC_API_URL con la dirección del gateway y /api.', 0);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(BASE_URL.replace(/\/$/, '') + path, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: 'Bearer ' + sessionToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json;
    try {
      json = await res.json();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError('INVALID_RESPONSE', 'El servidor devolvió una respuesta no válida.', 502);
    }
    if (!res.ok) {
      const err = json.error || {};
      throw new ApiError(err.code || 'HTTP_' + res.status, err.message || 'Error del servidor', res.status, err.details || {});
    }
    return json.data !== undefined ? json.data : json;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK', error.name === 'AbortError' ? 'El servidor tardó demasiado. Reintenta la misma solicitud.' : 'Sin conexión', 0);
  } finally {
    clearTimeout(timeout);
  }
}

export function request(method, path, body) {
  if (faults.offline) return Promise.reject(new ApiError('NETWORK', 'Sin conexión simulada', 0));
  if (MODE === 'http') return httpRequest(method, path, body);
  return mockHandle(method, path, body, { token: sessionToken });
}
