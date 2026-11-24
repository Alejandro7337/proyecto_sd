// Validación compartida (cliente, backend simulado y servidor). Devuelve CÓDIGOS por campo
// (ver messages.js); la traducción a texto se hace al final, según el idioma.
import { HOST_SPACE_TYPES, LIMITS, RATE_UNITS, SELF_SIGNUP_ROLES, SPACE_STATUSES, VEHICLES, VEHICLE_TYPES } from './rules.js';
import { normalizeClose, validateWeekly } from './schedule.js';

export const normalizeEmail = (v) => String(v || '').trim().toLowerCase();
export const isValidEmail = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(String(v || '').trim());
export const isStrongPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 128 && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v) && /\d/.test(v);
export const normalizePlate = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Placas colombianas: carro ABC123, moto ABC12D (también ABC12).
export const isValidPlate = (v) => /^[A-Z]{3}\d{3}$|^[A-Z]{3}\d{2}[A-Z]?$/.test(normalizePlate(v));
export const isReservationCode = (v) => /^TE-[A-Z0-9]{4,6}$/.test(String(v || '').trim().toUpperCase());

const MAX_RATE = { minute: 2000, hour: 100000 };
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const hasOwn = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

export function validateRegistration(input = {}) {
  const fields = {};
  if (str(input.name).length < 3) fields.name = 'NAME_FULL';
  else if (str(input.name).length > 80) fields.name = 'NAME_MAX';
  if (!isValidEmail(input.email)) fields.email = 'EMAIL_INVALID';
  if (!isStrongPassword(input.password)) fields.password = 'PASSWORD_WEAK';
  if (!SELF_SIGNUP_ROLES.includes(input.role)) fields.role = 'ROLE_NOT_ALLOWED';
  if (input.role === 'driver' && !VEHICLES[input.vehicle]) fields.vehicle = 'VEHICLE_REQUIRED';
  return fields;
}

export function validateVehicleInput(input = {}, { partial = false } = {}) {
  const fields = {};
  if ((!partial || hasOwn(input, 'type')) && !VEHICLES[input.type]) fields.type = 'VEHICLE_REQUIRED';
  if ((!partial || hasOwn(input, 'label')) && (str(input.label).length < 2 || str(input.label).length > 40)) fields.label = 'LABEL_MIN';
  if (hasOwn(input, 'plate') && input.plate && !isValidPlate(input.plate)) fields.plate = 'PLATE_INVALID';
  if (hasOwn(input, 'heightM') && input.heightM !== null && input.heightM !== '' && input.heightM !== undefined) {
    const h = Number(input.heightM);
    if (!(h >= 1 && h <= 4)) fields.heightM = 'VEHICLE_HEIGHT_RANGE';
  }
  return fields;
}

// Valida campos editables de un espacio. `current` es el estado actual (para validaciones parciales).
// Devuelve { fields, value } con el valor normalizado de los campos presentes.
export function validateSpaceInput(input = {}, { mode = 'update', current = null } = {}) {
  const fields = {};
  const value = {};
  const creating = mode === 'create';

  if (creating || hasOwn(input, 'name')) {
    const v = str(input.name);
    if (v.length < 3) fields.name = 'NAME_MIN';
    else if (v.length > 80) fields.name = 'NAME_MAX';
    value.name = v;
  }
  if (creating || hasOwn(input, 'address')) {
    const v = str(input.address);
    if (v.length < 5) fields.address = 'ADDRESS_MIN';
    else if (v.length > 120) fields.address = 'ADDRESS_MAX';
    value.address = v;
  }
  if (creating) {
    if (!str(input.destinationId)) fields.destinationId = 'DESTINATION_REQUIRED';
    value.destinationId = str(input.destinationId);
    if (!HOST_SPACE_TYPES.includes(input.hostType)) fields.hostType = 'HOST_TYPE_REQUIRED';
    value.hostType = input.hostType;
    if (input.identityConsent !== true) fields.identityConsent = 'IDENTITY_CONSENT';
  }

  let capacity = current?.capacity || null;
  if (creating || hasOwn(input, 'capacity')) {
    capacity = {};
    VEHICLE_TYPES.forEach((v) => {
      const cap = Number(input.capacity?.[v] ?? 0);
      if (!Number.isInteger(cap) || cap < 0 || cap > 2000) fields['capacity.' + v] = 'CAPACITY_INVALID';
      capacity[v] = Number.isInteger(cap) ? cap : 0;
    });
    if (VEHICLE_TYPES.every((v) => !capacity[v])) fields.capacity = 'CAPACITY_NONE';
    value.capacity = capacity;
  }

  if (creating || hasOwn(input, 'rates') || hasOwn(input, 'capacity')) {
    const rates = {};
    const source = hasOwn(input, 'rates') ? input.rates || {} : current?.rates || {};
    VEHICLE_TYPES.forEach((v) => {
      const cap = capacity ? capacity[v] : 0;
      const r = source[v];
      if (!cap) {
        rates[v] = null;
        return;
      }
      const price = Number(r?.price);
      if (!r || !RATE_UNITS[r.unit]) fields['rates.' + v] = r ? 'RATE_UNIT' : 'RATE_REQUIRED';
      else if (!(price > 0) || !Number.isFinite(price)) fields['rates.' + v] = 'RATE_REQUIRED';
      else if (price > MAX_RATE[r.unit]) fields['rates.' + v] = 'RATE_TOO_HIGH';
      rates[v] = r && RATE_UNITS[r.unit] ? { unit: r.unit, price: Math.round(price) } : null;
    });
    value.rates = rates;
  }

  if (creating || hasOwn(input, 'schedule')) {
    const s = input.schedule || {};
    let list = Array.isArray(s.weekly) ? s.weekly : Array.isArray(s) ? s : null;
    if (!list && s.days) {
      // Formato heredado { open, close, days } → por día.
      const presets = { 'Lun – Vie': [1, 2, 3, 4, 5], 'Lun – Sáb': [1, 2, 3, 4, 5, 6], 'Todos los días': [0, 1, 2, 3, 4, 5, 6] };
      list = (presets[s.days] || []).map((weekday) => ({ weekday, open: str(s.open), close: str(s.close) }));
      if (!presets[s.days]) fields['schedule.days'] = 'DAYS_REQUIRED';
    }
    list = (list || []).map((d) => ({ weekday: Number(d.weekday), open: str(d.open), close: normalizeClose(str(d.close), str(d.open)) }));
    Object.assign(fields, validateWeekly(list));
    // Compatibilidad con los campos del formulario anterior (un solo horario).
    if (fields['schedule.days'] === undefined && list.length) {
      const anyOpen = Object.keys(fields).find((k) => /^schedule\.\d\.open$/.test(k));
      const anyClose = Object.keys(fields).find((k) => /^schedule\.\d\.close$/.test(k));
      if (anyOpen) fields['schedule.open'] = fields[anyOpen];
      if (anyClose) fields['schedule.close'] = fields[anyClose];
    }
    value.weekly = list;
  }

  if (creating || hasOwn(input, 'conditions')) {
    const c = input.conditions || {};
    let maxHeight = null;
    if (c.maxHeight !== null && c.maxHeight !== undefined && c.maxHeight !== '') {
      const h = Number(String(c.maxHeight).replace(',', '.'));
      if (!(h >= 1.5 && h <= 4)) fields['conditions.maxHeight'] = 'HEIGHT_RANGE';
      maxHeight = Math.round(h * 100) / 100;
    }
    value.conditions = { covered: !!c.covered, keys: !!c.keys, maxHeight };
  }

  if (hasOwn(input, 'status')) {
    if (!SPACE_STATUSES.includes(input.status)) fields.status = 'STATUS_INVALID';
    value.status = input.status;
  }
  return { fields, value };
}

// Valida una solicitud de reserva en el tiempo (no la disponibilidad).
export function validateBookingWindow({ startAt, durationMin }, now = Date.now(), limits = LIMITS) {
  const fields = {};
  const start = new Date(startAt).getTime();
  if (!startAt || Number.isNaN(start)) fields.startAt = 'START_INVALID';
  else if (start < now - limits.startToleranceMin * 60000 || start > now + limits.bookingHorizonDays * 86400000) fields.startAt = 'START_INVALID';
  if (!Number.isInteger(durationMin) || durationMin < limits.minDurationMin || durationMin > limits.maxDurationMin) fields.durationMin = 'DURATION_INVALID';
  return fields;
}
