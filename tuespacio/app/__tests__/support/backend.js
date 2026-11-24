// Utilidades para probar el backend simulado a través del mismo router que usa la app.
import { clock, getDb, resetDb } from '../../src/api/mock/db';
import { handle } from '../../src/api/mock/router';

export const realNow = Date.now;

export function freshDb() {
  clock.now = () => Date.now();
  resetDb();
  return getDb();
}

// Fija la hora del "servidor". Por defecto, un martes a las 10:00 (todos los espacios abiertos).
export function setClock(iso = '2026-11-24T10:00:00-05:00') {
  let t = new Date(iso).getTime();
  clock.now = () => t;
  return {
    advance: (ms) => {
      t += ms;
    },
    get now() {
      return t;
    },
  };
}

// Petición como la haría la app (método, ruta, cuerpo, token). Devuelve { data } o { error }.
export async function call(method, path, body, token) {
  try {
    return { data: await handle(method, path, body, { token }) };
  } catch (error) {
    return { error };
  }
}

export async function login(email, password = 'demo123') {
  const { data, error } = await call('POST', '/auth/login', { email, password });
  if (error) throw error;
  return data.token;
}

export const DEMO = {
  driver: 'conductor@demo.test',
  driver2: 'juan@demo.test',
  owner: 'parqueadero@demo.test',
  host: 'anfitrion@demo.test',
  host3: 'andres@demo.test',
};

let n = 0;
export const idemKey = () => `test-key-${(n++).toString().padStart(4, '0')}`;

export function reservationBody(overrides = {}) {
  return {
    spaceId: 's-cli-1',
    vehicle: 'car',
    startAt: new Date(clock.now() + 15 * 60000).toISOString(),
    durationMin: 60,
    idempotencyKey: idemKey(),
    ...overrides,
  };
}

// Hora de inicio relativa al reloj simulado.
export const startIn = (clockRef, minutes) => new Date(clockRef.now + minutes * 60000).toISOString();
