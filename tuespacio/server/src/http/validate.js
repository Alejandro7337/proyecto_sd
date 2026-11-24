// Validación de entrada con zod en el borde HTTP: tipos, longitudes y campos permitidos (los objetos
// son estrictos: un campo desconocido es un error). Las reglas de negocio viven en el dominio.
import { z } from 'zod';
import { MESSAGE_CODES } from '../../../app/src/domain/messages.js';
import { validationError } from './errors.js';

const KNOWN = new Set(MESSAGE_CODES);

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : issue.keys?.[0] || '_';
    if (!fields[key]) fields[key] = KNOWN.has(issue.message) ? issue.message : 'REQUIRED';
  }
  throw validationError(fields);
}

export const id = z.string().min(3).max(64).regex(/^[\w-]+$/);
export const vehicleType = z.enum(['car', 'moto']);
export const isoDate = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'START_INVALID');
export const localDateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const boolString = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');
export const intString = (min, max) =>
  z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().min(min).max(max).optional());

export { z };
