// Disponibilidad por franja horaria (cálculo puro). La misma regla la aplica el trigger
// enforce_capacity() de PostgreSQL (server/src/db/migrations/001_init.sql):
//
//   libres([s, e)) = capacidad − máx. concurrencia de asignaciones en [s, e)
//                    − entradas sin reserva (si s < ahora + horizonte de entradas)
//
// Asignaciones = reservas confirmadas o en curso + retenciones vigentes (no vencidas).
import { LIMITS } from './rules.js';

const ms = (v) => (typeof v === 'number' ? v : new Date(v).getTime());

export const overlaps = (aStart, aEnd, bStart, bEnd) => ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd);

// Máximo número de intervalos [start, end) que se solapan en algún instante de [start, end).
export function maxConcurrent(intervals, start, end) {
  const s = ms(start);
  const e = ms(end);
  const rel = intervals.map((i) => ({ start: ms(i.start), end: ms(i.end) })).filter((i) => i.start < e && i.end > s);
  if (rel.length === 0) return 0;
  const points = [s, ...rel.map((i) => i.start).filter((p) => p > s)];
  let max = 0;
  points.forEach((p) => {
    let c = 0;
    rel.forEach((i) => {
      if (i.start <= p && i.end > p) c += 1;
    });
    if (c > max) max = c;
  });
  return max;
}

export function walkInsApply(start, now = Date.now(), horizonMin = LIMITS.walkInHorizonMin) {
  return ms(start) < ms(now) + horizonMin * 60000;
}

export function freeSpots({ capacity, walkIns = 0, allocations = [], start, end, now = Date.now(), walkInHorizonMin = LIMITS.walkInHorizonMin }) {
  if (!capacity) return 0;
  const used = maxConcurrent(allocations, start, end);
  const walk = walkInsApply(start, now, walkInHorizonMin) ? walkIns : 0;
  return Math.max(0, capacity - used - walk);
}

// Desglose para el panel: ocupación AHORA (instante actual).
export function usageNow({ allocations = [], now = Date.now() }) {
  const t = ms(now);
  let reserved = 0;
  let held = 0;
  allocations.forEach((a) => {
    if (ms(a.start) <= t && ms(a.end) > t) {
      if (a.kind === 'hold') held += 1;
      else reserved += 1;
    }
  });
  return { reserved, held };
}

// Línea de tiempo de un día: libres por bloque de `stepMin` minutos.
export function timeline({ capacity, walkIns, allocations, from, to, stepMin = 60, now = Date.now(), walkInHorizonMin }) {
  const out = [];
  for (let t = ms(from); t < ms(to); t += stepMin * 60000) {
    const end = Math.min(t + stepMin * 60000, ms(to));
    out.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString(), free: freeSpots({ capacity, walkIns, allocations, start: t, end, now, walkInHorizonMin }) });
  }
  return out;
}
