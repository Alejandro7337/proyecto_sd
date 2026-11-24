// Contraseñas con scrypt (node:crypto, sin dependencias nativas) y tokens opacos aleatorios.
// En la base solo se guarda el hash SHA-256 de cada token: una fuga de la base no permite usarlos.
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CODE_ALPHABET } from '../../../app/src/domain/rules.js';

const scrypt = promisify(scryptCb);
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hash fijo para igualar el tiempo de respuesta cuando el correo no existe (evita enumerar cuentas).
let dummyHash = null;
export async function burnPasswordCheck(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-0');
  await verifyPassword(password, dummyHash);
  return false;
}

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
export const randomToken = (prefix) => `${prefix}_${randomBytes(32).toString('base64url')}`;

export function randomCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
