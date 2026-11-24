// Lectura de espacios (con cupos, tarifas vigentes y horario) y cálculo de disponibilidad por franja.
// La regla de disponibilidad es la del dominio compartido (availability.js), idéntica al trigger SQL.
import { LIMITS, VEHICLE_TYPES, availabilityStatus, distanceMeters } from '../../../../app/src/domain/rules.js';
import { freeSpots, usageNow } from '../../../../app/src/domain/availability.js';
import { fitsSchedule, isOpenAt, normalizeWeekly, scheduleDTO } from '../../../../app/src/domain/schedule.js';

const SPACE_SQL = `
  SELECT s.*, d.lat AS dest_lat, d.lng AS dest_lng, d.name AS destination_name,
         u.name AS manager_name, u.identity_status AS manager_identity,
         COALESCE((SELECT json_agg(json_build_object('vehicle', i.vehicle_type, 'capacity', i.capacity, 'walkIns', i.walk_in_occupied))
                     FROM space_inventory i WHERE i.space_id = s.id), '[]') AS inventory,
         COALESCE((SELECT json_agg(json_build_object('vehicle', r.vehicle_type, 'unit', r.unit, 'price', r.price_cop))
                     FROM space_rates r WHERE r.space_id = s.id AND r.effective_to IS NULL), '[]') AS rates,
         COALESCE((SELECT json_agg(json_build_object('weekday', sc.weekday, 'open', sc.open_time, 'close', sc.close_time) ORDER BY sc.weekday)
                     FROM space_schedules sc WHERE sc.space_id = s.id), '[]') AS schedule
    FROM spaces s
    JOIN destinations d ON d.id = s.destination_id
    JOIN users u ON u.id = s.manager_id`;

export async function loadSpaces(client, where = 'TRUE', params = []) {
  return (await client.query(`${SPACE_SQL} WHERE ${where}`, params)).rows.map(hydrate);
}

export async function loadSpace(client, id) {
  return (await loadSpaces(client, 's.id = $1', [id]))[0] || null;
}

function hydrate(row) {
  const capacity = { car: 0, moto: 0 };
  const walkIns = { car: 0, moto: 0 };
  row.inventory.forEach((i) => {
    capacity[i.vehicle] = i.capacity;
    walkIns[i.vehicle] = i.walkIns;
  });
  const rates = { car: null, moto: null };
  row.rates.forEach((r) => {
    if (capacity[r.vehicle] > 0) rates[r.vehicle] = { unit: r.unit, price: r.price };
  });
  return { ...row, capacity, walkIns, rates, weekly: normalizeWeekly(row.schedule) };
}

// Asignaciones (reservas vigentes + retenciones activas) que tocan la franja, por espacio y vehículo.
export async function loadAllocations(client, spaceIds, from, to) {
  if (!spaceIds.length) return new Map();
  const rows = (
    await client.query(
      `SELECT space_id, vehicle_type, kind, lower(period) AS start, upper(period) AS "end"
         FROM capacity_allocations
        WHERE space_id = ANY($1) AND period && tstzrange($2::timestamptz, $3::timestamptz)`,
      [spaceIds, from, to]
    )
  ).rows;
  const map = new Map();
  rows.forEach((r) => {
    const k = `${r.space_id}:${r.vehicle_type}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ start: r.start, end: r.end, kind: r.kind });
  });
  return map;
}

export function slotFrom({ startAt, durationMin }, now = Date.now()) {
  const start = startAt ? new Date(startAt).getTime() : now;
  const minutes = durationMin || 60;
  return { start, end: start + minutes * 60000, durationMin: minutes };
}

// Proyección a coordenadas relativas para el mapa ilustrativo (±1 ≈ 800 m del destino).
function relativePos(space, dest) {
  const dx = (space.public_lng - dest.lng) * Math.cos((dest.lat * Math.PI) / 180) * 111320;
  const dy = (space.public_lat - dest.lat) * 110540;
  const clamp = (v) => Math.max(-0.92, Math.min(0.92, v));
  return { x: clamp(dx / 800), y: clamp(-dy / 800) };
}

const shortName = (full) => {
  const [first, last] = String(full).trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
};

// DTO público de un espacio. `viewer` decide si ve datos privados (dirección exacta de particulares).
export function spaceDTO(s, { allocations = new Map(), slot, now = Date.now(), viewer = null, walkInHorizonMin = LIMITS.walkInHorizonMin, canSeeAddress = false } = {}) {
  const isManager = viewer && viewer.id === s.manager_id;
  const showAddress = s.kind === 'formal' || isManager || canSeeAddress;
  const dest = { lat: s.dest_lat, lng: s.dest_lng };
  const paused = s.status !== 'published';
  const fits = slot ? fitsSchedule(s.weekly, s.timezone, slot.start, slot.end) : true;
  const availability = {};
  VEHICLE_TYPES.forEach((v) => {
    const allocs = allocations.get(`${s.id}:${v}`) || [];
    const cap = s.capacity[v];
    const free = slot ? freeSpots({ capacity: cap, walkIns: s.walkIns[v], allocations: allocs, start: slot.start, end: slot.end, now, walkInHorizonMin }) : 0;
    const usage = usageNow({ allocations: allocs, now: slot ? slot.start : now });
    let status = availabilityStatus(free, cap && s.rates[v] ? cap : 0, paused);
    if (status !== 'paused' && status !== 'unsupported' && !fits) status = 'closed';
    availability[v] = { free: status === 'closed' ? 0 : free, capacity: cap, occupied: s.walkIns[v], reserved: usage.reserved, held: usage.held, status };
  });
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    address: showAddress ? s.address : null,
    addressHint: showAddress ? null : 'Dirección exacta visible al reservar',
    destinationId: s.destination_id,
    location: { lat: s.public_lat, lng: s.public_lng },
    pos: relativePos(s, dest),
    distanceM: distanceMeters(dest, { lat: s.public_lat, lng: s.public_lng }),
    rates: s.rates,
    capacity: s.capacity,
    schedule: scheduleDTO(s.weekly, s.timezone),
    timezone: s.timezone,
    openNow: isOpenAt(s.weekly, s.timezone, now),
    conditions: { covered: s.covered, keys: s.keys_required, maxHeight: s.max_height_m },
    status: s.status,
    plan: s.plan || null,
    hostType: s.host_type || null,
    host: s.kind === 'particular' ? { name: shortName(s.manager_name), identity: s.manager_identity } : null,
    availability,
    slot: slot ? { startAt: new Date(slot.start).toISOString(), endAt: new Date(slot.end).toISOString(), fitsSchedule: fits } : null,
    ...(isManager ? { version: s.version, managed: true } : {}),
  };
}
