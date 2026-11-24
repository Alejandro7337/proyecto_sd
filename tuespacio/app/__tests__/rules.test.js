// Pruebas unitarias de reglas de negocio (src/domain/rules.js y utilidades de formato).
import { availabilityStatus, estimateCost, isOpenAt, scheduleIssue } from '../src/domain/rules';
import { formatCOP, formatDuration, isValidEmail, isValidTime } from '../src/utils/format';
import { sanitizePrefs } from '../src/state/Preferences';
import { describeError } from '../src/api/errors';

const at = (iso) => new Date(iso);
const plus = (d, min) => new Date(d.getTime() + min * 60000);

describe('estimateCost — cobro por hora iniciada o por minuto exacto [supuesto]', () => {
  test.each([
    [{ unit: 'hour', price: 5000 }, 60, 5000],
    [{ unit: 'hour', price: 5000 }, 61, 10000],
    [{ unit: 'hour', price: 5000 }, 1, 5000],
    [{ unit: 'minute', price: 138 }, 90, 12420],
  ])('%j por %i min = %i', (rate, minutes, expected) => {
    expect(estimateCost(rate, minutes)).toBe(expected);
  });

  test('sin tarifa no hay precio (vehículo no aceptado)', () => {
    expect(estimateCost(null, 60)).toBeNull();
  });
});

describe('availabilityStatus', () => {
  test.each([
    [10, 40, false, 'available'],
    [4, 40, false, 'available'],
    [3, 40, false, 'few'],
    [1, 1, false, 'few'],
    [0, 40, false, 'full'],
    [5, 0, false, 'unsupported'],
    [5, 40, true, 'paused'],
  ])('libres=%i capacidad=%i pausado=%s → %s', (free, cap, paused, status) => {
    expect(availabilityStatus(free, cap, paused)).toBe(status);
  });
});

describe('scheduleIssue — disponibilidad por horario (hora de Bogotá)', () => {
  const weekday = { open: '06:00', close: '22:00', days: 'Lun – Sáb' };
  const allDay = { open: '00:00', close: '23:59', days: 'Todos los días' };
  const tuesday10 = at('2026-11-24T10:00:00-05:00');
  const sunday10 = at('2026-11-29T10:00:00-05:00');

  test('franja dentro del horario', () => {
    expect(scheduleIssue(weekday, tuesday10, plus(tuesday10, 120))).toBeNull();
  });
  test('terminar exactamente al cierre está permitido', () => {
    const start = at('2026-11-24T21:00:00-05:00');
    expect(scheduleIssue(weekday, start, plus(start, 60))).toBeNull();
  });
  test('un minuto después del cierre no', () => {
    const start = at('2026-11-24T21:00:00-05:00');
    expect(scheduleIssue(weekday, start, plus(start, 61))).toBe('AFTER_CLOSE');
  });
  test('antes de abrir', () => {
    const start = at('2026-11-24T05:30:00-05:00');
    expect(scheduleIssue(weekday, start, plus(start, 60))).toBe('BEFORE_OPEN');
  });
  test('día sin atención (domingo en Lun – Sáb)', () => {
    expect(scheduleIssue(weekday, sunday10, plus(sunday10, 60))).toBe('CLOSED_DAY');
  });
  test('cruzar la medianoche excede el cierre aunque cierre a las 23:59', () => {
    const late = { open: '06:00', close: '23:59', days: 'Todos los días' };
    const start = at('2026-11-24T23:00:00-05:00');
    expect(scheduleIssue(late, start, plus(start, 60))).toBe('AFTER_CLOSE');
  });
  test('24 h todos los días admite cruzar la medianoche', () => {
    const start = at('2026-11-24T23:00:00-05:00');
    expect(scheduleIssue(allDay, start, plus(start, 180))).toBeNull();
  });
  test('24 h de lunes a viernes rechaza entrar en sábado', () => {
    const allWeekdays = { ...allDay, days: 'Lun – Vie' };
    const fridayNight = at('2026-11-27T22:00:00-05:00');
    expect(scheduleIssue(allWeekdays, fridayNight, plus(fridayNight, 180))).toBe('CLOSED_DAY');
  });
  test('isOpenAt refleja apertura y cierre', () => {
    expect(isOpenAt(weekday, at('2026-11-24T21:59:00-05:00'))).toBe(true);
    expect(isOpenAt(weekday, at('2026-11-24T22:00:00-05:00'))).toBe(false);
  });
});

describe('formatos y validaciones', () => {
  test('formatCOP usa separador de miles y tolera valores ausentes', () => {
    expect(formatCOP(1234567)).toBe('$ 1.234.567');
    expect(formatCOP(999.6)).toBe('$ 1.000');
    expect(formatCOP(null)).toBe('—');
    expect(formatCOP(NaN)).toBe('—');
  });
  test('formatDuration', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(135)).toBe('2 h 15 min');
  });
  test.each(['07:00', '23:59', '00:00'])('hora válida %s', (v) => expect(isValidTime(v)).toBe(true));
  test.each(['24:00', '7:00', '12:60', 'aa:bb'])('hora inválida %s', (v) => expect(isValidTime(v)).toBe(false));
  test('isValidEmail', () => {
    expect(isValidEmail(' persona@dominio.co ')).toBe(true);
    expect(isValidEmail('sin-arroba.co')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});

describe('preferencias persistidas', () => {
  test('descarta valores corruptos o idiomas no soportados', () => {
    expect(sanitizePrefs({ dark: 'sí', language: 'klingon', notifications: 0 })).toEqual({ dark: false, language: 'es', notifications: true });
    expect(sanitizePrefs(null)).toEqual({ dark: false, language: 'es', notifications: true });
    expect(sanitizePrefs({ dark: true, language: 'ja', notifications: false })).toEqual({ dark: true, language: 'ja', notifications: false });
  });
});

describe('describeError', () => {
  test('usa el texto de la app para códigos conocidos y el del servidor para los demás', () => {
    expect(describeError({ code: 'PAYMENT_DECLINED' }).title).toBe('Pago rechazado');
    expect(describeError({ code: 'RARO', message: 'detalle' })).toEqual({ title: 'Algo salió mal', message: 'detalle' });
    expect(describeError({ code: 'OUTSIDE_SCHEDULE', message: 'La reserva termina después del cierre.' }).message).toMatch(/^La reserva termina/);
  });
});
