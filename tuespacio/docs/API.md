# Contrato API REST · Tu Espacio (prototipo)

Contrato que hoy implementa el backend **simulado** (`app/src/api/mock`) y que deberá respetar el backend real. JSON en ambos sentidos, autenticación con `Authorization: Bearer <token>`.

- Respuesta correcta: el recurso (o `{ "data": ... }`, ambos se aceptan en `transport.js`).
- Error: `{ "error": { "code": "SPACE_TAKEN", "message": "...", "details": { ... } } }` con el código HTTP correspondiente.
- Errores de validación: `422 VALIDATION` con `details.fields = { "campo": "mensaje" }`.

## Servicios

| Servicio | Responsabilidad | Endpoints |
|---|---|---|
| Autenticación y usuarios | Registro, sesión, perfil, acceso por rol | `/auth/*`, `/me` |
| Catálogo y geolocalización | Destinos, espacios cercanos, condiciones, tarifas | `/destinations`, `/spaces` |
| Disponibilidad y reservas | Cupos, retención, reserva, llegada/salida, cancelación (coordina T0) | `/reservations`, `/me/reservations` |
| Pagos y facturación | Preautorizar, capturar, reembolsar (pasarela externa) | interno, llamado por Reservas |
| Panel | Cupos, tarifas, horarios, métricas, ingresos | `/owner/*`, `/host/*`, `PATCH /spaces/:id` |
| Notificaciones | Avisos push (fuera de T0, asíncrono) | no implementado |

## Autenticación y usuarios

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password, role? }` | `{ token, user }` · `401 INVALID_CREDENTIALS` · `403 ROLE_MISMATCH` |
| POST | `/auth/register` | `{ name, email, password, role: "driver"\|"host", vehicle? }` | `{ token, user }` · `409 EMAIL_IN_USE` |
| GET | `/me` | — | `User` |
| PATCH | `/me` | `{ vehicle }` | `User` |

`User = { id, role: "driver"|"owner"|"host", name, email, vehicle?, plan?, identity? }`

## Catálogo

| Método | Ruta | Parámetros | Respuesta |
|---|---|---|---|
| GET | `/destinations` | `q` | `Destination[]` |
| GET | `/spaces` | `destinationId`, `vehicle=car\|moto`, `covered=true`, `noKeys=true`, `kind=formal\|particular`, `sort=distance\|price` | `Space[]` |
| GET | `/spaces/:id` | `track=true` (cuenta una visita para las métricas del dueño) | `Space` |

```json
{
  "id": "s-emp-1",
  "kind": "formal",
  "name": "Parqueadero Torre 72",
  "address": "Cra. 9 #72-15",
  "destinationId": "d-emp",
  "distanceM": 190,
  "rates": { "car": { "unit": "minute", "price": 138 }, "moto": { "unit": "minute", "price": 95 } },
  "capacity": { "car": 40, "moto": 12 },
  "schedule": { "open": "06:00", "close": "22:00", "days": "Lun – Sáb" },
  "conditions": { "covered": true, "keys": false, "maxHeight": 2.1 },
  "status": "published",
  "plan": "Destacado",
  "host": null,
  "availability": { "car": { "free": 8, "capacity": 40, "occupied": 30, "reserved": 2, "held": 0, "status": "available" } }
}
```

`availability.status`: `available` · `few` (≤ 3 libres) · `full` · `unsupported` · `paused`.

## Reservas — transacción T0 «Reservar cupo con pago»

`POST /reservations`

```json
{ "spaceId": "s-emp-4", "vehicle": "car", "startAt": "2026-10-26T19:30:00Z", "durationMin": 120, "idempotencyKey": "idem-…" }
```

El servicio de Reservas actúa como coordinador:

| Paso | Acción | Compensación |
|---|---|---|
| T11 | Verificar que el cupo esté libre | — (lectura) |
| T12 | Retener el cupo (vence a los 10 min) | Liberar el cupo |
| T21 | Preautorizar el pago | Anular la autorización |
| T22 | Registrar tarifa y comisión | Reversar el registro |
| T23 | Capturar el pago | Reembolsar |
| T13 | Confirmar la reserva | Cancelar la reserva |

Respuestas:

- `201` → `Reservation` (estado `confirmed`).
- `409 SPACE_TAKEN` → aborta antes de cobrar; `details.alternatives: Space[]`.
- `402 PAYMENT_DECLINED` → compensa T12.
- `504 GATEWAY_TIMEOUT` → reintenta con la misma llave; si no responde, compensa T12.
- Repetir la misma `idempotencyKey` devuelve la reserva ya creada (sin doble cobro).

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/me/reservations` | `Reservation[]` del conductor |
| GET | `/reservations/:id` | `Reservation` |
| POST | `/reservations/:id/cancel` | solo `confirmed` → `cancelled` (reembolso simulado) |
| POST | `/reservations/:id/check-in` | `confirmed` → `active` |
| POST | `/reservations/:id/check-out` | `active` → `completed` |

`Reservation = { id, code, spaceId, driverId, driverName, vehicle, status, startAt, endAt, durationMin, amount, createdAt, checkInAt, space: {...}, payment: { method, status } }`

## Panel

| Método | Ruta | Cuerpo | Uso |
|---|---|---|---|
| GET | `/owner/space` | — | `{ space, plan, metrics: { views[7], reservations[7] } }` |
| PATCH | `/spaces/:id` | `{ capacity?, rates?, schedule?, conditions?, status?, name?, address? }` | Dueño o anfitrión del espacio · `422` con campos |
| POST | `/spaces/:id/occupancy` | `{ vehicle, delta: 1\|-1 }` | Entradas/salidas sin reserva · `409 NO_FREE_SPOTS` |
| GET | `/spaces/:id/reservations` | — | Reservas recibidas |
| GET | `/host/spaces` | — | Espacios del anfitrión |
| POST | `/host/spaces` | `{ name, address, destinationId, hostType, capacity, rates, schedule, conditions, identityConsent }` | Publicar espacio particular |
| GET | `/host/reservations` | — | Reservas en todos sus espacios |
| GET | `/host/earnings` | — | `{ gross, pending, commissionRate: null, net: null, items }` |

## Solo prototipo

`GET /demo/transactions` devuelve el registro de las últimas transacciones T0 con cada paso y compensación. No debe existir en producción.
