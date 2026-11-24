// Horarios semanales y zonas horarias. Todo cálculo de franjas se hace en la zona del espacio
// (p. ej. America/Bogota), no en la del teléfono. Convención de días: 0 = domingo … 6 = sábado.
// Usa Intl.DateTimeFormat con timeZone; si el motor JS no lo soporta (algunos Hermes antiguos),
// cae a un desfase fijo conocido. Colombia no tiene horario de verano (UTC−5 todo el año).

export const DEFAULT_TIMEZONE = 'America/Bogota';
const FIXED_OFFSETS = { 'America/Bogota': -300, 'America/Lima': -300, 'America/Panama': -300, UTC: 0, 'Etc/UTC': 0 };

export const DAY_SHORT_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// Orden de presentación: lunes primero.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DAY_PRESETS = {
  'Lun – Vie': [1, 2, 3, 4, 5],
  'Lun – Sáb': [1, 2, 3, 4, 5, 6],
  'Todos los días': [0, 1, 2, 3, 4, 5, 6],
};

const pad = (n) => (n < 10 ? '0' + n : '' + n);

export const isValidTime = (v) => typeof v === 'string' && /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(v.trim());
export const timeToMinutes = (v) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
};
export const minutesToTime = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
// El prototipo usaba 00:00–23:59 como "24 horas": en ese caso 23:59 se normaliza a 24:00 (permite
// cruzar la medianoche). Con otra apertura, 23:59 es un cierre literal.
export const normalizeClose = (v, open) => (v === '23:59' && (open === undefined || open === '00:00') ? '24:00' : v);

const dtfCache = {};
function formatterFor(tz) {
  if (!(tz in dtfCache)) {
    try {
      dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      dtfCache[tz].formatToParts(new Date(0));
    } catch {
      dtfCache[tz] = null;
    }
  }
  return dtfCache[tz];
}

// Partes de fecha/hora locales de `date` en la zona `tz`.
export function zonedParts(date, tz = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  const f = formatterFor(tz);
  let y, mo, da, h, mi;
  if (f) {
    const parts = {};
    f.formatToParts(d).forEach((p) => {
      parts[p.type] = p.value;
    });
    y = Number(parts.year);
    mo = Number(parts.month);
    da = Number(parts.day);
    h = Number(parts.hour) % 24;
    mi = Number(parts.minute);
  } else {
    const off = FIXED_OFFSETS[tz] ?? FIXED_OFFSETS[DEFAULT_TIMEZONE];
    const shifted = new Date(d.getTime() + off * 60000);
    y = shifted.getUTCFullYear();
    mo = shifted.getUTCMonth() + 1;
    da = shifted.getUTCDate();
    h = shifted.getUTCHours();
    mi = shifted.getUTCMinutes();
  }
  const weekday = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
  return { year: y, month: mo, day: da, hour: h, minute: mi, weekday, date: `${y}-${pad(mo)}-${pad(da)}`, time: `${pad(h)}:${pad(mi)}` };
}

export function offsetMinutes(date, tz = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

// Convierte fecha local 'YYYY-MM-DD' + hora 'HH:MM' (admite '24:00') en la zona tz → Date (UTC).
export function zonedToUtc(dateStr, timeStr, tz = DEFAULT_TIMEZONE) {
  const [y, mo, da] = dateStr.split('-').map(Number);
  const mins = timeToMinutes(timeStr);
  const naive = Date.UTC(y, mo - 1, da, 0, 0) + mins * 60000;
  const first = naive - offsetMinutes(new Date(naive), tz) * 60000;
  const second = naive - offsetMinutes(new Date(first), tz) * 60000;
  return new Date(second);
}

export const localDate = (date, tz = DEFAULT_TIMEZONE) => zonedParts(date, tz).date;
export const localTime = (date, tz = DEFAULT_TIMEZONE) => zonedParts(date, tz).time;

export function addDays(dateStr, n) {
  const [y, mo, da] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const weekdayOf = (dateStr) => {
  const [y, mo, da] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
};

// Horario semanal normalizado: arreglo de 7 posiciones (0 = domingo) con { open, close } o null (cerrado).
export function normalizeWeekly(input) {
  const out = [null, null, null, null, null, null, null];
  if (!input) return out;
  if (Array.isArray(input.weekly)) return normalizeWeekly(input.weekly);
  if (Array.isArray(input)) {
    input.forEach((d) => {
      if (d && Number.isInteger(d.weekday) && d.weekday >= 0 && d.weekday <= 6 && d.open && d.close) {
        out[d.weekday] = { open: d.open, close: normalizeClose(d.close, d.open) };
      }
    });
    return out;
  }
  // Formato heredado del prototipo: { open, close, days: 'Lun – Sáb' }.
  const days = DAY_PRESETS[input.days] || [];
  days.forEach((wd) => {
    out[wd] = { open: input.open, close: normalizeClose(input.close, input.open) };
  });
  return out;
}

export const weeklyToList = (weekly) =>
  weekly.map((d, weekday) => (d ? { weekday, open: d.open, close: d.close } : null)).filter(Boolean);

// Resumen legible en grupos de días consecutivos con el mismo horario (lunes primero).
export function summarizeWeekly(weekly, dayNames = DAY_SHORT_ES) {
  const groups = [];
  WEEK_ORDER.forEach((wd) => {
    const d = weekly[wd];
    const last = groups[groups.length - 1];
    if (d && last && last.open === d.open && last.close === d.close && last.lastIdx === WEEK_ORDER.indexOf(wd) - 1) {
      last.to = wd;
      last.lastIdx += 1;
    } else if (d) {
      groups.push({ from: wd, to: wd, open: d.open, close: d.close, lastIdx: WEEK_ORDER.indexOf(wd) });
    }
  });
  return groups.map((g) => {
    let days;
    if (g.from === 1 && g.to === 0 && groups.length === 1) days = 'Todos los días';
    else if (g.from === g.to) days = dayNames[g.from];
    else days = `${dayNames[g.from]} – ${dayNames[g.to]}`;
    return { days, from: g.from, to: g.to, open: g.open, close: g.close === '24:00' ? '23:59' : g.close };
  });
}

// DTO compatible con el contrato anterior ({ open, close, days }) más el detalle por día.
export function scheduleDTO(weekly, tz = DEFAULT_TIMEZONE) {
  const groups = summarizeWeekly(weekly);
  const main = groups[0] || { days: 'Cerrado', open: '00:00', close: '00:00' };
  return {
    open: main.open,
    close: main.close,
    days: groups.length > 1 ? groups.map((g) => `${g.days} ${g.open}–${g.close}`).join(' · ') : main.days,
    weekly: weeklyToList(weekly),
    groups: groups.map(({ days, from, to, open, close }) => ({ days, from, to, open, close })),
    timezone: tz,
  };
}

export function validateWeekly(list) {
  const fields = {};
  if (!Array.isArray(list) || list.length === 0) {
    fields['schedule.days'] = 'DAYS_REQUIRED';
    return fields;
  }
  const seen = new Set();
  list.forEach((d) => {
    const k = `schedule.${d?.weekday}`;
    if (!d || !Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6 || seen.has(d.weekday)) {
      fields['schedule.days'] = 'DAYS_REQUIRED';
      return;
    }
    seen.add(d.weekday);
    if (!isValidTime(d.open) || d.open === '24:00') fields[k + '.open'] = 'TIME_FORMAT';
    else if (!isValidTime(normalizeClose(d.close, d.open))) fields[k + '.close'] = 'TIME_FORMAT';
    else if (timeToMinutes(d.open) >= timeToMinutes(normalizeClose(d.close, d.open))) fields[k + '.close'] = 'CLOSE_BEFORE_OPEN';
  });
  return fields;
}

// Ventana de apertura de un día local, en instantes UTC.
export function openWindow(weekly, tz, dateStr) {
  const d = weekly[weekdayOf(dateStr)];
  if (!d) return null;
  return { open: zonedToUtc(dateStr, d.open, tz), close: zonedToUtc(dateStr, d.close, tz), closesAtMidnight: d.close === '24:00' };
}

// ¿La franja [start, end) cae completa dentro del horario? Puede cruzar la medianoche solo si el
// día cierra a las 24:00 y el siguiente abre a las 00:00.
export function fitsSchedule(weekly, tz, start, end) {
  let cursor = new Date(start).getTime();
  const stop = new Date(end).getTime();
  if (!(stop > cursor)) return false;
  for (let guard = 0; guard < 10; guard += 1) {
    const dateStr = localDate(new Date(cursor), tz);
    const w = openWindow(weekly, tz, dateStr);
    if (!w) return false;
    if (cursor < w.open.getTime() || cursor >= w.close.getTime()) return false;
    if (stop <= w.close.getTime()) return true;
    if (!w.closesAtMidnight) return false;
    cursor = w.close.getTime();
  }
  return false;
}

// Horas de llegada posibles para un día local (cada stepMin), que quepan con la duración pedida.
export function startOptions({ weekly, tz, dateStr, now = Date.now(), stepMin = 15, durationMin = 60 }) {
  const w = openWindow(weekly, tz, dateStr);
  if (!w) return [];
  const step = stepMin * 60000;
  const from = Math.max(w.open.getTime(), Math.ceil(now / step) * step);
  const out = [];
  for (let t = from; t < w.close.getTime(); t += step) {
    if (fitsSchedule(weekly, tz, t, t + durationMin * 60000)) out.push(new Date(t).toISOString());
  }
  return out;
}

// Igual que fitsSchedule pero explica el motivo: null | 'CLOSED_DAY' | 'BEFORE_OPEN' | 'AFTER_CLOSE'.
export function scheduleIssueWeekly(weekly, tz, start, end) {
  let cursor = new Date(start).getTime();
  const stop = new Date(end).getTime();
  if (!(stop > cursor)) return 'AFTER_CLOSE';
  for (let guard = 0; guard < 10; guard += 1) {
    const w = openWindow(weekly, tz, localDate(new Date(cursor), tz));
    if (!w) return 'CLOSED_DAY';
    if (cursor < w.open.getTime()) return 'BEFORE_OPEN';
    if (cursor >= w.close.getTime()) return 'AFTER_CLOSE';
    if (stop <= w.close.getTime()) return null;
    if (!w.closesAtMidnight) return 'AFTER_CLOSE';
    cursor = w.close.getTime();
  }
  return 'AFTER_CLOSE';
}

// ¿Está abierto en el instante `at`?
export function isOpenAt(weekly, tz, at) {
  const t = new Date(at).getTime();
  return fitsSchedule(weekly, tz, t, t + 60000);
}
