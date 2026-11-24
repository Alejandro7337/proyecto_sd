// Servicio de autenticación y usuarios.
import { ROLES, TEST_PAYMENT_METHODS, VEHICLES } from '../../../../app/src/domain/rules.js';
import { isStrongPassword, isValidEmail, normalizeEmail, normalizePlate, validateRegistration, validateVehicleInput } from '../../../../app/src/domain/validation.js';
import { burnPasswordCheck, hashPassword, randomCode, randomToken, sha256, safeEqualHex, verifyPassword } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { AppError, notFound, validationError } from '../../http/errors.js';
import { audit } from '../audit/service.js';

const MAX_RESET_ATTEMPTS = 5;

export function userDTO(u, defaultVehicle = null) {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    email: u.email,
    vehicle: u.role === 'driver' ? defaultVehicle?.type || 'car' : undefined,
    plan: u.plan || undefined,
    identity: u.identity_status || undefined,
    mustChangePassword: !!u.must_change_password,
    preferences: u.preferences || {},
    createdAt: u.created_at,
  };
}

export const vehicleDTO = (v) => ({
  id: v.id,
  type: v.type,
  label: v.label,
  plate: v.plate,
  heightM: v.height_m,
  isDefault: v.is_default,
});

export const paymentMethodDTO = (m) => ({
  id: m.id,
  brand: m.brand,
  last4: m.last4,
  label: m.label,
  behavior: m.test_behavior,
  isDefault: m.is_default,
  simulated: true,
});

export function createAuthService({ db, config }) {
  const ttl = config.auth;

  async function defaultVehicle(client, userId) {
    return (await client.query('SELECT * FROM vehicles WHERE user_id = $1 AND is_default AND archived_at IS NULL', [userId])).rows[0] || null;
  }

  async function issueSession(client, userId, userAgent) {
    const access = randomToken('te_at');
    const refresh = randomToken('te_rt');
    const row = (
      await client.query(
        `INSERT INTO sessions (id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, user_agent)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5, now() + make_interval(days => $6), $7)
         RETURNING access_expires_at, refresh_expires_at`,
        [newId('ses'), userId, sha256(access), ttl.accessTtlMin, sha256(refresh), ttl.refreshTtlDays, String(userAgent || '').slice(0, 200) || null]
      )
    ).rows[0];
    return { token: access, refreshToken: refresh, accessExpiresAt: row.access_expires_at, refreshExpiresAt: row.refresh_expires_at };
  }

  async function seedDriverDefaults(client, userId, vehicleType) {
    await client.query(`INSERT INTO vehicles (id, user_id, type, label, is_default) VALUES ($1, $2, $3, $4, true)`, [
      newId('veh'),
      userId,
      vehicleType,
      vehicleType === 'moto' ? 'Mi moto' : 'Mi carro',
    ]);
    for (const [i, m] of TEST_PAYMENT_METHODS.entries()) {
      await client.query(
        `INSERT INTO payment_methods (id, user_id, brand, last4, label, test_behavior, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId('pm'), userId, m.brand, m.last4, m.label, m.behavior, i === 0]
      );
    }
  }

  return {
    issueSession,
    seedDriverDefaults,

    async register(input, ctx) {
      if (input.role === 'owner') throw new AppError('ROLE_NOT_ALLOWED', 403);
      const fields = validateRegistration(input);
      if (Object.keys(fields).length) throw validationError(fields);
      const email = normalizeEmail(input.email);
      const passwordHash = await hashPassword(input.password);
      return db.tx(async (client) => {
        const exists = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (exists.rowCount) throw new AppError('EMAIL_IN_USE', 409, { fields: { email: 'EMAIL_IN_USE' } });
        const id = newId('usr');
        const user = (
          await client.query(
            `INSERT INTO users (id, role, name, email, password_hash, identity_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [id, input.role, input.name.trim(), email, passwordHash, input.role === 'host' ? 'pending' : null]
          )
        ).rows[0];
        if (input.role === 'driver') await seedDriverDefaults(client, id, input.vehicle);
        const session = await issueSession(client, id, ctx.userAgent);
        await audit(client, { id, role: input.role, requestId: ctx.requestId }, 'auth.register', 'user', id, { role: input.role });
        return { ...session, user: userDTO(user, await defaultVehicle(client, id)) };
      });
    },

    async login({ email, password, role }, ctx) {
      const normalized = normalizeEmail(email);
      const user = isValidEmail(normalized) ? await db.one('SELECT * FROM users WHERE email = $1', [normalized]) : null;
      const valid = user ? await verifyPassword(password, user.password_hash) : await burnPasswordCheck(password);
      if (!user || !valid) {
        await audit(db, { requestId: ctx.requestId }, 'auth.login_failed', 'user', user?.id || null, {});
        throw new AppError('INVALID_CREDENTIALS', 401);
      }
      if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 403);
      if (role && role !== user.role) throw new AppError('ROLE_MISMATCH', 403, { role: user.role }, { role: ROLES[user.role].label });
      return db.tx(async (client) => {
        const session = await issueSession(client, user.id, ctx.userAgent);
        await audit(client, { id: user.id, role: user.role, requestId: ctx.requestId }, 'auth.login', 'user', user.id, {});
        return { ...session, user: userDTO(user, await defaultVehicle(client, user.id)) };
      });
    },

    // Rotación: cada refresh entrega un par nuevo. Reutilizar un refresh ya rotado revoca la sesión
    // (señal de robo de token). El cliente debe serializar sus llamadas a /auth/refresh.
    async refresh({ refreshToken }, ctx) {
      const hash = sha256(refreshToken || '');
      return db.tx(async (client) => {
        const s = (await client.query('SELECT * FROM sessions WHERE refresh_hash = $1 FOR UPDATE', [hash])).rows[0];
        if (!s) {
          const reused = (await client.query('SELECT * FROM sessions WHERE prev_refresh_hash = $1 FOR UPDATE', [hash])).rows[0];
          if (reused && !reused.revoked_at) {
            await client.query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'refresh_reuse' WHERE id = $1", [reused.id]);
            await audit(client, { id: reused.user_id, requestId: ctx.requestId }, 'auth.refresh_reuse', 'session', reused.id, {});
            return { revoked: true };
          }
          throw new AppError('UNAUTHORIZED', 401);
        }
        if (s.revoked_at) throw new AppError('SESSION_REVOKED', 401);
        if (new Date(s.refresh_expires_at).getTime() <= Date.now()) throw new AppError('TOKEN_EXPIRED', 401);
        const user = (await client.query('SELECT * FROM users WHERE id = $1', [s.user_id])).rows[0];
        if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 401);
        const access = randomToken('te_at');
        const refresh = randomToken('te_rt');
        const row = (
          await client.query(
            `UPDATE sessions SET access_hash = $2, access_expires_at = now() + make_interval(mins => $3),
                    prev_refresh_hash = refresh_hash, refresh_hash = $4, last_used_at = now()
              WHERE id = $1 RETURNING access_expires_at, refresh_expires_at`,
            [s.id, sha256(access), ttl.accessTtlMin, sha256(refresh)]
          )
        ).rows[0];
        return {
          token: access,
          refreshToken: refresh,
          accessExpiresAt: row.access_expires_at,
          refreshExpiresAt: row.refresh_expires_at,
          user: userDTO(user, await defaultVehicle(client, user.id)),
        };
      }).then((r) => {
        if (r.revoked) throw new AppError('SESSION_REVOKED', 401);
        return r;
      });
    },

    async logout(req, { all = false } = {}) {
      await db.tx(async (client) => {
        if (all) await client.query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout_all' WHERE user_id = $1 AND revoked_at IS NULL", [req.user.id]);
        else await client.query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE id = $1", [req.sessionId]);
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, all ? 'auth.logout_all' : 'auth.logout', 'session', req.sessionId, {});
      });
    },

    // Siempre responde igual (exista o no la cuenta) para no revelar correos registrados.
    async forgotPassword({ email }, ctx) {
      const normalized = normalizeEmail(email);
      if (!isValidEmail(normalized)) throw validationError({ email: 'EMAIL_INVALID' });
      const user = await db.one("SELECT id, name, email FROM users WHERE email = $1 AND status = 'active'", [normalized]);
      if (!user) return;
      const code = randomCode(8);
      await db.tx(async (client) => {
        await client.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
        await client.query(
          `INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
          [newId('pwr'), user.id, sha256(`${user.id}:${code}`), ttl.resetTtlMin]
        );
        if (config.mail.provider === 'outbox') {
          await client.query(`INSERT INTO outbox_messages (user_id, template, payload) VALUES ($1, 'password_reset', $2)`, [
            user.id,
            { to: user.email, name: user.name, code, expiresInMin: ttl.resetTtlMin },
          ]);
        }
        await audit(client, { id: user.id, requestId: ctx.requestId }, 'auth.password_reset_requested', 'user', user.id, { delivery: config.mail.provider });
      });
    },

    async resetPassword({ email, code, password }, ctx) {
      if (!isStrongPassword(password)) throw validationError({ password: 'PASSWORD_WEAK' });
      const normalized = normalizeEmail(email);
      return db.tx(async (client) => {
        const user = (await client.query('SELECT id, role FROM users WHERE email = $1', [normalized])).rows[0];
        const reset = user
          ? (
              await client.query(
                `SELECT * FROM password_resets WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
                  ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
                [user.id]
              )
            ).rows[0]
          : null;
        if (!reset || reset.attempts >= MAX_RESET_ATTEMPTS) throw new AppError('RESET_CODE_INVALID', 400);
        const candidate = sha256(`${user.id}:${String(code || '').trim().toUpperCase()}`);
        if (!safeEqualHex(candidate, reset.code_hash)) {
          await client.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [reset.id]);
          return { invalid: true };
        }
        await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
        await client.query('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [user.id, await hashPassword(password)]);
        await client.query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
        await audit(client, { id: user.id, role: user.role, requestId: ctx.requestId }, 'auth.password_reset', 'user', user.id, {});
        return { ok: true };
      }).then((r) => {
        if (r.invalid) throw new AppError('RESET_CODE_INVALID', 400);
      });
    },

    async changePassword(req, { currentPassword, newPassword }) {
      const user = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (!(await verifyPassword(currentPassword, user.password_hash))) throw new AppError('PASSWORD_MISMATCH', 400, { fields: { currentPassword: 'PASSWORD_MISMATCH' } });
      if (!isStrongPassword(newPassword)) throw validationError({ newPassword: 'PASSWORD_WEAK' });
      await db.tx(async (client) => {
        await client.query('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [req.user.id, await hashPassword(newPassword)]);
        await client.query("UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_change' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [req.user.id, req.sessionId]);
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'auth.password_change', 'user', req.user.id, {});
      });
    },

    async me(req) {
      return userDTO(req.user, await defaultVehicle(db, req.user.id));
    },

    async updateMe(req, input) {
      return db.tx(async (client) => {
        const sets = [];
        const params = [req.user.id];
        if (input.name !== undefined) {
          if (input.name.trim().length < 3) throw validationError({ name: 'NAME_FULL' });
          params.push(input.name.trim());
          sets.push(`name = $${params.length}`);
        }
        if (input.preferences !== undefined) {
          params.push(input.preferences);
          sets.push(`preferences = $${params.length}`);
        }
        if (sets.length) await client.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
        // Compatibilidad: { vehicle: 'car' | 'moto' } cambia el vehículo principal.
        if (input.vehicle && req.user.role === 'driver' && VEHICLES[input.vehicle]) {
          const target = (await client.query('SELECT id FROM vehicles WHERE user_id = $1 AND type = $2 AND archived_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1', [req.user.id, input.vehicle])).rows[0];
          await client.query('UPDATE vehicles SET is_default = false WHERE user_id = $1 AND is_default', [req.user.id]);
          if (target) await client.query('UPDATE vehicles SET is_default = true WHERE id = $1', [target.id]);
          else {
            await client.query('INSERT INTO vehicles (id, user_id, type, label, is_default) VALUES ($1, $2, $3, $4, true)', [newId('veh'), req.user.id, input.vehicle, input.vehicle === 'moto' ? 'Mi moto' : 'Mi carro']);
          }
        }
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'user.update', 'user', req.user.id, { fields: Object.keys(input) });
        const user = (await client.query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
        return userDTO(user, await defaultVehicle(client, req.user.id));
      });
    },

    async listVehicles(req) {
      return (await db.query('SELECT * FROM vehicles WHERE user_id = $1 AND archived_at IS NULL ORDER BY is_default DESC, created_at', [req.user.id])).rows.map(vehicleDTO);
    },

    async saveVehicle(req, vehicleId, input) {
      const fields = validateVehicleInput(input, { partial: !!vehicleId });
      if (Object.keys(fields).length) throw validationError(fields);
      return db.tx(async (client) => {
        const count = (await client.query('SELECT count(*)::int AS n FROM vehicles WHERE user_id = $1 AND archived_at IS NULL', [req.user.id])).rows[0].n;
        let id = vehicleId;
        const plate = input.plate ? normalizePlate(input.plate) : input.plate === '' ? null : undefined;
        const height = input.heightM === '' || input.heightM === null ? null : input.heightM !== undefined ? Number(input.heightM) : undefined;
        if (!id) {
          if (count >= 5) throw validationError({ type: 'VEHICLE_REQUIRED' });
          id = newId('veh');
          await client.query('INSERT INTO vehicles (id, user_id, type, label, plate, height_m, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
            id,
            req.user.id,
            input.type,
            input.label.trim(),
            plate ?? null,
            height ?? null,
            count === 0,
          ]);
        } else {
          const own = (await client.query('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL', [id, req.user.id])).rows[0];
          if (!own) throw notFound();
          await client.query(
            `UPDATE vehicles SET type = COALESCE($3, type), label = COALESCE($4, label),
                    plate = CASE WHEN $5::boolean THEN $6 ELSE plate END, height_m = CASE WHEN $7::boolean THEN $8::numeric ELSE height_m END
              WHERE id = $1 AND user_id = $2`,
            [id, req.user.id, input.type ?? null, input.label?.trim() ?? null, plate !== undefined, plate ?? null, height !== undefined, height ?? null]
          );
        }
        if (input.isDefault === true) {
          await client.query('UPDATE vehicles SET is_default = false WHERE user_id = $1 AND is_default', [req.user.id]);
          await client.query('UPDATE vehicles SET is_default = true WHERE id = $1', [id]);
        }
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, vehicleId ? 'vehicle.update' : 'vehicle.create', 'vehicle', id, {});
        return vehicleDTO((await client.query('SELECT * FROM vehicles WHERE id = $1', [id])).rows[0]);
      });
    },

    async archiveVehicle(req, vehicleId) {
      await db.tx(async (client) => {
        const v = (await client.query('SELECT * FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE', [vehicleId, req.user.id])).rows[0];
        if (!v) throw notFound();
        const others = (await client.query('SELECT id FROM vehicles WHERE user_id = $1 AND id <> $2 AND archived_at IS NULL ORDER BY created_at', [req.user.id, vehicleId])).rows;
        if (!others.length) throw new AppError('LAST_VEHICLE', 409);
        await client.query('UPDATE vehicles SET archived_at = now(), is_default = false WHERE id = $1', [vehicleId]);
        if (v.is_default) await client.query('UPDATE vehicles SET is_default = true WHERE id = $1', [others[0].id]);
        await audit(client, { id: req.user.id, role: req.user.role, requestId: req.id }, 'vehicle.archive', 'vehicle', vehicleId, {});
      });
    },

    async listPaymentMethods(req) {
      return (await db.query('SELECT * FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at', [req.user.id])).rows.map(paymentMethodDTO);
    },

    async setDefaultPaymentMethod(req, id) {
      await db.tx(async (client) => {
        const m = (await client.query('SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2', [id, req.user.id])).rows[0];
        if (!m) throw notFound();
        await client.query('UPDATE payment_methods SET is_default = false WHERE user_id = $1 AND is_default', [req.user.id]);
        await client.query('UPDATE payment_methods SET is_default = true WHERE id = $1', [id]);
      });
      return this.listPaymentMethods(req);
    },
  };
}
