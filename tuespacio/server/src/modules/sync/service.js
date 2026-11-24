// Feed de cambios para invalidar consultas en los clientes (alternativa barata a WebSocket).
// El cliente guarda `cursor` y pregunta cada N segundos: GET /sync?cursor=123.
//   · topic 'space' es público (cambió disponibilidad o datos de un espacio)
//   · topic 'reservation' solo llega al conductor y al administrador del espacio afectado
// Si el cursor es más viejo que lo retenido (1 día), responde reset=true y el cliente recarga todo.
export function createSyncService({ db }) {
  return {
    async changes(req, { cursor }) {
      const head = (await db.one('SELECT COALESCE(max(seq), 0)::bigint AS seq, COALESCE(min(seq), 0)::bigint AS min FROM change_log')) || { seq: 0, min: 0 };
      if (cursor === undefined) return { cursor: head.seq, spaces: [], reservations: [], reset: false, pollAfterSec: 15 };
      if (cursor > head.seq) return { cursor: head.seq, spaces: [], reservations: [], reset: true, pollAfterSec: 15 };
      if (head.min && cursor < head.min - 1) return { cursor: head.seq, spaces: [], reservations: [], reset: true, pollAfterSec: 15 };
      const rows = (
        await db.query(
          `SELECT seq, topic, entity_id FROM change_log
            WHERE seq > $1 AND (topic = 'space' OR (topic = 'reservation' AND scope_user_id = $2))
            ORDER BY seq LIMIT 500`,
          [cursor, req.user?.id || '']
        )
      ).rows;
      const last = rows.length === 500 ? rows[rows.length - 1].seq : head.seq;
      return {
        cursor: last,
        spaces: [...new Set(rows.filter((r) => r.topic === 'space').map((r) => r.entity_id))],
        reservations: [...new Set(rows.filter((r) => r.topic === 'reservation').map((r) => r.entity_id))],
        reset: false,
        pollAfterSec: 15,
      };
    },
  };
}
