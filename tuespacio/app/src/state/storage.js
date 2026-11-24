// Almacenamiento clave-valor persistente.
// Teléfono: expo-secure-store (Keychain en iOS, Keystore en Android) — apto para el token de sesión.
// Web: localStorage (no es almacenamiento seguro; ver docs/SECURITY.md).
// Si no hay almacenamiento disponible, la app funciona igual y solo pierde la persistencia.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const web = {
  get: async (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  set: async (key, value) => typeof localStorage !== 'undefined' && localStorage.setItem(key, value),
  remove: async (key) => typeof localStorage !== 'undefined' && localStorage.removeItem(key),
};

const native = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

const backend = Platform.OS === 'web' ? web : native;

export async function readJSON(key) {
  try {
    const raw = await backend.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeJSON(key, value) {
  try {
    await backend.set(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: el dato vive mientras la app esté abierta.
  }
}

export async function removeKey(key) {
  try {
    await backend.remove(key);
  } catch {
    // Nada que borrar.
  }
}

export const STORAGE_KEYS = { session: 'tuespacio.session', prefs: 'tuespacio.prefs' };
