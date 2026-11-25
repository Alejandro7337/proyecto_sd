import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatMoney, formatRegionalDate } from '../../web/format.js';
import { messages } from '../../web/i18n.js';
import { regionUrl } from '../../web/region-url.js';
import { safeStorage } from '../../web/storage.js';

const regions = JSON.parse(readFileSync(new URL('../regions.json', import.meta.url)));
const cases = {
  co: { utc:'2026-11-16T01:30:00Z', total:'$\u00a016.560', digits:0 },
  br: { utc:'2026-11-15T23:30:00Z', total:'R$\u00a024,00', digits:2 },
  us: { utc:'2026-11-16T01:30:00Z', total:'$36.00', digits:2 },
  fr: { utc:'2026-11-15T19:30:00Z', total:'26,40\u00a0€', digits:2 },
  jp: { utc:'2026-11-15T11:30:00Z', total:'￥1,800', digits:0 },
};

for (const region of regions) {
  test(`${region.id}: dos horas de estacionamiento en moneda local`, () => {
    assert.equal(formatMoney(region.minutePrice * 120, region), cases[region.id].total);
    assert.equal(region.digits, cases[region.id].digits);
  });
  test(`${region.id}: 15 de noviembre a las 20:30 en su zona`, () => {
    const parts = new Intl.DateTimeFormat(region.locale, {timeZone:region.timeZone, hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(cases[region.id].utc));
    const fields = Object.fromEntries(parts.map(p=>[p.type,p.value]));
    assert.equal(Number(fields.day),15);
    assert.equal(Number(fields.hour),20);
    assert.equal(Number(fields.minute),30);
    assert.ok(formatRegionalDate(cases[region.id].utc, region).length>5);
  });
  test(`${region.id}: catálogo del flujo de reserva`, () => {
    for (const key of ['arrival','duration','payment','summary','total','tax','subtotal','confirm','receipt','code','cancel','checkIn','checkOut']) {
      assert.ok(messages[region.language][key],key);
      if (region.language !== 'en') assert.notEqual(messages[region.language][key],key);
    }
  });
}
test('el formateador rechaza importes fraccionarios y no finitos', () => {
  for (const value of [NaN, Infinity, .1, '100', null]) assert.throws(()=>formatMoney(value, regions[0]), TypeError);
});
test('el cambio de región usa subdominios de puerto en Codespaces', () => {
  assert.equal(
    regionUrl('https://probable-pancake-8120.app.github.dev/#regions', 8090),
    'https://probable-pancake-8090.app.github.dev/'
  );
});
test('el cambio de región conserva el puerto local', () => {
  assert.equal(
    regionUrl('http://127.0.0.1:8080/#regions', 8090),
    'http://127.0.0.1:8090/'
  );
});
test('preferencias funcionan cuando el navegador bloquea almacenamiento', () => {
  const storage=safeStorage('__unavailable_test_storage');
  storage.setItem('theme','dark');
  assert.equal(storage.getItem('theme'),'dark');
  storage.removeItem('theme');
  assert.equal(storage.getItem('theme'),null);
  globalThis.__quota_test_storage={getItem:()=> 'old',setItem:()=>{throw new Error('quota')},removeItem:()=>{throw new Error('blocked')}};
  try {
    const quota=safeStorage('__quota_test_storage');
    assert.equal(quota.getItem('theme'),'old');
    quota.setItem('theme','new');
    assert.equal(quota.getItem('theme'),'new');
    quota.removeItem('theme');
    assert.equal(quota.getItem('theme'),null);
  } finally { delete globalThis.__quota_test_storage; }
});
test('todas las regiones tienen consentimiento y errores de reserva', () => {
  for (const profile of regions) {
    assert.ok(messages[profile.language].identityConsent);
    for (const code of ['PRICE_CHANGED','PAYMENT_DECLINED','RESERVATION_PENDING','UNAUTHORIZED']) assert.ok(messages[profile.language].errors[code]);
  }
});
