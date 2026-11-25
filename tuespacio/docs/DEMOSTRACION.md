# Guion de demostración y sustentación

## Preparación

1. Abrir una terminal en `tuespacio/` y ejecutar `python3 -m server.run --regions all`, o `docker compose up --build -d`.
2. Abrir Colombia en `http://127.0.0.1:8080` y una ventana privada del mismo navegador para otro perfil. La sesión de la web es por pestaña/región; una ventana privada facilita comparar usuarios.
3. Comprobar `/health`, iniciar sesión como administrador y consultar Operación. Hay cinco servicios de negocio más el gateway. Un estado verde corresponde a una llamada de health, no a un SLA de disponibilidad.

## Demostración funcional (8–10 minutos)

| Tiempo | Acción | Qué demuestra |
|---|---|---|
| 0:00 | Elegir Conductor y «Entrar con cuenta de prueba» | Identidad, perfil regional y búsqueda por destino |
| 0:45 | Cambiar carro/moto y filtros; abrir un espacio | Contrato de catálogo, condiciones y disponibilidad |
| 1:30 | Reservar espacio particular por 2 h con pago aprobado | Saga, importe en servidor, código y comprobante |
| 2:30 | Descargar comprobante; abrir Mis reservas | Persistencia y consulta del resultado |
| 3:00 | Otra pestaña como anfitrión; consultar reservas | Estado compartido entre dos clientes |
| 3:30 | Registrar llegada y salida | Transiciones y liberación del cupo; ingreso neto del anfitrión |
| 4:15 | Nueva reserva y cancelación | Reembolso de prueba y cupo liberado |
| 5:00 | Operador: entrada sin reserva y edición de tarifa | Administración de capacidad y cambios visibles al conductor |
| 6:00 | Nueva publicación de anfitrión | Validación, consentimiento de revisión simulada y publicación |
| 7:00 | Administrador: transacciones y mensajes | Trazabilidad, outbox y broker |
| 8:00 | Cambiar a Japón y repetir reserva | CJK, JPY sin decimales, hora de Tokio y medios regionales |

En las otras regiones también están disponibles las cuentas de prueba con contraseña `demo123`. El selector cambia a otro gateway; se vuelve a iniciar sesión porque las sesiones son regionales.

## Fallas reproducibles

### Pago rechazado desde la interfaz

Reservar un cupo, desplegar «Escenario de prueba» y seleccionar «Simular pago rechazado». El servidor rechaza el pago; vuelve a consultar el espacio y comprobar que el hold se liberó. No se mueve dinero real.

### Concurrencia y caída real de un proceso

```bash
python3 -m unittest server.tests.http_smoke -v
```

La suite abre **30 procesos reales** en puertos 18795–18840 y bases temporales propias. Recorre cinco regiones; diez clientes compiten por el último cupo; mata el proceso de pagos de Colombia, obtiene un resultado pendiente, lo restaura y verifica que el reintento conserva una sola reserva. Finalmente comprueba permisos y los contratos de Expo. Al terminar cierra sus procesos y elimina sus datos temporales. No requiere detener la app principal en 8080.

Si el entorno no permite sockets, la clase queda **omitida**, no aprobada. No presentar la prueba de streams como evidencia de caída de procesos reales.

### Respuesta perdida, expiración y recuperación de saga

```bash
python3 -m unittest server.tests.test_system -v
```

Esta suite reproduce pérdida de respuesta posterior a captura, expiración de retención, reembolso y liberación idempotentes, reinicio de coordinador y repetición de llave. Usa SQLite real y transporte de prueba dentro del proceso. Sirve para verificar decisiones y estados, no el despliegue de red.

## Localización del caso equivalente

La aplicación es de parqueaderos: el equivalente del pedido de ejemplo es **dos horas de estacionamiento**, con llegada el 15 de noviembre de 2026 a las 20:30 locales. La reserva de prueba fija del formato se verifica sin crear una llegada pasada en la operación actual.

| Perfil | UTC almacenado equivalente | Total por 120 min, tarifa seed de carro |
|---|---|---|
| es-CO · Bogotá | 2026-11-16 01:30Z | $ 16.560 COP |
| pt-BR · São Paulo | 2026-11-15 23:30Z | R$ 24,00 BRL |
| en-US · New York | 2026-11-16 01:30Z | $36.00 USD |
| fr-FR · Paris | 2026-11-15 19:30Z | 26,40 € EUR |
| ja-JP · Tokio | 2026-11-15 11:30Z | ￥1,800 JPY |

La tipografía exacta de los espacios monetarios depende de CLDR/Intl; las pruebas incluyen espacios no separables y la zona horaria. Los importes son ejemplos, no tipos de cambio equivalentes ni tarifas comerciales verificadas.

```bash
node server/tests/locale.test.mjs
```

## Verificación visual

```bash
python3 -m server.tests.browser_check
```

La herramienta inicia servicios de prueba y Chrome, recorre los cuatro perfiles a 1440/768/390/320 px y modo oscuro, y el flujo de reserva en cinco regiones. Revisa overflow y errores JS, y genera 35 PNG en `artifacts/screenshots/`. Hay que abrir las capturas y comprobar jerarquía, foco, texto, contraste y composición: su mera existencia no equivale a aprobación visual. Requiere Chrome/Chromium y el módulo opcional `websocket-client`.

## Preguntas que cada integrante debe poder responder

- ¿Por qué separar verificar y retener con un `await` permitía doble venta? ¿Dónde está ahora la operación atómica?
- ¿Por qué un timeout no significa que el pago no ocurrió? ¿Cómo impide la llave un segundo efecto?
- ¿Qué se guarda antes de llamar a otro servicio y qué hace el trabajador al reiniciar?
- ¿Por qué una saga no equivale a una transacción ACID global?
- ¿Qué garantía aporta la outbox si el broker acepta un mensaje y se pierde el ACK?
- ¿Qué cambios exige agregar una moneda o idioma sin ramas por país en la lógica?
- ¿Qué decisiones seguirían faltando para operar comercialmente: agenda futura, pagos, identidad, TLS, réplicas y políticas de cancelación?

La entrega distingue implementación, prueba y despliegue. No afirmar que hay pagos comerciales, cinco centros de datos o replicación si se están mostrando contenedores locales.
