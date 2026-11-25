# Correcciones acotadas · ronda 1

Objetivo inicial: `37bdef4c5a51ce08278e29b62b4525bba02014e3ce5431b68c52b2200504c984`.

Se atendieron exclusivamente JD-01, JD-02 y JD-03, confirmados por ambos jueces. El ledger congelado no se modificó. No se corrigieron IDs sospechosos ni informativos. Este documento registra implementación y evidencia; no emite juicio ni autoriza entrega.

## JD-01 · recuperar la orden antes de compensar

**Estado: fixed.** La recuperación de `providerId` usa una función compartida que repite el POST de creación con el cuerpo persistido y la misma clave. Tanto checkout como refund/void la utilizan. Así, si el proveedor creó la orden pero se perdió su respuesta, una retención ya vencida puede recuperar la orden, consultar su estado y anularla o reembolsarla de forma idempotente. No se solicita otra retención ni se confirma un cupo vencido.

Archivos: `server/mercadopago.py`, `server/tests/test_checkout.py`.

Prueba enfocada: dos regresiones crean remotamente una orden y pierden su respuesta, vencen la retención, reinician el adaptador a partir de su SQLite y ejecutan tres ticks. Se comprueba estado final failed, anulación o devolución según acreditación, una sola orden remota, una sola reversión, cupo liberado y dos POST de creación con idéntico cuerpo y clave. Ambas pasan.

Comando: `python3 -m unittest server.tests.test_checkout -v` — **13 pruebas aprobadas**, incluidas las dos regresiones. Son fixtures locales de contrato con SQLite real; no se contactó a Mercado Pago ni se abrieron sockets.

Límite de reversión: helper `recover_order`, sus dos llamadas y los dos casos nuevos con su función de escenario. Revertir estos cambios juntos recupera el comportamiento previo sin modificar esquemas ni registros existentes.

## JD-02 · conservar la navegación hacia reservas sin terminar

**Estado: fixed.** Las pestañas clasifican todos los estados mediante una regla compartida: completed/cancelled/failed aparecen en Historial; los estados pendientes, de recuperación, activos y desconocidos aparecen en Actuales. El acceso destacado de Explorar usa la misma clasificación e incluye awaiting_payment. Se conservan las rutas existentes al detalle, donde están las acciones de pago y cancelación.

Archivos: `app/src/domain/rules.js`, `app/src/app/driver/reservations.js`, `app/src/app/driver/index.js`, `app/scripts/mock.test.mjs`.

Pruebas enfocadas: reserva awaiting_payment accesible al volver al listado, separación de historial, acceso destacado, y clasificación de todos los estados de recuperación. Se incluyen dentro del comando de pruebas ya existente: `npm run test:mock --prefix app` — **10 pruebas aprobadas**, incluidas tres nuevas pruebas de estados/navegación compartida.

Límite de reversión: helpers `reservationTab`/`openReservation`, su uso en ambas pantallas y pruebas nuevas correspondientes. Las etiquetas de estado de JD-03 pueden conservarse por separado.

## JD-03 · etiquetas seguras para estados del servidor

**Estado: fixed.** Se añaden pending, compensating y failed a los metadatos. El helper `reservationStatus` devuelve una etiqueta neutral para estados desconocidos o nombres heredados de Object. Tanto ReservationBadge como ReservationCard lo usan; desaparecen los accesos directos inseguros al mapa de estados.

Archivos: `app/src/domain/rules.js`, `app/src/components/parking.js`, `app/scripts/mock.test.mjs`.

Pruebas enfocadas: texto visible para todos los estados, failed en historial y fallback para un estado futuro, null, undefined, toString y __proto__. Incluidas en las 10 pruebas anteriores. Además se ejecutaron las funciones reales ReservationBadge y ReservationCard transformando JSX con Babel y stubs de vistas/hooks para **11 estados**, sin excepción. Esto verifica ejecución de esas funciones; no equivale a un render nativo o revisión visual.

Límite de reversión: tres entradas nuevas de metadatos, helper `reservationStatus`, dos sustituciones de lookup en componentes y casos correspondientes. No requiere cambios de persistencia ni API.

## Límites de verificación

`npm run lint --prefix app` se intentó: bloqueado por ausencia de dependencias locales; se encuentra ESLint global 6.4, incompatible con la configuración Expo actual. `npx --offline tsc --noEmit` se intentó: ENOTCACHED, TypeScript no está instalado. No se instalaron paquetes ni se alteró la configuración para ocultar esos fallos. El proyecto usa JavaScript y no incluye configuración TypeScript.

No se declara validación de dispositivo, accesibilidad visual, contraste o navegador. Este entorno no tiene dependencias Expo y bloquea sockets/Chrome. Se preservaron componentes, estilos, colores y rutas existentes; la revisión visual continúa pendiente fuera del sandbox.

Skill Resolution: paths-injected — `/home/david/.claude/skills/judgment-day/SKILL.md`; `/home/david/.claude/skills/impeccable/SKILL.md`; `/home/david/.codex/skills/.system/review-agent/SKILL.md`; `/home/david/Escritorio/SD/proyecto_sd-main/.claude/skills/ui-ux-pro-max/SKILL.md`.
