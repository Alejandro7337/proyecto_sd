// Servicio: panel del parqueadero (dueño) y del anfitrión.
import { VEHICLE_TYPES, canHostPublish, estimateCost } from '../../../../app/src/domain/rules.js';
import { addDays, fitsSchedule, localDate, normalizeWeekly } from '../../../../app/src/domain/schedule.js';
import { validateSpaceInput } from '../../../../app/src/domain/validation.js';
import { newId } from '../../lib/ids.js';
import { AppError, forbidden, notFound, validationError } from '../../http/errors.js';
import { audit, diff, recordChange } from '../audit/service.js';
import { loadSpace, loadSpaces } from '../catalog/repository.js';

const MAX_RANGE_DAYS = 92;

function editableSnapshot(s) {
  return {
    name: s.name,
    address: s.address,
    capacity: s.capacity,
    rates: s.rates,
    schedule: s.schedule.map((d) => `${d.weekday}:${d.open}-${d.close}`),
    conditions: { covered: s.covered, keys: s.keys_required, maxHeight: s.max_height_m },
    status: s.status,
  };
}

// Ubicación sin geocodificador (proveedor por definir): cerca del centro de la zona elegida. La pública
// se difumina ~150 m para no revelar la vivienda del anfitrión antes de una reserva.
function placeNear(dest) {
  const angle = Math.random() * Math.PI * 2;
  const meters = 200 + Math.random() * 450;
  const dLat = (Math.sin(angle) * meters) / 110540;
  const dLng = (Math.cos(angle) * meters) / (111320 * Math.cos((dest.lat * Math.PI) / 180));
  const fuzz = () => (Math.random() - 0.5) * (300 / 110540);
  const lat = dest.lat + dLat;
  const lng = dest.lng + dLng;
  return { lat, lng, publicLat: lat + fuzz(), publicLng: lng + fuzz() };
}

export function createPanelService({ db, config, catalog, reservations }) {
  const nowSlot = () => ({ start: Date.now(), end: Date.now() + 60000, durationMin: 1 });
  const actor = (req) => ({ id: req.user.id, role: req.user.role, requestId: req.id });

  async function managedSpace(req, id, client = db) {
    const s = await loadSpace(client, id);
    if (!s) throw notFound('SPACE_NOT_FOUND');
    if (s.manager_id !== req.user.id) throw forbidden();
    return s;
  }

  async function dto(s, req) {
    return (await catalog.withAvailability(db, [s], nowSlot(), req.user))[0];
  }

  async function writeSpaceDetails(client, spaceId, value, current) {
    if (value.capacity) {
      for (const v of VEHICLE_TYPES) {
        const cap = value.capacity[v];
        if (current && cap < current.capacity[v]) {
          const committed = (await client.query(`SELECT max_concurrent($1, $2, tstzrange(now(), now() + interval '400 days'), NULL) AS n`, [spaceId, v])).rows[0].n;
          const walk = current.walkIns[v];
          if (cap < committed || cap < walk) throw new AppError('VALIDATION', 422, { fields: { ['capacity.' + v]: 'CAPACITY_BELOW_USE' } }, { fields: { ['capacity.' + v]: { n: Math.max(committed, walk) } } });
        }
        await client.query(
          `INSERT INTO space_inventory (space_id, vehicle_type, capacity) VALUES ($1, $2, $3)
           ON CONFLICT (space_id, vehicle_type) DO UPDATE SET capacity = EXCLUDED.capacity`,
          [spaceId, v, cap]
        );
      }
    }
    if (value.rates) {
      for (const v of VEHICLE_TYPES) {
        const next = value.rates[v];
        const prev = current?.rates?.[v] || null;
        if (JSON.stringify(next) === JSON.stringify(prev)) continue;
        await client.query('UPDATE space_rates SET effective_to = now() WHERE space_id = $1 AND vehicle_type = $2 AND effective_to IS NULL', [spaceId, v]);
        if (next) await client.query('INSERT INTO space_rates (space_id, vehicle_type, unit, price_cop) VALUES ($1, $2, $3, $4)', [spaceId, v, next.unit, next.price]);
      }
    }
    if (value.weekly) {
      await client.query('DELETE FROM space_schedules WHERE space_id = $1', [spaceId]);
      for (const d of value.weekly) {
        await client.query('INSERT INTO space_schedules (space_id, weekday, open_time, close_time) VALUES ($1, $2, $3, $4)', [spaceId, d.weekday, d.open, d.close]);
      }
    }
  }

  return {
    async ownerSpace(req) {
      const [s] = await loadSpaces(db, `s.manager_id = $1 AND s.kind = 'formal' ORDER BY s.created_at LIMIT 1`, [req.user.id]);
      if (!s) throw notFound('SPACE_NOT_FOUND');
      const m = await this.metrics(req, { spaceId: s.id });
      return {
        space: await dto(s, req),
        plan: req.user.plan,
        metrics: { views: m.days.map((d) => d.views), reservations: m.days.map((d) => d.reservations), days: m.days.map((d) => d.date), conversion: m.totals.conversion },
      };
    },

    // Métricas por día local: visitas, reservas, conversión e ingresos. Rango máximo 92 días.
    async metrics(req, { spaceId, from, to }) {
      const spaces = spaceId
        ? [await managedSpace(req, spaceId)]
        : await loadSpaces(db, 's.manager_id = $1', [req.user.id]);
      if (!spaces.length) throw notFound('SPACE_NOT_FOUND');
      const tz = spaces[0].timezone;
      const today = localDate(new Date(), tz);
      const end = to || today;
      const start = from || addDays(end, -6);
      if (start > end || addDays(start, MAX_RANGE_DAYS) < end) throw validationError({ from: 'START_INVALID' });
      const ids = spaces.map((s) => s.id);
      const views = (await db.query('SELECT day::text AS day, sum(views)::int AS views FROM space_metrics_daily WHERE space_id = ANY($1) AND day BETWEEN $2 AND $3 GROUP BY day', [ids, start, end])).rows;
      const res = (
        await db.query(
          `SELECT (created_at AT TIME ZONE $4)::date::text AS day, count(*)::int AS n, COALESCE(sum(amount_cop), 0)::int AS revenue
             FROM reservations WHERE space_id = ANY($1) AND status IN ('confirmed', 'active', 'completed', 'expired')
              AND (created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 GROUP BY 1`,
          [ids, start, end, tz]
        )
      ).rows;
      const days = [];
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const v = views.find((x) => x.day === d)?.views || 0;
        const r = res.find((x) => x.day === d);
        days.push({ date: d, views: v, reservations: r?.n || 0, revenue: r?.revenue || 0, conversion: v ? Math.round(((r?.n || 0) / v) * 1000) / 1000 : null });
      }
      const totalViews = days.reduce((a, d) => a + d.views, 0);
      const totalRes = days.reduce((a, d) => a + d.reservations, 0);
      return {
        from: start,
        to: end,
        timezone: tz,
        days,
        totals: { views: totalViews, reservations: totalRes, revenue: days.reduce((a, d) => a + d.revenue, 0), conversion: totalViews ? Math.round((totalRes / totalViews) * 1000) / 1000 : null },
      };
    },

    async updateSpace(req, id, input) {
      const s0 = await managedSpace(req, id);
      if (input.version !== undefined && Number(input.version) !== s0.version) throw new AppError('VERSION_CONFLICT', 409, { version: s0.version });
      const { version, ...rest } = input;
      void version;
      const { fields, value } = validateSpaceInput(rest, { mode: 'update', current: s0 });
      if (Object.keys(fields).length) throw validationError(fields);
      if (value.status === 'published' && s0.kind === 'particular' && !canHostPublish(req.user.identity_status)) throw new AppError('IDENTITY_REQUIRED', 403);

      await db.tx(async (client) => {
        await client.query('SELECT 1 FROM spaces WHERE id = $1 FOR UPDATE', [id]);
        const current = await loadSpace(client, id);
        if (value.weekly) {
          const weekly = normalizeWeekly(value.weekly);
          const future = (
            await client.query(`SELECT code, lower(period) AS s, upper(period) AS e FROM reservations WHERE space_id = $1 AND status IN ('confirmed', 'active') AND upper(period) > now()`, [id])
          ).rows.filter((r) => !fitsSchedule(weekly, current.timezone, Math.max(new Date(r.s).getTime(), Date.now()), r.e));
          if (future.length) throw new AppError('SCHEDULE_CONFLICT', 409, { reservations: future.map((r) => r.code) }, { n: future.length });
        }
        try {
          await client.query('SAVEPOINT details');
          await writeSpaceDetails(client, id, value, current);
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT details');
          if (err.code === 'TE002' || err.code === '23514') throw new AppError('VALIDATION', 422, { fields: { capacity: 'CAPACITY_BELOW_USE' } });
          throw err;
        }
        const sets = [];
        const params = [id];
        const add = (col, v) => {
          params.push(v);
          sets.push(`${col} = $${params.length}`);
        };
        if (value.name !== undefined) add('name', value.name);
        if (value.address !== undefined) add('address', value.address);
        if (value.conditions) {
          add('covered', value.conditions.covered);
          add('keys_required', value.conditions.keys);
          add('max_height_m', value.conditions.maxHeight);
        }
        if (value.status) add('status', value.status);
        await client.query(`UPDATE spaces SET ${[...sets, 'version = version + 1', 'updated_at = now()'].join(', ')} WHERE id = $1`, params);
        const after = await loadSpace(client, id);
        await audit(client, actor(req), 'space.updated', 'space', id, { changes: diff(editableSnapshot(current), editableSnapshot(after)) });
        await recordChange(client, 'space', id);
      });
      return dto(await loadSpace(db, id), req);
    },

    // Entradas/salidas de vehículos sin reserva. El trigger impide ocupar cupos comprometidos.
    async adjustOccupancy(req, id, { vehicle, delta }) {
      const s = await managedSpace(req, id);
      if (!s.capacity[vehicle]) throw new AppError('VEHICLE_NOT_ACCEPTED', 422);
      await db.tx(async (client) => {
        if (delta < 0) {
          const r = await client.query('UPDATE space_inventory SET walk_in_occupied = walk_in_occupied - 1 WHERE space_id = $1 AND vehicle_type = $2 AND walk_in_occupied > 0', [id, vehicle]);
          if (!r.rowCount) throw new AppError('NOTHING_TO_RELEASE', 409);
        } else {
          try {
            await client.query('SAVEPOINT walkin');
            await client.query('UPDATE space_inventory SET walk_in_occupied = walk_in_occupied + 1 WHERE space_id = $1 AND vehicle_type = $2', [id, vehicle]);
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT walkin');
            if (err.code === 'TE002' || err.code === '23514') throw new AppError('NO_FREE_SPOTS', 409);
            throw err;
          }
        }
        await audit(client, actor(req), delta > 0 ? 'inventory.walk_in' : 'inventory.walk_out', 'space', id, { vehicle });
        await recordChange(client, 'space', id);
      });
      return dto(await loadSpace(db, id), req);
    },

    async spaceReservations(req, id, query) {
      await managedSpace(req, id);
      return reservations.listForSpaces(req.user, [id], query);
    },

    async validateCode(req, id, { code }) {
      await managedSpace(req, id);
      const [r] = await reservations.listForSpaces(req.user, [id], { code });
      if (!r) throw notFound('CODE_NOT_FOUND');
      return r;
    },

    // Historial de cambios y de disponibilidad (auditoría del espacio).
    async history(req, id, { limit = 100 } = {}) {
      await managedSpace(req, id);
      const rows = (
        await db.query(
          `SELECT a.at, a.action, a.actor_role, a.data, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.entity_type = 'space' AND a.entity_id = $1 ORDER BY a.at DESC LIMIT $2`,
          [id, Math.min(Number(limit) || 100, 500)]
        )
      ).rows;
      return rows.map((r) => ({ at: r.at, action: r.action, actorRole: r.actor_role, actorName: r.actor_name ? r.actor_name.split(' ')[0] : null, data: r.data }));
    },

    async hostSpaces(req) {
      const spaces = await loadSpaces(db, `s.manager_id = $1 ORDER BY s.created_at`, [req.user.id]);
      return catalog.withAvailability(db, spaces, nowSlot(), req.user);
    },

    async createHostSpace(req, input) {
      const { fields, value } = validateSpaceInput(input, { mode: 'create' });
      const dest = value.destinationId ? await db.one('SELECT * FROM destinations WHERE id = $1 AND active', [value.destinationId]) : null;
      if (!dest && !fields.destinationId) fields.destinationId = 'DESTINATION_REQUIRED';
      if (Object.keys(fields).length) throw validationError(fields);
      const id = newId('spc');
      await db.tx(async (client) => {
        const user = (await client.query('SELECT identity_status FROM users WHERE id = $1 FOR UPDATE', [req.user.id])).rows[0];
        let identity = user.identity_status;
        if (identity === 'pending' || identity === 'rejected') {
          identity = 'in_review';
          await client.query(`UPDATE users SET identity_status = 'in_review', identity_requested_at = now(), updated_at = now() WHERE id = $1`, [req.user.id]);
          await audit(client, actor(req), 'identity.requested', 'user', req.user.id, {});
        }
        const loc = placeNear(dest);
        await client.query(
          `INSERT INTO spaces (id, kind, manager_id, destination_id, name, address, host_type, lat, lng, public_lat, public_lng, timezone, status, covered, keys_required, max_height_m)
           VALUES ($1, 'particular', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [id, req.user.id, dest.id, value.name, value.address, value.hostType, loc.lat, loc.lng, loc.publicLat, loc.publicLng, dest.timezone, canHostPublish(identity) ? 'published' : 'paused', value.conditions.covered, value.conditions.keys, value.conditions.maxHeight]
        );
        await writeSpaceDetails(client, id, value, null);
        await audit(client, actor(req), 'space.created', 'space', id, { hostType: value.hostType });
        await recordChange(client, 'space', id);
      });
      return dto(await loadSpace(db, id), req);
    },

    async hostReservations(req, query = {}) {
      const ids = (await db.query('SELECT id FROM spaces WHERE manager_id = $1', [req.user.id])).rows.map((r) => r.id);
      return ids.length ? reservations.listForSpaces(req.user, ids, query) : [];
    },

    async requestIdentity(req) {
      await db.tx(async (client) => {
        const u = (await client.query('SELECT identity_status FROM users WHERE id = $1 FOR UPDATE', [req.user.id])).rows[0];
        if (u.identity_status === 'verified' || u.identity_status === 'in_review') return;
        await client.query(`UPDATE users SET identity_status = 'in_review', identity_requested_at = now(), updated_at = now() WHERE id = $1`, [req.user.id]);
        await audit(client, actor(req), 'identity.requested', 'user', req.user.id, {});
      });
      const u = await db.one('SELECT identity_status, identity_requested_at FROM users WHERE id = $1', [req.user.id]);
      return { identity: u.identity_status, requestedAt: u.identity_requested_at };
    },

    // Ingresos del anfitrión a partir del libro de transacciones.
    async hostEarnings(req) {
      const items = await this.hostReservations(req, { status: 'confirmed,active,completed,expired,cancelled' });
      const ids = items.map((r) => r.id);
      const ledger = ids.length
        ? (await db.query(`SELECT reservation_id, entry_type, account, sum(amount_cop)::int AS amount FROM ledger_entries WHERE reservation_id = ANY($1) GROUP BY 1, 2, 3`, [ids])).rows
        : [];
      const managerNet = (rid) => ledger.filter((l) => l.reservation_id === rid && l.account === 'manager').reduce((a, l) => a + l.amount, 0);
      const commissionOf = (rid) => -ledger.filter((l) => l.reservation_id === rid && l.account === 'manager' && l.entry_type === 'commission').reduce((a, l) => a + l.amount, 0);
      const settled = items.filter((r) => r.status === 'completed' || r.status === 'expired');
      const gross = settled.reduce((a, r) => a + r.amount - (r.refund || 0), 0);
      const commission = settled.reduce((a, r) => a + commissionOf(r.id), 0);
      const pending = items.filter((r) => r.status === 'confirmed' || r.status === 'active').reduce((a, r) => a + r.amount, 0);
      const rate = config.booking.commissionRate ?? (await db.one(`SELECT rate FROM commission_rules WHERE space_kind = 'particular' ORDER BY effective_from DESC LIMIT 1`))?.rate ?? null;
      return {
        gross,
        pending,
        commission,
        commissionRate: rate,
        net: rate === null ? null : gross - commission,
        settlement: { criteria: 'Por definir en Fase 0: periodicidad, medio de giro y retenciones.', pendingDecision: true },
        items: items
          .filter((r) => r.status !== 'cancelled' || (r.refund || 0) < r.amount)
          .map((r) => ({ ...r, net: managerNet(r.id), commission: commissionOf(r.id) })),
      };
    },

    estimate: estimateCost,
  };
}
