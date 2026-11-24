// Utilidades de pruebas de interfaz: monta las rutas reales de src/app con expo-router.
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { STORAGE_KEYS } from '../../src/state/storage';
import { setSessionToken } from '../../src/api/transport';
import { login as loginApi } from './backend';

// Almacén en memoria del simulacro de expo-secure-store (ver support/setup.js).
export const secureStore = () => jest.requireMock('expo-secure-store').__store;

export async function renderApp(url = '/') {
  // renderRouter activa temporizadores falsos. Se avanzan los pendientes del arranque (restaurar
  // sesión, primeras consultas) y luego se vuelve a temporizadores reales: con falsos las
  // transiciones de pantalla no terminan y quedan ocultas para la accesibilidad. Las latencias
  // simuladas valen 0 en pruebas, así que no hay demoras reales.
  const result = await renderRouter('./src/app', { initialUrl: url });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  jest.useRealTimers();
  return result;
}

// Simula una sesión guardada en el teléfono (como si la app se hubiera cerrado con sesión abierta).
export async function storeSession(email, password = 'demo123') {
  const { handle } = require('../../src/api/mock/router');
  const { token, user } = await handle('POST', '/auth/login', { email, password }, { token: null });
  secureStore().set(STORAGE_KEYS.session, JSON.stringify({ token, user }));
  return token;
}

export const storedSession = () => {
  const raw = secureStore().get(STORAGE_KEYS.session);
  return raw ? JSON.parse(raw) : null;
};

export function clearStorage() {
  secureStore().clear();
  setSessionToken(null);
}

export const waitForPath = (result, path) => waitFor(() => expect(result.getPathname()).toBe(path));

export { screen, loginApi };
