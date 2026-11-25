# API HTTP · Tu Espacio

Base local Colombia: `http://127.0.0.1:8080/api`. Las demás regiones cambian el puerto. UTF-8 y JSON. Respuestas correctas: `200 {"data":...}`. Error: `{"error":{"code":"...","message":"...","details":{}}}`. La consola traduce códigos conocidos al idioma regional.

Autenticación: `Authorization: Bearer <token>`. Tokens opacos con vencimiento de 12 horas; el servidor almacena su hash, no el token en claro. El logout los revoca. Contraseñas: PBKDF2-HMAC-SHA256 con sal aleatoria. El cliente móvil mantiene la sesión en memoria y la web usa sessionStorage con respaldo en memoria si el navegador lo bloquea.

## Endpoints públicos

| Método | Ruta | Entrada / respuesta |
|---|---|---|
| GET | `/region` | Perfil del gateway actual |
| GET | `/regions` | Perfiles y puertos regionales de navegación |
| POST | `/auth/login` | `{email,password,role?}` → `{token,user}` |
| POST | `/auth/register` | `{name,email,password,role:driver\|host,vehicle?}` → `{token,user}` |
| GET | `/destinations?q=` | Zonas disponibles, búsqueda sin distinguir tildes |
| GET | `/destinations/:id` | Destino |
| GET | `/spaces` | Filtros `destinationId`, `vehicle=car\|moto`, `covered=true`, `noKeys=true`, `kind=formal\|particular`, `sort=distance\|price` |
| GET | `/spaces/:id?track=true` | Espacio con disponibilidad y condiciones; registra una vista cuando `track=true` |

El login/registro está limitado a 30 peticiones por IP y minuto en cada proceso gateway. El token de una región no autentica en otra.

## Sesión y perfil

| Método | Ruta | Entrada / respuesta |
|---|---|---|
| GET | `/me` | Perfil público de la sesión |
| PATCH | `/me` | `{name?,vehicle?}` → perfil actualizado; no permite cambiar rol |
| POST | `/auth/logout` | Revoca el token enviado en Authorization |
| GET | `/notifications` | Mensajes visibles para el conductor y propietario implicados; admin ve todos los de la región |

## Reservas

```json
{
  "spaceId": "s-emp-4",
  "vehicle": "car",
  "durationMin": 120,
  "startAt": "2026-11-24T20:30:00Z",
  "idempotencyKey": "uuid-generado-por-el-cliente",
  "paymentMethod": "PSE",
  "expectedAmount": 16560,
  "scenario": "none"
}
```

La fecha debe incluir zona horaria y estar dentro de los próximos siete días, con tolerancia de cinco minutos para retrasos de envío. El ejemplo de fecha debe actualizarse al probar. `durationMin`: entero de 15 a 480. `paymentMethod` debe pertenecer al perfil regional; si falta, usa el primero. `scenario` acepta `none` o `declined` para pagos de prueba. `expectedAmount` es opcional para compatibilidad, y ambos clientes lo envían para impedir confirmar una tarifa diferente a la cotizada.

El importe y la moneda proceden del servidor. Se guardan enteros en unidad menor; COP y JPY usan cero decimales por convención didáctica del proyecto y BRL/USD/EUR dos. El impuesto configurado está incluido: `subtotal + tax == amount`. La comisión solo corresponde a espacios particulares y no se suma al total del conductor.

| Método | Ruta | Permiso y efecto |
|---|---|---|
| POST | `/reservations` | Conductor: coordina saga y devuelve reserva confirmada, error definitivo o resultado pendiente |
| GET | `/me/reservations` | Reservas accesibles a la sesión |
| GET | `/reservations/:id` | Conductor titular, propietario del espacio o admin |
| POST | `/reservations/:id/cancel` | `confirmed → cancelling → cancelled`; reembolso y liberación |
| POST | `/reservations/:id/check-in` | `confirmed → active` |
| POST | `/reservations/:id/check-out` | `active → checking_out → completed`; libera el cupo |

Repetir una mutación ya completada devuelve su resultado sin aplicar de nuevo el efecto. La creación deduplica por `(región, usuario, idempotencyKey)` y compara la huella del cuerpo. Una llave con otro cuerpo devuelve `409 IDEMPOTENCY_CONFLICT`. El reintento conserva exactamente la fecha y el cuerpo originales, incluso si el cliente se recarga. Un replay confirmado funciona aunque su fecha de llegada ya haya pasado.

Estados internos recuperables: `pending`, `compensating`, `cancelling`, `checking_out`. Tras un rechazo definitivo la reserva queda `failed`. La retención `held` vence a los diez minutos. Las reservas confirmadas no vencen automáticamente: permanecen comprometidas hasta cancelación o salida.

## Operación de espacios

| Método | Ruta | Respuesta / permisos |
|---|---|---|
| GET | `/owner/space` | Operador: `{space,plan,metrics:{views[7],reservations[7]}}` |
| GET | `/host/spaces` | Espacios de la cuenta |
| POST | `/host/spaces` | Anfitrión: alta de espacio particular |
| PATCH | `/spaces/:id` | Propietario o admin: nombre, dirección, zona, tarifas, capacidad, condiciones, horario y estado |
| POST | `/spaces/:id/occupancy` | `{vehicle,delta:1\|-1}`; entrada/salida sin reserva, sin exceder capacidad |
| GET | `/spaces/:id/reservations` | Reservas accesibles de ese espacio |
| GET | `/host/reservations` | Reservas accesibles de los espacios de la cuenta |
| GET | `/host/earnings` | Anfitrión: `{gross,pending,commission,commissionRate,net,count,items}` |

Publicación: `{name,address,destinationId,capacity:{car,moto},rates:{car,moto},schedule:{open,close,days},conditions:{covered,keys,maxHeight},status,identityConsent:true}`. `rates[vehicle]` es `null` cuando la capacidad es cero, o `{unit:minute|hour,price:enteroPositivo}`. Se permiten valores de altura de 0,5–10 m o `null`. El servidor fija propietario, tipo, métricas y ubicación esquemática; el cliente no puede inyectarlos.

La solicitud de verificación se conserva como pendiente de demostración, sin afirmar identidad aprobada. Cambiar la capacidad por debajo de ocupados, retenidos y reservas confirmadas falla con `409`.

## Supervisión

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/ops/status` | Admin: cinco servicios, respuesta y latencia observada |
| GET | `/ops/spaces` | Admin: catálogo completo de la región |
| GET | `/ops/reservations` | Admin: reservas y pasos de saga |
| GET | `/demo/transactions` | Sesión: trazas de reservas accesibles; admin ve todas |
| GET | `/health` | Fuera de `/api`: gateway vivo; los health internos requieren clave de servicio |

Los endpoints internos de inventario, pagos y broker están ligados a loopback y exigen `X-Service-Key`; nunca se publican mediante el gateway. El gateway ignora un `X-User` enviado por el cliente y resuelve la identidad con el token.

## Errores relevantes

| HTTP | Código | Recuperación |
|---|---|---|
| 401 | `INVALID_CREDENTIALS`, `UNAUTHORIZED` | Revisar credenciales o iniciar sesión |
| 403 | `FORBIDDEN`, `ROLE_MISMATCH` | Usar la cuenta autorizada |
| 402 | `PAYMENT_DECLINED` | Retención compensada; elegir otro intento de pago de prueba |
| 409 | `SPACE_TAKEN` | Elegir otro espacio |
| 409 | `PRICE_CHANGED` | Actualizar y aceptar la nueva cotización |
| 409 | `IDEMPOTENCY_CONFLICT` | Recuperar el cuerpo original; no cambiar parámetros de una operación incierta |
| 409 | `CAPACITY_CONFLICT`, `INVALID_STATE`, `HOLD_EXPIRED` | Refrescar disponibilidad/estado |
| 422 | `VALIDATION` | Corregir campos; mensaje explicativo |
| 413 | `PAYLOAD_TOO_LARGE` | Máximo 64 KiB por solicitud |
| 429 | `RATE_LIMITED` | Esperar un minuto |
| 503 | `RESERVATION_PENDING` | Conservar cuerpo/llave y reintentar; puede continuar en el servidor |
| 503 | `SERVICE_UNAVAILABLE` | Restaurar el proceso y reintentar |

El contrato antiguo del mock se conserva en [API_MOCK_ORIGINAL.md](API_MOCK_ORIGINAL.md). Algunos códigos son específicos del mock; una falta de respuesta del backend HTTP no implica por sí sola que no haya ocurrido un cobro simulado.
