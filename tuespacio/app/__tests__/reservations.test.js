// Reservas: transacción T0 (T11→T13), compensaciones, idempotencia, concurrencia, sobreventa,
// vencimiento de la retención, horario, cancelación y ciclo llegada/salida.
import { call, DEMO, freshDb, idemKey, login, reservationBody, setClock, startIn } from './support/backend';
import { clock, findSpace, freeFor, getDb } from '../src/api/mock/db';
import { faults } from '../src/api/mock/demoControls';
import * as payments from '../src/api/mock/services/payments';
import { HOLD_MINUTES } from '../src/domain/rules';

let driver;
let driver2;
let t;
beforeEach(async () => {
  freshDb();
  t = setClock(); // martes 10:00 en Bogotá
  driver = await login(DEMO.driver);
  driver2 = await login(DEMO.driver2, 'TuEspacio2026!');
});

const reserve = (overrides = {}, token = driver) => call('POST', '/reservations', reservationBody(overrides), token);
const steps = (txId) => getDb().txLog.find((x) => x.id === txId).steps.map((s) => `${s.step}:${s.status}`);
const lastTx = () => getDb().txLog[0];
const confirmedAt = (spaceId) => getDb().reservations.filter((r) => r.spaceId === spaceId && ['confirmed', 'active'].includes(r.status)).length;

describe('T0 · camino feliz', () => {
  test('ejecuta T11→T12→T21→T22→T23→T13 y confirma con código y monto', async () => {
    const { data: r } = await reserve({ spaceId: 's-emp-4', durationMin: 90 });
    expect(r).toMatchObject({ status: 'confirmed', amount: 10000, payment: { status: 'captured' } });
    expect(r.code).toMatch(/^TE-[A-Z0-9]{4}$/);
    expect(steps(r.txId).filter((s) => s.endsWith(':ok')).map((s) => s.split(':')[0])).toEqual(['T11', 'T12', 'T21', 'T22', 'T23', 'T13']);
    expect(lastTx().outcome).toBe('committed');
  });

  test('la reserva ocupa un cupo y no deja retenciones colgadas', async () => {
    const before = freeFor(findSpace('s-emp-1'), 'car');
    await reserve({ spaceId: 's-emp-1' });
    expect(freeFor(findSpace('s-emp-1'), 'car')).toBe(before - 1);
    expect(getDb().holds).toHaveLength(0);
  });

  test('la reserva aparece en "mis reservas" del conductor y en el panel del dueño', async () => {
    const { data: r } = await reserve({ spaceId: 's-emp-1' });
    expect((await call('GET', '/me/reservations', null, driver)).data.map((x) => x.id)).toContain(r.id);
    const owner = await login(DEMO.owner);
    expect((await call('GET', '/spaces/s-emp-1/reservations', null, owner)).data.map((x) => x.id)).toContain(r.id);
  });
});

describe('T0 · fallas y compensaciones (nunca se cobra)', () => {
  test('cupo ocupado: aborta en T11 antes de cobrar y ofrece alternativas con cupo', async () => {
    faults.nextReservation = 'taken';
    const spy = jest.spyOn(payments, 'authorize');
    const { error } = await reserve({ spaceId: 's-emp-1' });
    expect(error).toMatchObject({ code: 'SPACE_TAKEN', status: 409 });
    expect(spy).not.toHaveBeenCalled();
    expect(error.details.alternatives.length).toBeGreaterThan(0);
    expect(error.details.alternatives.every((s) => s.availability.car.free > 0 && s.id !== 's-emp-1')).toBe(true);
    expect(steps(error.details.txId)).toContain('T11:fail');
    spy.mockRestore();
  });

  test('pago rechazado: T21 falla, C12 libera el cupo y no queda reserva', async () => {
    faults.nextReservation = 'declined';
    const before = freeFor(findSpace('s-cli-1'), 'car');
    const { error } = await reserve();
    expect(error).toMatchObject({ code: 'PAYMENT_DECLINED', status: 402 });
    expect(steps(error.details.txId)).toEqual(expect.arrayContaining(['T21:fail', 'C12:comp']));
    expect(freeFor(findSpace('s-cli-1'), 'car')).toBe(before);
    expect(getDb().reservations.filter((r) => r.txId === error.details.txId)).toHaveLength(0);
  });

  test('timeout de la pasarela: 3 reintentos con la misma llave y compensación C12', async () => {
    faults.nextReservation = 'timeout';
    const body = reservationBody();
    const { error } = await call('POST', '/reservations', body, driver);
    expect(error).toMatchObject({ code: 'GATEWAY_TIMEOUT', status: 504 });
    const s = getDb().txLog[0].steps;
    expect(s.filter((x) => x.status === 'retry')).toHaveLength(3);
    expect(s.filter((x) => x.status === 'retry').every((x) => x.detail.includes(body.idempotencyKey.slice(0, 8)))).toBe(true);
    expect(steps(error.details.txId)).toContain('C12:comp');
    expect(getDb().holds).toHaveLength(0);
  });

  test('retención vencida antes de capturar: no cobra y compensa C22, C21 y C12', async () => {
    faults.nextReservation = 'expired';
    const capture = jest.spyOn(payments, 'capture');
    const voidAuth = jest.spyOn(payments, 'voidAuthorization');
    const { error } = await reserve();
    expect(error).toMatchObject({ code: 'HOLD_EXPIRED', status: 409 });
    expect(capture).not.toHaveBeenCalled();
    expect(voidAuth).toHaveBeenCalledTimes(1);
    expect(steps(error.details.txId)).toEqual(expect.arrayContaining(['T23:fail', 'C22:comp', 'C21:comp', 'C12:comp']));
    capture.mockRestore();
    voidAuth.mockRestore();
  });

  test('tras un aborto, la falla forzada se consume y la siguiente reserva funciona', async () => {
    faults.nextReservation = 'declined';
    await reserve();
    expect((await reserve()).data.status).toBe('confirmed');
  });
});

describe('vencimiento de la retención', () => {
  test(`una retención abandonada deja de contar a los ${HOLD_MINUTES} min`, () => {
    const space = findSpace('s-emp-4'); // 1 cupo
    getDb().holds.push({ id: 'h-x', spaceId: space.id, vehicle: 'car', expiresAt: clock.now() + HOLD_MINUTES * 60000 });
    expect(freeFor(space, 'car')).toBe(0);
    t.advance(HOLD_MINUTES * 60000 - 1);
    expect(freeFor(space, 'car')).toBe(0);
    t.advance(1);
    expect(freeFor(space, 'car')).toBe(1);
  });
});

describe('concurrencia y sobreventa', () => {
  test('dos conductores por el último cupo: exactamente uno gana', async () => {
    const [a, b] = await Promise.all([reserve({ spaceId: 's-emp-4' }, driver), reserve({ spaceId: 's-emp-4' }, driver2)]);
    const outcomes = [a, b].map((x) => (x.data ? 'ok' : x.error.code)).sort();
    expect(outcomes).toEqual(['SPACE_TAKEN', 'ok']);
    expect(confirmedAt('s-emp-4')).toBe(1);
  });

  test('20 solicitudes simultáneas sobre 2 cupos nunca sobrevenden', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve({ spaceId: 's-cli-4' }, i % 2 ? driver : driver2)));
    expect(results.filter((x) => x.data)).toHaveLength(2);
    expect(results.filter((x) => x.error).every((x) => x.error.code === 'SPACE_TAKEN')).toBe(true);
    expect(confirmedAt('s-cli-4')).toBe(2);
    expect(freeFor(findSpace('s-cli-4'), 'car')).toBe(0);
  });

  test('cupos ocupados por entradas sin reserva también bloquean reservas', async () => {
    const owner = await login(DEMO.host3);
    await call('POST', '/spaces/s-cli-4/occupancy', { vehicle: 'car', delta: 1 }, owner);
    await call('POST', '/spaces/s-cli-4/occupancy', { vehicle: 'car', delta: 1 }, owner);
    expect((await reserve({ spaceId: 's-cli-4' })).error.code).toBe('SPACE_TAKEN');
  });

  test('el último cupo liberado por una cancelación vuelve a estar disponible', async () => {
    const { data: r } = await reserve({ spaceId: 's-emp-4' });
    expect((await reserve({ spaceId: 's-emp-4' }, driver2)).error.code).toBe('SPACE_TAKEN');
    await call('POST', `/reservations/${r.id}/cancel`, null, driver);
    expect((await reserve({ spaceId: 's-emp-4' }, driver2)).data.status).toBe('confirmed');
  });
});

describe('idempotencia', () => {
  test('reintento con la misma llave devuelve la misma reserva sin nuevo cobro', async () => {
    const body = reservationBody();
    const first = await call('POST', '/reservations', body, driver);
    const authorize = jest.spyOn(payments, 'authorize');
    const retry = await call('POST', '/reservations', body, driver);
    expect(retry.data.id).toBe(first.data.id);
    expect(authorize).not.toHaveBeenCalled();
    authorize.mockRestore();
  });

  test('envíos simultáneos con la misma llave crean una sola reserva', async () => {
    const body = reservationBody();
    const results = await Promise.all([1, 2, 3].map(() => call('POST', '/reservations', body, driver)));
    expect(new Set(results.map((x) => x.data.id)).size).toBe(1);
    expect(getDb().reservations.filter((r) => r.driverId === 'u-driver' && r.status === 'confirmed')).toHaveLength(1);
    expect(getDb().txLog.filter((x) => x.meta.idempotencyKey === body.idempotencyKey)).toHaveLength(1);
  });

  test('la misma llave con otro contenido → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const body = reservationBody();
    await call('POST', '/reservations', body, driver);
    const { error } = await call('POST', '/reservations', { ...body, durationMin: 120 }, driver);
    expect(error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
  });

  test('las llaves son por usuario: otro conductor con la misma llave no recibe la reserva ajena', async () => {
    const body = reservationBody();
    const mine = await call('POST', '/reservations', body, driver);
    const theirs = await call('POST', '/reservations', body, driver2);
    expect(theirs.data.id).not.toBe(mine.data.id);
    expect(theirs.data.driverId).toBe('u-juan');
  });

  test('tras un rechazo definitivo la llave se libera y puede reintentarse', async () => {
    const body = reservationBody();
    faults.nextReservation = 'declined';
    expect((await call('POST', '/reservations', body, driver)).error.code).toBe('PAYMENT_DECLINED');
    expect((await call('POST', '/reservations', body, driver)).data.status).toBe('confirmed');
  });

  test('cada reserva recibe un id único aunque se creen en el mismo instante', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve({ idempotencyKey: idemKey() })));
    expect(new Set(results.map((x) => x.data.id)).size).toBe(5);
  });
});

describe('disponibilidad por horario', () => {
  test('dentro del horario se reserva', async () => {
    expect((await reserve({ spaceId: 's-emp-1', startAt: startIn(t, 60), durationMin: 120 })).data.status).toBe('confirmed');
  });

  test('terminar después del cierre → 409 OUTSIDE_SCHEDULE (AFTER_CLOSE) sin iniciar la T0', async () => {
    const before = getDb().txLog.length;
    // Garaje Cra. 11 cierra a las 19:00; 18:00 + 2 h excede.
    const { error } = await reserve({ spaceId: 's-emp-4', startAt: startIn(t, 8 * 60), durationMin: 120 });
    expect(error).toMatchObject({ code: 'OUTSIDE_SCHEDULE', status: 409, details: { reason: 'AFTER_CLOSE' } });
    expect(getDb().txLog.length).toBe(before);
  });

  test('antes de abrir → BEFORE_OPEN', async () => {
    const early = setClock('2026-11-24T05:00:00-05:00');
    const { error } = await reserve({ spaceId: 's-emp-1', startAt: startIn(early, 15) });
    expect(error.details.reason).toBe('BEFORE_OPEN');
  });

  test('domingo en un espacio de lunes a sábado → CLOSED_DAY', async () => {
    const sunday = setClock('2026-11-29T10:00:00-05:00');
    const { error } = await reserve({ spaceId: 's-emp-1', startAt: startIn(sunday, 15) }, await login(DEMO.driver));
    expect(error.details.reason).toBe('CLOSED_DAY');
  });

  test('un espacio 24 h acepta reservas de madrugada', async () => {
    // El reloj salta días hacia adelante: el token anterior venció, se inicia sesión de nuevo.
    const night = setClock('2026-11-29T02:00:00-05:00');
    const token = await login(DEMO.driver);
    expect((await reserve({ spaceId: 's-cli-1', startAt: startIn(night, 15) }, token)).data.status).toBe('confirmed');
  });

  test('el catálogo informa si el espacio está abierto ahora', async () => {
    setClock('2026-11-24T21:30:00-05:00');
    const { data } = await call('GET', '/spaces/s-emp-4');
    expect(data.openNow).toBe(false);
    expect((await call('GET', '/spaces/s-cli-1')).data.openNow).toBe(true);
  });
});

describe('validación de la solicitud', () => {
  test.each([
    [{ vehicle: 'bus' }, 'vehicle'],
    [{ durationMin: 0 }, 'durationMin'],
    [{ durationMin: 25 * 60 }, 'durationMin'],
    [{ startAt: 'mañana' }, 'startAt'],
    [{ idempotencyKey: '' }, 'idempotencyKey'],
  ])('%j → 422 con el campo %s', async (overrides, field) => {
    const { error } = await reserve(overrides);
    expect(error.status).toBe(422);
    expect(error.details.fields).toHaveProperty(field);
  });

  test('una llegada en el pasado se rechaza', async () => {
    const { error } = await reserve({ startAt: startIn(t, -30) });
    expect(error.details.fields).toHaveProperty('startAt');
  });

  test('vehículo no aceptado por el espacio → 422 VEHICLE_NOT_ACCEPTED', async () => {
    expect((await reserve({ spaceId: 's-emp-3', vehicle: 'moto' })).error.code).toBe('VEHICLE_NOT_ACCEPTED');
  });

  test('espacio pausado → 409 SPACE_UNAVAILABLE', async () => {
    findSpace('s-cli-1').status = 'paused';
    expect((await reserve()).error.code).toBe('SPACE_UNAVAILABLE');
  });
});

describe('cancelación, reembolso, llegada y salida', () => {
  test('cancelar una reserva confirmada la marca reembolsada y libera el cupo', async () => {
    const { data: r } = await reserve({ spaceId: 's-emp-4' });
    const refund = jest.spyOn(payments, 'refund');
    const { data } = await call('POST', `/reservations/${r.id}/cancel`, null, driver);
    expect(data).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
    expect(data.payment.refundedAt).toEqual(expect.any(String));
    expect(refund).toHaveBeenCalledTimes(1);
    expect(freeFor(findSpace('s-emp-4'), 'car')).toBe(1);
    refund.mockRestore();
  });

  test('dos cancelaciones simultáneas reembolsan una sola vez', async () => {
    const { data: r } = await reserve();
    const refund = jest.spyOn(payments, 'refund');
    const results = await Promise.all([1, 2].map(() => call('POST', `/reservations/${r.id}/cancel`, null, driver)));
    expect(results.filter((x) => x.data)).toHaveLength(1);
    expect(results.find((x) => x.error).error.code).toBe('INVALID_STATE');
    expect(refund).toHaveBeenCalledTimes(1);
    refund.mockRestore();
  });

  test('máquina de estados: confirmada → en curso → finalizada', async () => {
    const { data: r } = await reserve();
    expect((await call('POST', `/reservations/${r.id}/check-out`, null, driver)).error.code).toBe('INVALID_STATE');
    const active = await call('POST', `/reservations/${r.id}/check-in`, null, driver);
    expect(active.data).toMatchObject({ status: 'active', checkInAt: expect.any(String) });
    expect((await call('POST', `/reservations/${r.id}/cancel`, null, driver)).error.code).toBe('INVALID_STATE');
    expect((await call('POST', `/reservations/${r.id}/check-in`, null, driver)).error.code).toBe('INVALID_STATE');
    const done = await call('POST', `/reservations/${r.id}/check-out`, null, driver);
    expect(done.data).toMatchObject({ status: 'completed', checkOutAt: expect.any(String) });
  });

  test('reserva inexistente → 404', async () => {
    expect((await call('GET', '/reservations/r-nada', null, driver)).error.status).toBe(404);
  });
});
