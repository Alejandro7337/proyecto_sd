// Escenarios de la presentación guiada: cada uno debe mostrar lo que promete y nunca cobrar.
import { call, freshDb } from './support/backend';
import { getDb } from '../src/api/mock/db';

beforeEach(() => freshDb());
const run = async (name) => (await call('POST', `/demo/scenarios/${name}`)).data;
const lastTx = () => getDb().txLog[0];
const stepIds = (tx) => tx.steps.map((s) => s.step);

test('reserva exitosa recorre T11 a T13 y queda confirmada', async () => {
  const data = await run('success');
  expect(data.results[0]).toMatchObject({ ok: true, code: expect.stringMatching(/^TE-/) });
  expect(stepIds(lastTx())).toEqual(expect.arrayContaining(['T11', 'T12', 'T21', 'T22', 'T23', 'T13']));
});

test.each([
  ['taken', 'SPACE_TAKEN', []],
  ['declined', 'PAYMENT_DECLINED', ['C12']],
  ['timeout', 'GATEWAY_TIMEOUT', ['C12']],
  ['expired', 'HOLD_EXPIRED', ['C22', 'C21', 'C12']],
])('%s → %s con compensaciones %j y sin reserva creada', async (name, code, comps) => {
  const reservationsBefore = getDb().reservations.length;
  const data = await run(name);
  expect(data.results[0]).toMatchObject({ ok: false, code });
  const tx = lastTx();
  expect(tx.outcome).toBe('aborted');
  comps.forEach((c) => expect(stepIds(tx)).toContain(c));
  expect(getDb().reservations.length).toBe(reservationsBefore);
  expect(getDb().holds).toHaveLength(0);
});

test('idempotencia: tres envíos con la misma llave → una reserva y un solo cobro', async () => {
  const data = await run('idempotency');
  expect(data.results.every((r) => r.ok)).toBe(true);
  expect(data.sameReservation).toBe(true);
  expect(data.transactionsCharged).toBe(1);
});

test('dos conductores por un cupo: uno confirma, el otro recibe SPACE_TAKEN, sin sobreventa', async () => {
  const data = await run('race');
  expect(data.freeAtStart).toBe(1);
  expect(data.results.map((r) => (r.ok ? 'ok' : r.code)).sort()).toEqual(['SPACE_TAKEN', 'ok']);
  expect(data.freeAtEnd).toBe(0);
});

test('escenario desconocido → 404', async () => {
  expect((await call('POST', '/demo/scenarios/nada')).error.status).toBe(404);
});

test('los escenarios funcionan a cualquier hora (espacio demo 24 h)', async () => {
  const { clock } = require('../src/api/mock/db');
  const t = new Date('2026-11-29T03:00:00-05:00').getTime();
  clock.now = () => t;
  expect((await run('success')).results[0].ok).toBe(true);
});
