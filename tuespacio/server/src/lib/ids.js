// Identificadores aleatorios (80 bits, base32 sin caracteres ambiguos). No usan relojes ni secuencias:
// varias instancias del servidor pueden generarlos sin coordinarse (escala horizontal).
import { randomBytes } from 'node:crypto';
import { reservationCode } from '../../../app/src/domain/rules.js';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function newId(prefix) {
  let out = '';
  for (const b of randomBytes(16)) out += ALPHABET[b & 31];
  return `${prefix}_${out}`;
}

export const newReservationCode = () => reservationCode(randomBytes(6));
