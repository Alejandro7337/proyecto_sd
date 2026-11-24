// Herramientas de demostración. Solo existen con DEMO_TOOLS=true (routes.js responde 404 si no).
// NUNCA activar en un ambiente con usuarios reales sin entender el riesgo: /demo/outbox expone los
// códigos de recuperación simulados. El reinicio de datos exige además DEMO_RESET_TOKEN.
import { timingSafeEqual } from 'node:crypto';
import { AppError, notFound } from '../../http/errors.js';
import { seedDemo } from '../../db/seed.js';
import { audit } from '../audit/service.js';

export function createDemoService({ db, config, sweeper }) {
  return {
    async transactions() {
      const sagas = (await db.query(`SELECT id, status, failed_step, error_code, meta, started_at, finished_at FROM sagas ORDER BY started_at DESC LIMIT 15`)).rows;
      const steps = sagas.length
        ? (await db.query(`SELECT saga_id, step, status, detail, at FROM saga_steps WHERE saga_id = ANY($1) ORDER BY id`, [sagas.map((s) => s.id)])).rows
        : [];
      const outcome = { committed: 'committed', aborted: 'aborted', running: 'running', compensation_failed: 'aborted' };
      return sagas.map((s) => ({
        id: s.id,
        startedAt: s.started_at,
        finishedAt: s.finished_at,
        outcome: outcome[s.status],
        status: s.status,
        failedStep: s.failed_step,
        errorCode: s.error_code,
        meta: { space: s.meta.space, vehicle: s.meta.vehicle, idempotencyKey: s.meta.idempotencyKey, scenario: s.meta.scenario },
        steps: steps.filter((x) => x.saga_id === s.id).map(({ step, status, detail, at }) => ({ step, status, detail, at })),
      }));
    },

    async outbox(email) {
      const rows = (
        await db.query(
          `SELECT o.id, o.template, o.payload, o.created_at FROM outbox_messages o JOIN users u ON u.id = o.user_id
            WHERE u.email = lower($1) ORDER BY o.created_at DESC LIMIT 5`,
          [email.trim()]
        )
      ).rows;
      return rows.map((r) => ({ id: r.id, template: r.template, createdAt: r.created_at, code: r.payload.code, expiresInMin: r.payload.expiresInMin }));
    },

    async decideIdentity(userId, decision) {
      if (!['approve', 'reject'].includes(decision)) throw notFound();
      const status = decision === 'approve' ? 'verified' : 'rejected';
      const r = await db.query(`UPDATE users SET identity_status = $2, updated_at = now() WHERE id = $1 AND role = 'host' RETURNING id`, [userId, status]);
      if (!r.rowCount) throw notFound();
      if (status === 'rejected') await db.query(`UPDATE spaces SET status = 'paused', version = version + 1 WHERE manager_id = $1 AND status = 'published'`, [userId]);
      await audit(db, { role: 'demo' }, `identity.${status}`, 'user', userId, { simulated: true });
      return { id: userId, identity: status };
    },

    sweep: () => sweeper.runOnce(),

    async reset(token) {
      const expected = config.demo.resetToken;
      const given = String(token || '');
      if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new AppError('FORBIDDEN', 403);
      return db.tx((client) => seedDemo(client, { reset: true }));
    },
  };
}
