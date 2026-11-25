import { toForm, toPayload } from '../src/domain/spaceForm.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReservation } from '../src/api/mock/services/reservations.js';
import { getDb, resetDb, freeFor } from '../src/api/mock/db.js';
import { faults } from '../src/api/mock/demoControls.js';
import { reservationStatus, reservationTab, openReservation } from '../src/domain/rules.js';

const body = (key, patch = {}) => ({ spaceId: 's-emp-4', vehicle: 'car', startAt: new Date(Date.now() + 900000).toISOString(), durationMin: 60, idempotencyKey: key, ...patch });
const driver = () => getDb().users.find(u => u.id === 'u-driver');
const reset = () => { resetDb(); faults.nextReservation = 'none'; };

test('el mock no vende el último cupo dos veces', async () => {
  reset();
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createReservation(driver(), body('concurrency-' + i))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'SPACE_TAKEN').length, 9);
});

test('reintentos simultáneos devuelven la misma reserva', async () => {
  reset();
  const request = body('same-key-123');
  const results = await Promise.all(Array.from({ length: 8 }, () => createReservation(driver(), request)));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(getDb().txLog.length, 1);
});

test('una llave no puede reutilizarse con otros parámetros', async () => {
  reset();
  const request = body('payload-key');
  await createReservation(driver(), request);
  await assert.rejects(() => createReservation(driver(), { ...request, durationMin: 120 }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('las retenciones de dos espacios no comparten el mismo objeto', async () => {
  reset();
  const first = getDb().spaces.find(s => s.id === 's-emp-4');
  const second = getDb().spaces.find(s => s.id === 's-cli-3');
  assert.notEqual(first.held, second.held);
  const results = await Promise.all([createReservation(driver(), body('space-one')), createReservation(driver(), body('space-two', { spaceId: second.id }))]);
  assert.equal(new Set(results.map(r => r.id)).size, 2);
});

test('rechazar el pago libera la retención', async () => {
  reset(); faults.nextReservation = 'declined';
  await assert.rejects(() => createReservation(driver(), body('declined-key')), { code: 'PAYMENT_DECLINED' });
  assert.equal(freeFor(getDb().spaces.find(s => s.id === 's-emp-4'), 'car'), 1);
});

test('una fecha inválida se rechaza antes de retener un cupo', async () => {
  reset();
  await assert.rejects(() => createReservation(driver(), body('bad-date-key', { startAt: 'invalid' })), { code: 'VALIDATION' });
  assert.equal(getDb().txLog.length, 0);
});

test('el precio cotizado debe coincidir antes de cobrar', async () => {
  reset();
  await assert.rejects(() => createReservation(driver(), body('quote-changed', { expectedAmount: 1 })), { code: 'PRICE_CHANGED' });
  assert.equal(getDb().txLog.length, 0);
});

test('una reserva de pago pendiente sigue accesible después de abandonar su detalle', () => {
  const reservations = [{ id: 'r-paid-old', status: 'completed' }, { id: 'r-checkout', status: 'awaiting_payment' }];
  const current = reservations.filter(r => reservationTab(r.status) === 'current');
  const history = reservations.filter(r => reservationTab(r.status) === 'history');
  assert.deepEqual(current.map(r => r.id), ['r-checkout']);
  assert.deepEqual(history.map(r => r.id), ['r-paid-old']);
  assert.equal(openReservation(reservations).id, 'r-checkout');
});

test('cada estado de recuperación conserva una ruta a su reserva y un texto visible', () => {
  for (const status of ['pending', 'awaiting_payment', 'compensating', 'cancelling', 'checking_out', 'confirmed', 'active']) {
    const booking = { id: 'r-' + status, status };
    assert.equal(reservationTab(status), 'current', status);
    assert.equal(openReservation([booking]), booking, status);
    assert.equal(typeof reservationStatus(status).label, 'string', status);
    assert.ok(reservationStatus(status).label.length > 0, status);
  }
});

test('rechazos aparecen en el historial y estados desconocidos no rompen el badge ni desaparecen', () => {
  for (const status of ['failed', 'completed', 'cancelled']) {
    assert.equal(reservationTab(status), 'history', status);
    assert.equal(openReservation([{ id: 'r-terminal', status }]), undefined, status);
    assert.ok(reservationStatus(status).label, status);
  }
  for (const status of ['future_backend_status', null, undefined, 'toString', '__proto__']) {
    const meta = reservationStatus(status);
    assert.equal(meta.label, 'Estado por actualizar');
    assert.equal(meta.tone, 'neutral');
    assert.equal(reservationTab(status), 'current');
  }
});

test('el alta móvil envía estado y coordenadas completas para el contrato HTTP', () => {
  const form = toForm(null);
  form.name = 'Garaje de prueba'; form.address = 'Calle 100 # 10-20';
  form.capacity.car = '1'; form.rates.car.price = '5000';
  form.latitude = '4,656'; form.longitude = '-74.060';
  form.identityConsent = true;
  const payload = toPayload(form, 'create');
  assert.equal(payload.status, 'published');
  assert.deepEqual(payload.location, {lat: 4.656, lon: -74.06});
  assert.equal(payload.identityConsent, true);
  assert.equal(payload.rates.car.price, 5000);
  assert.ok(payload.destinationId);
});

test('el formulario conserva coordenadas al editar y rechaza ubicaciones incompletas o fuera de rango', () => {
  const form = toForm({location: {lat: -23.55, lon: -46.63}, status: 'paused'});
  assert.deepEqual(toPayload(form, 'host-edit').location, {lat: -23.55, lon: -46.63});
  assert.equal(toPayload(form, 'host-edit').status, 'paused');
  for (const location of [{latitude:'',longitude:''},{latitude:'NaN',longitude:'0'},{latitude:'91',longitude:'0'},{latitude:'0',longitude:'181'},{latitude:'0',longitude:''}]) {
    assert.throws(() => toPayload({...form,...location}, 'create'), error => error.code === 'VALIDATION' && Object.keys(error.details.fields).length > 0);
  }
});
