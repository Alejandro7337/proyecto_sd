import { VEHICLES } from './rules';
import { ApiError } from '../api/errors';

export const toForm = (s) => ({
  name: s?.name || '',
  address: s?.address || '',
  destinationId: s?.destinationId || null,
  hostType: s?.hostType || null,
  capacity: { car: String(s?.capacity?.car ?? 0), moto: String(s?.capacity?.moto ?? 0) },
  rates: {
    car: { unit: s?.rates?.car?.unit || 'hour', price: s?.rates?.car ? String(s.rates.car.price) : '' },
    moto: { unit: s?.rates?.moto?.unit || 'hour', price: s?.rates?.moto ? String(s.rates.moto.price) : '' },
  },
  schedule: { open: s?.schedule?.open || '07:00', close: s?.schedule?.close || '19:00', days: s?.schedule?.days || 'Lun – Vie' },
  conditions: {
    covered: !!s?.conditions?.covered,
    keys: !!s?.conditions?.keys,
    maxHeight: s?.conditions?.maxHeight ? String(s.conditions.maxHeight).replace('.', ',') : '',
  },
  published: s ? s.status === 'published' : true,
  identityConsent: false,
  latitude: s?.location ? String(s.location.lat) : '',
  longitude: s?.location ? String(s.location.lon) : '',
});

export const digits = (v) => v.replace(/[^\d]/g, '');

export function toPayload(f, mode) {
  const capacity = { car: Number(digits(f.capacity.car) || 0), moto: Number(digits(f.capacity.moto) || 0) };
  const rates = {};
  Object.keys(VEHICLES).forEach((v) => {
    rates[v] = capacity[v] > 0 ? { unit: f.rates[v].unit, price: Number(digits(f.rates[v].price) || 0) } : null;
  });
  const h = f.conditions.maxHeight.trim().replace(',', '.');
  const latitude = f.latitude.trim().replace(',', '.');
  const longitude = f.longitude.trim().replace(',', '.');
  const hasLocation = latitude !== '' || longitude !== '';
  if (mode === 'create' || hasLocation) {
    const fields = {};
    if (!latitude || !Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90) fields.latitude = 'Escribe una latitud entre -90 y 90.';
    if (!longitude || !Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180) fields.longitude = 'Escribe una longitud entre -180 y 180.';
    if (Object.keys(fields).length) throw new ApiError('VALIDATION', 'Revisa las coordenadas del espacio.', 422, { fields });
  }
  const payload = {
    ...(hasLocation ? { location: {lat: Number(latitude), lon: Number(longitude)} } : {}),
    status: f.published ? 'published' : 'paused',
    capacity,
    rates,
    schedule: { ...f.schedule, open: f.schedule.open.trim(), close: f.schedule.close.trim() },
    conditions: { covered: f.conditions.covered, keys: f.conditions.keys, maxHeight: h ? Number(h) : null },
  };
  if (mode === 'create' || mode === 'host-edit') {
    payload.name = f.name;
    payload.address = f.address;
  }
  if (mode === 'create') {
    payload.destinationId = f.destinationId || 'custom';
    payload.hostType = f.hostType;
    payload.identityConsent = f.identityConsent;
  }
  return payload;
}

