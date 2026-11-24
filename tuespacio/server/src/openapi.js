// Especificación OpenAPI 3.1 servida en GET /openapi.json (documentación legible: docs/API.md).
const err = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const json = (ref, description = 'OK') => ({ description, content: { 'application/json': { schema: ref.startsWith('#') ? { $ref: ref } : { type: ref } } } });
const body = (props, required = []) => ({ required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required, properties: props } } } });
const q = (name, schema, description, required = false) => ({ name, in: 'query', required, schema, description });
const p = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const auth = [{ bearer: [] }];
const S = (type, extra = {}) => ({ type, ...extra });
const common = { 401: err('Sin sesión, token vencido (TOKEN_EXPIRED) o revocado (SESSION_REVOKED)'), 429: err('RATE_LIMITED'), 503: err('SERVICE_UNAVAILABLE') };

const op = (tags, summary, { security, params, requestBody, responses = { 200: json('object') }, description } = {}) => ({
  tags,
  summary,
  ...(description ? { description } : {}),
  ...(security ? { security } : {}),
  ...(params ? { parameters: params } : {}),
  ...(requestBody ? { requestBody } : {}),
  responses: { ...responses, ...(security ? common : { 429: common[429], 503: common[503] }) },
});

export function openapi(config) {
  const slotParams = [q('startAt', S('string', { format: 'date-time' }), 'Inicio de la franja (por defecto, ahora)'), q('durationMin', S('integer', { minimum: 30, maximum: 1440 }), 'Duración (por defecto 60)')];
  return {
    openapi: '3.1.0',
    info: {
      title: 'Tu Espacio API',
      version: '1.0.0',
      description:
        'API REST de Tu Espacio. JSON en ambos sentidos. Errores: { error: { code, message, details, requestId } }. ' +
        'Idiomas de mensajes: Accept-Language es|en. Pagos ' + (config.payments.live ? 'REALES' : 'SIMULADOS (no se mueve dinero)') + '.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Token de acceso opaco (te_at_…), 15 min por defecto. Renovar con /auth/refresh.' } },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: S('string'), message: S('string'), details: S('object'), requestId: S('string') } } },
        },
        Session: {
          type: 'object',
          properties: { token: S('string'), refreshToken: S('string'), accessExpiresAt: S('string'), refreshExpiresAt: S('string'), user: { $ref: '#/components/schemas/User' } },
        },
        User: {
          type: 'object',
          properties: {
            id: S('string'),
            role: S('string', { enum: ['driver', 'owner', 'host'] }),
            name: S('string'),
            email: S('string'),
            vehicle: S('string', { enum: ['car', 'moto'] }),
            plan: S('string'),
            identity: S('string', { enum: ['pending', 'in_review', 'verified', 'rejected'] }),
            mustChangePassword: S('boolean'),
            preferences: S('object'),
          },
        },
        Space: {
          type: 'object',
          description: 'Espacio con disponibilidad calculada para la franja pedida (slot).',
          properties: {
            id: S('string'),
            kind: S('string', { enum: ['formal', 'particular'] }),
            name: S('string'),
            address: { type: ['string', 'null'], description: 'null en particulares hasta reservar' },
            destinationId: S('string'),
            location: S('object'),
            pos: S('object'),
            distanceM: S('integer'),
            rates: S('object'),
            capacity: S('object'),
            schedule: S('object'),
            conditions: S('object'),
            status: S('string'),
            availability: { type: 'object', description: '{ car|moto: { free, capacity, occupied, reserved, held, status } }; status: available|few|full|closed|unsupported|paused' },
            slot: S('object'),
          },
        },
        Reservation: {
          type: 'object',
          properties: {
            id: S('string'),
            code: S('string'),
            status: S('string', { enum: ['confirmed', 'active', 'completed', 'cancelled', 'expired'] }),
            startAt: S('string'),
            endAt: S('string'),
            durationMin: S('integer'),
            amount: S('integer'),
            refund: { type: ['integer', 'null'] },
            checkInWindow: S('object'),
            space: S('object'),
            payment: S('object'),
          },
        },
      },
    },
    paths: {
      '/health': { get: op(['Operación'], 'Liveness') },
      '/ready': { get: op(['Operación'], 'Readiness (verifica la base)') },
      '/auth/register': {
        post: op(['Autenticación'], 'Registro de conductor o anfitrión (los dueños los crea el equipo comercial)', {
          requestBody: body({ name: S('string'), email: S('string'), password: S('string', { description: 'mín. 8, letras y números' }), role: S('string', { enum: ['driver', 'host'] }), vehicle: S('string', { enum: ['car', 'moto'] }) }, ['name', 'email', 'password', 'role']),
          responses: { 201: json('#/components/schemas/Session'), 403: err('ROLE_NOT_ALLOWED'), 409: err('EMAIL_IN_USE'), 422: err('VALIDATION') },
        }),
      },
      '/auth/login': {
        post: op(['Autenticación'], 'Inicio de sesión', {
          requestBody: body({ email: S('string'), password: S('string'), role: S('string') }, ['email', 'password']),
          responses: { 200: json('#/components/schemas/Session'), 401: err('INVALID_CREDENTIALS'), 403: err('ROLE_MISMATCH / ACCOUNT_DISABLED') },
        }),
      },
      '/auth/refresh': {
        post: op(['Autenticación'], 'Renueva y ROTA el par de tokens. Reusar un refresh rotado revoca la sesión.', {
          requestBody: body({ refreshToken: S('string') }, ['refreshToken']),
          responses: { 200: json('#/components/schemas/Session'), 401: err('UNAUTHORIZED / TOKEN_EXPIRED / SESSION_REVOKED') },
        }),
      },
      '/auth/logout': { post: op(['Autenticación'], 'Revoca la sesión actual', { security: auth, responses: { 204: { description: 'Sin contenido' } } }) },
      '/auth/logout-all': { post: op(['Autenticación'], 'Revoca todas las sesiones del usuario', { security: auth, responses: { 204: { description: 'Sin contenido' } } }) },
      '/auth/password/forgot': {
        post: op(['Autenticación'], 'Solicita código de recuperación (siempre 202; entrega simulada en outbox)', { requestBody: body({ email: S('string') }, ['email']), responses: { 202: json('object') } }),
      },
      '/auth/password/reset': {
        post: op(['Autenticación'], 'Restablece la contraseña con el código (máx. 5 intentos; revoca sesiones)', {
          requestBody: body({ email: S('string'), code: S('string'), password: S('string') }, ['email', 'code', 'password']),
          responses: { 204: { description: 'Sin contenido' }, 400: err('RESET_CODE_INVALID'), 422: err('VALIDATION') },
        }),
      },
      '/auth/password/change': {
        post: op(['Autenticación'], 'Cambia la contraseña (revoca las demás sesiones)', { security: auth, requestBody: body({ currentPassword: S('string'), newPassword: S('string') }), responses: { 204: { description: 'Sin contenido' }, 400: err('PASSWORD_MISMATCH') } }),
      },
      '/me': {
        get: op(['Perfil'], 'Usuario actual', { security: auth, responses: { 200: json('#/components/schemas/User') } }),
        patch: op(['Perfil'], 'Edita nombre, vehículo principal o preferencias', { security: auth, requestBody: body({ name: S('string'), vehicle: S('string'), preferences: S('object') }), responses: { 200: json('#/components/schemas/User') } }),
      },
      '/me/vehicles': {
        get: op(['Perfil'], 'Vehículos del conductor', { security: auth }),
        post: op(['Perfil'], 'Agrega vehículo (tipo, nombre, placa y altura opcionales)', { security: auth, requestBody: body({ type: S('string'), label: S('string'), plate: S('string'), heightM: S('number'), isDefault: S('boolean') }), responses: { 201: json('object') } }),
      },
      '/me/vehicles/{id}': {
        patch: op(['Perfil'], 'Edita vehículo', { security: auth, params: [p('id')] }),
        delete: op(['Perfil'], 'Archiva vehículo (no el último)', { security: auth, params: [p('id')], responses: { 204: { description: 'Sin contenido' }, 409: err('LAST_VEHICLE') } }),
      },
      '/me/payment-methods': { get: op(['Perfil'], 'Medios de pago FICTICIOS (4242 aprueba, 0002 rechaza, 0119 sin respuesta, 0341 responde tras reintento)', { security: auth }) },
      '/me/payment-methods/{id}/default': { post: op(['Perfil'], 'Marca medio de pago por defecto', { security: auth, params: [p('id')] }) },
      '/destinations': { get: op(['Catálogo'], 'Busca destinos (zonas piloto)', { params: [q('q', S('string'), 'Texto libre, sin tildes')] }) },
      '/destinations/{id}': { get: op(['Catálogo'], 'Destino', { params: [p('id')], responses: { 200: json('object'), 404: err('DESTINATION_NOT_FOUND') } }) },
      '/spaces': {
        get: op(['Catálogo'], 'Espacios cerca del destino con disponibilidad por franja', {
          params: [
            q('destinationId', S('string'), 'Destino', true),
            q('vehicle', S('string', { enum: ['car', 'moto'] }), 'Tipo de vehículo'),
            q('covered', S('boolean'), 'Solo techados'),
            q('noKeys', S('boolean'), 'Sin entrega de llaves'),
            q('kind', S('string', { enum: ['formal', 'particular'] }), 'Parqueadero formal o particular'),
            q('sort', S('string', { enum: ['distance', 'price'] }), 'Orden'),
            q('availableOnly', S('boolean'), 'Solo con cupo en la franja'),
            ...slotParams,
          ],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Space' } } } } }, 404: err('DESTINATION_NOT_FOUND'), 422: err('VALIDATION') },
        }),
      },
      '/spaces/{id}': {
        get: op(['Catálogo'], 'Detalle (track=true cuenta una visita)', { params: [p('id'), q('track', S('boolean'), 'Contar visita'), ...slotParams], responses: { 200: json('#/components/schemas/Space'), 404: err('SPACE_NOT_FOUND') } }),
        patch: op(['Panel'], 'Edita cupos, tarifas, horario por día, condiciones, publicación (version = concurrencia optimista)', {
          security: auth,
          params: [p('id')],
          requestBody: body({ name: S('string'), address: S('string'), capacity: S('object'), rates: S('object'), schedule: S('object'), conditions: S('object'), status: S('string'), version: S('integer') }),
          responses: { 200: json('#/components/schemas/Space'), 403: err('FORBIDDEN / IDENTITY_REQUIRED'), 409: err('VERSION_CONFLICT / SCHEDULE_CONFLICT'), 422: err('VALIDATION (incl. CAPACITY_BELOW_USE)') },
        }),
      },
      '/spaces/{id}/availability': { get: op(['Catálogo'], 'Disponibilidad de un día local por bloques y horas de llegada válidas', { params: [p('id'), q('date', S('string', { format: 'date' }), 'YYYY-MM-DD'), q('vehicle', S('string'), ''), q('durationMin', S('integer'), ''), q('stepMin', S('integer'), '')] }) },
      '/spaces/{id}/quote': { get: op(['Catálogo'], 'Precio y disponibilidad de una franja', { params: [p('id'), q('vehicle', S('string'), '', true), ...slotParams] }) },
      '/reservations': {
        post: op(['Reservas'], 'Transacción T0: reservar cupo con pago (saga con compensaciones)', {
          security: auth,
          description:
            'Idempotente: la misma idempotencyKey (cuerpo o cabecera Idempotency-Key) devuelve el resultado original sin doble cobro (200 + Idempotent-Replayed: true). ' +
            'Pasos: T11 verificar, T12 retener (vence en ' + config.booking.holdMinutes + ' min), T21 preautorizar, T22 registrar tarifa/comisión, T23 capturar, T13 confirmar.',
          requestBody: body(
            { spaceId: S('string'), vehicle: S('string'), vehicleId: S('string'), paymentMethodId: S('string'), startAt: S('string', { format: 'date-time' }), durationMin: S('integer'), idempotencyKey: S('string') },
            ['spaceId', 'vehicle', 'startAt', 'durationMin']
          ),
          responses: {
            201: json('#/components/schemas/Reservation', 'Confirmada'),
            200: json('#/components/schemas/Reservation', 'Reintento idempotente'),
            402: err('PAYMENT_DECLINED (cupo liberado)'),
            409: err('SPACE_TAKEN (details.alternatives) / OUTSIDE_SCHEDULE / OVERLAPPING_RESERVATION / HOLD_EXPIRED / IDEMPOTENCY_IN_PROGRESS'),
            422: err('VALIDATION / VEHICLE_NOT_ACCEPTED / VEHICLE_TOO_TALL / IDEMPOTENCY_KEY_REUSED'),
            504: err('GATEWAY_TIMEOUT (reintentos agotados, cupo liberado)'),
          },
        }),
      },
      '/reservations/attempts/{key}': { get: op(['Reservas'], 'Pasos de la saga T0 en vivo para una llave de idempotencia', { security: auth, params: [p('key')] }) },
      '/me/reservations': { get: op(['Reservas'], 'Reservas del conductor', { security: auth, params: [q('scope', S('string', { enum: ['current', 'history'] }), '')] }) },
      '/reservations/{id}': { get: op(['Reservas'], 'Reserva (conductor dueño o administrador del espacio; si no, 404)', { security: auth, params: [p('id')], responses: { 200: json('#/components/schemas/Reservation'), 404: err('RESERVATION_NOT_FOUND') } }) },
      '/reservations/{id}/cancel': { post: op(['Reservas'], 'Cancelar (conductor). Reembolso total antes de la llegada [supuesto]', { security: auth, params: [p('id')], responses: { 200: json('#/components/schemas/Reservation'), 409: err('INVALID_STATE') } }) },
      '/reservations/{id}/check-in': { post: op(['Reservas'], 'Registrar llegada (ventana: 15 min antes a 30 min después)', { security: auth, params: [p('id')], responses: { 200: json('#/components/schemas/Reservation'), 409: err('TOO_EARLY / TOO_LATE / INVALID_STATE') } }) },
      '/reservations/{id}/check-out': { post: op(['Reservas'], 'Registrar salida', { security: auth, params: [p('id')] }) },
      '/reservations/{id}/reschedule': { post: op(['Reservas'], 'Cambiar de franja (misma duración y precio)', { security: auth, params: [p('id')], requestBody: body({ startAt: S('string') }, ['startAt']) }) },
      '/owner/space': { get: op(['Panel'], 'Parqueadero del dueño con ocupación y métricas de 7 días', { security: auth }) },
      '/owner/metrics': { get: op(['Panel'], 'Visitas, reservas, conversión e ingresos por día', { security: auth, params: [q('from', S('string'), 'YYYY-MM-DD'), q('to', S('string'), 'YYYY-MM-DD'), q('spaceId', S('string'), '')] }) },
      '/spaces/{id}/occupancy': { post: op(['Panel'], 'Entrada/salida sin reserva', { security: auth, params: [p('id')], requestBody: body({ vehicle: S('string'), delta: S('integer', { enum: [1, -1] }) }, ['vehicle', 'delta']), responses: { 200: json('#/components/schemas/Space'), 409: err('NO_FREE_SPOTS / NOTHING_TO_RELEASE') } }) },
      '/spaces/{id}/reservations': { get: op(['Panel'], 'Reservas recibidas (filtros status, from, to, code)', { security: auth, params: [p('id')] }) },
      '/spaces/{id}/validate-code': { post: op(['Panel'], 'Valida el código que presenta el conductor', { security: auth, params: [p('id')], requestBody: body({ code: S('string') }, ['code']), responses: { 200: json('#/components/schemas/Reservation'), 404: err('CODE_NOT_FOUND') } }) },
      '/spaces/{id}/history': { get: op(['Panel'], 'Historial de cambios y de disponibilidad del espacio', { security: auth, params: [p('id')] }) },
      '/host/spaces': {
        get: op(['Panel'], 'Espacios del anfitrión', { security: auth }),
        post: op(['Panel'], 'Publicar espacio particular (inicia verificación de identidad)', { security: auth, responses: { 201: json('#/components/schemas/Space'), 422: err('VALIDATION') } }),
      },
      '/host/reservations': { get: op(['Panel'], 'Reservas en todos los espacios del anfitrión', { security: auth }) },
      '/host/earnings': { get: op(['Panel'], 'Ingresos, comisión, neto y criterio de liquidación', { security: auth }) },
      '/host/identity': { post: op(['Panel'], 'Solicitar verificación de identidad', { security: auth }) },
      '/sync': { get: op(['Sincronización'], 'Cambios desde un cursor (para invalidar consultas por polling)', { params: [q('cursor', S('integer'), 'Último cursor recibido')] }) },
      ...(config.demo.enabled
        ? {
            '/demo/transactions': { get: op(['Demo'], 'Registro de las últimas 15 sagas T0 con cada paso') },
            '/demo/outbox': { get: op(['Demo'], 'Correos simulados (códigos de recuperación)', { params: [q('email', S('string'), '', true)] }) },
            '/demo/identity/{userId}/{decision}': { post: op(['Demo'], 'Aprobar o rechazar verificación (simulado)', { params: [p('userId'), p('decision')] }) },
            '/demo/sweep': { post: op(['Demo'], 'Ejecuta el barrido ya') },
            '/demo/reset': { post: op(['Demo'], 'Reinicia datos demo (cabecera X-Demo-Token)') },
          }
        : {}),
    },
  };
}
