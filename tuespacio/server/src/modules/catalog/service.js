// Servicio: catálogo, búsqueda por destino y disponibilidad consultable por franja.
import { hourlyEquivalent, estimateCost } from '../../../../app/src/domain/rules.js';
import { addDays, localDate, openWindow, startOptions } from '../../../../app/src/domain/schedule.js';
import { timeline } from '../../../../app/src/domain/availability.js';
import { AppError, notFound, validationError } from '../../http/errors.js';
import { validateBookingWindow } from '../../../../app/src/domain/validation.js';
import { loadAllocations, loadSpace, loadSpaces, slotFrom, spaceDTO } from './repository.js';

export const normalizeSearch = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const destinationDTO = (d) => ({ id: d.id, name: d.name, hint: d.hint, city: d.city, location: { lat: d.lat, lng: d.lng }, timezone: d.timezone });

export function createCatalogService({ db, config }) {
  const limits = {
    ...config.booking,
    startToleranceMin: 5,
    minDurationMin: 30,
    maxDurationMin: 24 * 60,
  };
  const dtoOpts = { walkInHorizonMin: config.booking.walkInHorizonMin };

  function checkSlot(query) {
    if (!query.startAt && !query.durationMin) return slotFrom({});
    const fields = validateBookingWindow({ startAt: query.startAt || new Date().toISOString(), durationMin: query.durationMin ?? 60 }, Date.now(), limits);
    if (Object.keys(fields).length) throw validationError(fields);
    return slotFrom(query);
  }

  async function withAvailability(client, spaces, slot, viewer) {
    const allocations = await loadAllocations(client, spaces.map((s) => s.id), new Date(slot.start).toISOString(), new Date(slot.end).toISOString());
    return spaces.map((s) => spaceDTO(s, { allocations, slot, viewer, ...dtoOpts }));
  }

  return {
    withAvailability,
    checkSlot,

    async searchDestinations({ q = '' }) {
      const term = normalizeSearch(q).replace(/[%_\\]/g, '');
      const rows = (
        await db.query(`SELECT * FROM destinations WHERE active AND ($1 = '' OR search LIKE '%' || $1 || '%') ORDER BY name LIMIT 20`, [term])
      ).rows;
      return rows.map(destinationDTO);
    },

    async getDestination(id) {
      const d = await db.one('SELECT * FROM destinations WHERE id = $1 AND active', [id]);
      if (!d) throw notFound('DESTINATION_NOT_FOUND');
      return destinationDTO(d);
    },

    async listSpaces(query, viewer) {
      await this.getDestination(query.destinationId);
      const vehicle = query.vehicle || 'car';
      const slot = checkSlot(query);
      const params = [query.destinationId, vehicle];
      let where = `s.destination_id = $1 AND s.status = 'published'
        AND EXISTS (SELECT 1 FROM space_inventory i WHERE i.space_id = s.id AND i.vehicle_type = $2 AND i.capacity > 0)
        AND EXISTS (SELECT 1 FROM space_rates r WHERE r.space_id = s.id AND r.vehicle_type = $2 AND r.effective_to IS NULL)`;
      if (query.covered) where += ' AND s.covered';
      if (query.noKeys) where += ' AND NOT s.keys_required';
      if (query.kind) {
        params.push(query.kind);
        where += ` AND s.kind = $${params.length}`;
      }
      const spaces = await loadSpaces(db, where, params);
      let list = await withAvailability(db, spaces, slot, viewer);
      if (query.availableOnly) list = list.filter((s) => s.availability[vehicle].free > 0);
      if (query.sort === 'price') list.sort((a, b) => hourlyEquivalent(a.rates[vehicle]) - hourlyEquivalent(b.rates[vehicle]) || a.distanceM - b.distanceM);
      else list.sort((a, b) => a.distanceM - b.distanceM);
      return list;
    },

    async getSpace(id, query, viewer) {
      const s = await loadSpace(db, id);
      if (!s) throw notFound('SPACE_NOT_FOUND');
      if (s.status === 'suspended' && viewer?.id !== s.manager_id) throw notFound('SPACE_NOT_FOUND');
      // Métrica "cuántos conductores lo encontraron": solo cuenta visitas de conductores u anónimos.
      if (query.track && viewer?.id !== s.manager_id && (!viewer || viewer.role === 'driver')) {
        await db.query(
          `INSERT INTO space_metrics_daily (space_id, day, views) VALUES ($1, (now() AT TIME ZONE $2)::date, 1)
           ON CONFLICT (space_id, day) DO UPDATE SET views = space_metrics_daily.views + 1`,
          [s.id, s.timezone]
        );
      }
      const [dto] = await withAvailability(db, [s], checkSlot(query), viewer);
      return dto;
    },

    // Disponibilidad de un día local por bloques, y horas de llegada válidas para la duración.
    async dayAvailability(id, { date, vehicle = 'car', durationMin = 60, stepMin = 60 }, viewer) {
      const s = await loadSpace(db, id);
      if (!s || (s.status === 'suspended' && viewer?.id !== s.manager_id)) throw notFound('SPACE_NOT_FOUND');
      const today = localDate(new Date(), s.timezone);
      const day = date || today;
      if (day < today || day > addDays(today, config.booking.bookingHorizonDays)) throw validationError({ date: 'START_INVALID' });
      const w = openWindow(s.weekly, s.timezone, day);
      if (!w) return { date: day, timezone: s.timezone, vehicle, open: null, close: null, blocks: [], startOptions: [] };
      const allocations = await loadAllocations(db, [s.id], w.open.toISOString(), new Date(w.close.getTime() + 24 * 3600000).toISOString());
      const allocs = allocations.get(`${s.id}:${vehicle}`) || [];
      const blocks = timeline({ capacity: s.capacity[vehicle], walkIns: s.walkIns[vehicle], allocations: allocs, from: w.open, to: w.close, stepMin, walkInHorizonMin: config.booking.walkInHorizonMin });
      const starts = startOptions({ weekly: s.weekly, tz: s.timezone, dateStr: day, durationMin, stepMin: 15 }).map((startAt) => {
        const [dto] = [spaceDTO(s, { allocations, slot: slotFrom({ startAt, durationMin }), ...dtoOpts })];
        return { startAt, free: dto.availability[vehicle].free };
      });
      return { date: day, timezone: s.timezone, vehicle, open: w.open.toISOString(), close: w.close.toISOString(), blocks, startOptions: starts };
    },

    async quote(id, query, viewer) {
      const space = await this.getSpace(id, { startAt: query.startAt, durationMin: query.durationMin }, viewer);
      const rate = space.rates[query.vehicle];
      if (!rate) throw new AppError('VEHICLE_NOT_ACCEPTED', 422);
      return {
        spaceId: id,
        vehicle: query.vehicle,
        startAt: space.slot.startAt,
        endAt: space.slot.endAt,
        amount: estimateCost(rate, query.durationMin),
        rate,
        availability: space.availability[query.vehicle],
        fitsSchedule: space.slot.fitsSchedule,
      };
    },
  };
}
