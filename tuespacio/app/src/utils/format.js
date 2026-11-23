// Formateadores sin depender de Intl (Hermes en Android no siempre trae todos los locales).
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatCOP(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value).toString();
  return '$ ' + rounded.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const pad = (n) => (n < 10 ? '0' + n : '' + n);

export function formatTime(iso) {
  const d = new Date(iso);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function formatDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === tomorrow.toDateString()) return 'Mañana';
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

export function formatDateTime(iso) {
  return formatDay(iso) + ', ' + formatTime(iso);
}

export function formatDuration(minutes) {
  if (minutes < 60) return minutes + ' min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? h + ' h ' + m + ' min' : h + ' h';
}

export function formatDistance(meters) {
  if (meters < 1000) return meters + ' m';
  return (meters / 1000).toFixed(1).replace('.', ',') + ' km';
}

export function formatHeight(meters) {
  return meters.toFixed(2).replace('.', ',') + ' m';
}

export const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export const isValidTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
