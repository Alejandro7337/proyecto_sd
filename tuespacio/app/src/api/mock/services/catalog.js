// Servicio: Catálogo y geolocalización (mapa por destino, condiciones, tarifas).
import { getDb, findSpace, toSpaceDTO } from '../db';
import { ApiError } from '../../errors';

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function searchDestinations({ q = '' }) {
  const term = normalize(q.trim());
  const list = getDb().destinations;
  if (!term) return list;
  return list.filter((d) => normalize(d.name + ' ' + d.hint).includes(term));
}

export function getDestination(id) {
  const d = getDb().destinations.find((x) => x.id === id);
  if (!d) throw new ApiError('DESTINATION_NOT_FOUND', 'Destino no encontrado.', 404);
  return d;
}

const hourlyEquivalent = (rate) => (rate.unit === 'minute' ? rate.price * 60 : rate.price);

export function listSpaces({ destinationId, vehicle = 'car', covered, noKeys, kind, sort = 'distance' }) {
  getDestination(destinationId);
  let list = getDb()
    .spaces.filter((s) => s.destinationId === destinationId && s.status === 'published')
    .filter((s) => s.capacity[vehicle] > 0 && s.rates[vehicle]);
  if (covered === 'true') list = list.filter((s) => s.conditions.covered);
  if (noKeys === 'true') list = list.filter((s) => !s.conditions.keys);
  if (kind) list = list.filter((s) => s.kind === kind);

  const dtos = list.map(toSpaceDTO);
  if (sort === 'price') {
    dtos.sort((a, b) => hourlyEquivalent(a.rates[vehicle]) - hourlyEquivalent(b.rates[vehicle]));
  } else {
    dtos.sort((a, b) => a.distanceM - b.distanceM);
  }
  return dtos;
}

export function getSpace(id, { track } = {}) {
  const space = findSpace(id);
  // Métrica para el panel del dueño: "cuántos conductores lo encontraron".
  if (track === 'true' && space.metrics) space.metrics.views[6] += 1;
  return toSpaceDTO(space);
}
