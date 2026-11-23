// Capa de transporte. En modo "mock" las peticiones se resuelven en el backend simulado
// (src/api/mock). En modo "http" se envían al backend real definido en EXPO_PUBLIC_API_URL.
// La app no guarda credenciales ni secretos: solo el token de sesión que entrega el backend.
import { ApiError } from './errors';
import { handle as mockHandle } from './mock/router';

const MODE = process.env.EXPO_PUBLIC_API_MODE || 'mock';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

let sessionToken = null;
export const setSessionToken = (token) => {
  sessionToken = token;
};
export const apiMode = MODE;

async function httpRequest(method, path, body) {
  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: 'Bearer ' + sessionToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', 'Sin conexión', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json.error || {};
    throw new ApiError(err.code || 'HTTP_' + res.status, err.message || 'Error del servidor', res.status, err.details || {});
  }
  return json.data !== undefined ? json.data : json;
}

export function request(method, path, body) {
  if (MODE === 'http') return httpRequest(method, path, body);
  return mockHandle(method, path, body, { token: sessionToken });
}
