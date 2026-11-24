// Reglas de negocio PURAS compartidas por la app (UI y backend simulado) y por el servidor Node
// (server/ importa este archivo). No dependen de React Native ni de Node: solo JavaScript estándar.
// Lo marcado como [supuesto] no está definido en los documentos del proyecto (ver docs/DECISIONES.md).
import { DAY_PRESETS, DEFAULT_TIMEZONE, isOpenAt as isOpenAtWeekly, normalizeWeekly, scheduleIssueWeekly } from './schedule.js';

export const VEHICLES = {
  // Íconos de MaterialCommunityIcons (Ionicons no tiene motocicleta).
  car: { label: 'Carro', icon: 'car-side' },
  moto: { label: 'Moto', icon: 'motorbike' },
};
export const VEHICLE_TYPES = Object.keys(VEHICLES);

export const RATE_UNITS = {
  minute: { label: 'por minuto', short: '/min' },
  hour: { label: 'por hora', short: '/h' },
};

export const SPACE_KINDS = {
  formal: { label: 'Parqueadero', icon: 'business-outline' },
  particular: { label: 'Espacio particular', icon: 'home-outline' },
};

export const HOST_SPACE_TYPES = ['Garaje', 'Lote', 'Antejardín'];
export const SPACE_STATUSES = ['published', 'paused'];

// Ejemplo citado en la presentación de la transacción distribuida ("p. ej. 10 min").
export const HOLD_MINUTES = 10;

// Precio de planes y % de comisión se definen en Fase 0: no se inventan.
// El servidor lo toma de la tabla commission_rules / variable HOST_COMMISSION_RATE.
export const PLANS = ['Básico', 'Destacado'];
export const COMMISSION_RATE = null;

// [supuesto] Opciones de llegada y duración para estimar el valor de la reserva.
export const ARRIVAL_OPTIONS = [15, 30, 60, 120];
export const DURATION_OPTIONS = [60, 120, 240, 480];

// Límites operativos. [supuesto] todos: configurables en el servidor por variables de entorno.
export const LIMITS = {
  minDurationMin: 30,
  maxDurationMin: 24 * 60,
  bookingHorizonDays: 7,
  // Margen para relojes desfasados: se acepta una llegada hasta 5 min en el pasado.
  startToleranceMin: 5,
  // Se puede registrar la llegada desde 15 min antes del inicio.
  earlyCheckInMin: 15,
  // Sin llegada 30 min después del inicio la reserva vence (no-show).
  noShowGraceMin: 30,
  // Las entradas sin reserva se suponen dentro del lote durante las próximas 3 h.
  walkInHorizonMin: 180,
  slotStepMin: 15,
  lowAvailability: 3,
};

// [supuesto] Cobro por hora iniciada; por minuto, minuto exacto. Siempre pesos enteros (COP).
export function estimateCost(rate, durationMin) {
  if (!rate || !(durationMin > 0)) return null;
  if (rate.unit === 'minute') return Math.round(rate.price * durationMin);
  return Math.round(rate.price * Math.ceil(durationMin / 60));
}

// Comisión de Tu Espacio: solo espacios particulares y solo si hay tasa definida.
export function commissionFor(kind, amount, rate) {
  if (kind !== 'particular' || rate === null || rate === undefined || amount === null) return null;
  return Math.round(amount * rate);
}

export function availabilityStatus(free, capacity, paused) {
  if (paused) return 'paused';
  if (!capacity) return 'unsupported';
  if (free <= 0) return 'full';
  if (free <= LIMITS.lowAvailability) return 'few';
  return 'available';
}

export const AVAILABILITY = {
  available: { label: 'Disponible', tone: 'success' },
  few: { label: 'Pocos cupos', tone: 'warning' },
  full: { label: 'Lleno', tone: 'danger' },
  unsupported: { label: 'No recibe este vehículo', tone: 'neutral' },
  paused: { label: 'No publicado', tone: 'neutral' },
  closed: { label: 'Cerrado en ese horario', tone: 'neutral' },
};

// Estados de reserva. holdsCapacity: ocupa cupo en su franja.
export const RESERVATION_STATUS = {
  pending_payment: { label: 'Procesando pago', tone: 'info', holdsCapacity: false, terminal: false },
  confirmed: { label: 'Confirmada', tone: 'info', holdsCapacity: true, terminal: false },
  active: { label: 'En curso', tone: 'success', holdsCapacity: true, terminal: false },
  completed: { label: 'Finalizada', tone: 'neutral', holdsCapacity: false, terminal: true },
  cancelled: { label: 'Cancelada', tone: 'danger', holdsCapacity: false, terminal: true },
  expired: { label: 'Vencida', tone: 'warning', holdsCapacity: false, terminal: true },
  failed: { label: 'No completada', tone: 'danger', holdsCapacity: false, terminal: true },
};
export const CAPACITY_STATUSES = Object.keys(RESERVATION_STATUS).filter((s) => RESERVATION_STATUS[s].holdsCapacity);
export const CURRENT_STATUSES = ['confirmed', 'active'];
export const HISTORY_STATUSES = ['completed', 'cancelled', 'expired'];

const TRANSITIONS = {
  pending_payment: ['confirmed', 'failed'],
  confirmed: ['active', 'cancelled', 'expired'],
  active: ['completed'],
};
export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

export const ROLES = {
  driver: { label: 'Conductor', home: '/driver', selfSignup: true },
  owner: { label: 'Dueño de parqueadero', home: '/owner', selfSignup: false },
  host: { label: 'Anfitrión', home: '/host', selfSignup: true },
};
export const SELF_SIGNUP_ROLES = Object.keys(ROLES).filter((r) => ROLES[r].selfSignup);

export const IDENTITY_STATUSES = ['pending', 'in_review', 'verified', 'rejected'];
// [supuesto] Con la verificación en revisión ya se puede publicar (igual que el prototipo).
export const canHostPublish = (identity) => identity === 'in_review' || identity === 'verified';

// Medios de pago FICTICIOS: el comportamiento determina el resultado de la pasarela simulada.
export const TEST_PAYMENT_METHODS = [
  { brand: 'Prueba', last4: '4242', behavior: 'approve', label: 'Aprueba siempre' },
  { brand: 'Prueba', last4: '0002', behavior: 'decline', label: 'Pago rechazado' },
  { brand: 'Prueba', last4: '0119', behavior: 'timeout', label: 'Pasarela sin respuesta' },
  { brand: 'Prueba', last4: '0341', behavior: 'timeout_then_approve', label: 'Responde tras un reintento' },
];

// Política de cancelación [supuesto]: reembolso total antes de la hora de llegada, sin reembolso después.
export function refundFor(reservation, now = Date.now()) {
  return new Date(reservation.startAt).getTime() > now ? reservation.amount : 0;
}

// Ventana para registrar llegada: desde earlyCheckInMin antes hasta noShowGraceMin después del inicio.
export function checkInWindow(startAt, limits = LIMITS) {
  const start = new Date(startAt).getTime();
  return { from: start - limits.earlyCheckInMin * 60000, until: start + limits.noShowGraceMin * 60000 };
}

// Distancia en metros entre dos coordenadas (haversine).
export function distanceMeters(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const hourlyEquivalent = (rate) => (rate ? (rate.unit === 'minute' ? rate.price * 60 : rate.price) : Infinity);

// Código de reserva legible sin caracteres ambiguos (0/O, 1/I).
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function reservationCode(randomBytes) {
  let out = 'TE-';
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[randomBytes[i] % CODE_ALPHABET.length];
  return out;
}

// ───── Compatibilidad con el backend simulado y las pruebas de la app (sesión QA) ─────
// Aceptan el horario heredado { open, close, days } o el semanal { weekly: [...] }, en hora de Bogotá.

export const SESSION_TTL_HOURS = 12;
export const MAX_DURATION_MIN = LIMITS.maxDurationMin;
export const PAST_START_TOLERANCE_MIN = LIMITS.startToleranceMin;
export const SCHEDULE_DAYS = DAY_PRESETS;
export const DAY_OPTIONS = Object.keys(DAY_PRESETS);
export const SCHEDULE_ISSUES = {
  CLOSED_DAY: 'El espacio no atiende ese día.',
  BEFORE_OPEN: 'La reserva empieza antes de la apertura.',
  AFTER_CLOSE: 'La reserva termina después del cierre.',
};

export const scheduleIssue = (schedule, start, end, tz = schedule?.timezone || DEFAULT_TIMEZONE) =>
  scheduleIssueWeekly(normalizeWeekly(schedule), tz, start, end);

export const isOpenAt = (schedule, at = new Date(), tz = schedule?.timezone || DEFAULT_TIMEZONE) =>
  isOpenAtWeekly(normalizeWeekly(schedule), tz, at);
