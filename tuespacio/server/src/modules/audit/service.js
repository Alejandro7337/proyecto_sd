// Registro de auditoría (append-only) y feed de cambios para sincronización de clientes.
// `data` nunca debe contener contraseñas, tokens, códigos ni datos de pago completos.
export async function audit(client, actor, action, entityType, entityId, data = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, request_id, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actor?.id || null, actor?.role || null, action, entityType, entityId, actor?.requestId || null, data]
  );
}

// topic 'space' es público (cambió un espacio del catálogo); 'reservation' se dirige a un usuario.
export async function recordChange(client, topic, entityId, scopeUserId = null) {
  await client.query('INSERT INTO change_log (topic, entity_id, scope_user_id) VALUES ($1, $2, $3)', [topic, entityId, scopeUserId]);
}

// Diferencia superficial entre dos objetos (para el historial de cambios de un espacio).
export function diff(before, after) {
  const out = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key])) out[key] = { from: before?.[key] ?? null, to: after[key] };
  }
  return out;
}
