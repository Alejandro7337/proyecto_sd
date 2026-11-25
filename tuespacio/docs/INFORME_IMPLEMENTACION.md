# Tu Espacio

## Informe de implementación del prototipo regional

Proyecto de Sistemas Distribuidos. Revisión: 24 de noviembre de 2026.

## 1. Problema y solución

Un conductor necesita conocer cupos, tarifa y condiciones de estacionamiento cerca de su destino antes de salir. El operador necesita que las reservas digitales y las entradas físicas compartan una misma disponibilidad. Un anfitrión puede ofrecer un garaje o lote particular.

Tu Espacio resuelve la búsqueda por destino y la reserva con pago de prueba, código, llegada, salida y cancelación. La transacción crítica es garantizar que dos conductores no compren simultáneamente el último cupo y que un reintento no produzca un segundo pago.

El caso de domicilios del enunciado es una referencia; el equipo confirmó que su negocio es parqueaderos y espacios particulares. Las cinco regiones lógicas son Colombia, Brasil, Estados Unidos, Francia y Japón.

## 2. Alcance funcional

- Conductor: cuenta, búsqueda por zona, carro/moto, filtros, condiciones, reserva, comprobante, historial, llegada, salida y cancelación con reembolso simulado.
- Operador: capacidad y disponibilidad, reservas recibidas, entradas sin reserva, tarifas, horarios, condiciones y publicación de su parqueadero.
- Anfitrión: publicar y editar espacios, pausar su oferta, gestionar llegadas/salidas y consultar ingresos y comisión de prueba.
- Administración: servicios regionales, latencia observada, reservas, catálogo, perfiles y registro de cada saga.

La consola web cubre cuatro perfiles y cinco idiomas. El cliente Expo existente conserva los tres perfiles operativos y formatos colombianos. Los pagos, el mapa y la verificación de identidad son simulados y se identifican como tales. No se necesitan documentos personales ni medios de pago reales.

## 3. Diseño de procesos y datos

Cada región tiene seis procesos: gateway, identidad, inventario, reservas, pagos y broker. HTTP/JSON comunica los clientes JavaScript con los servicios Python, y los servicios entre sí. En Docker, cada región es un contenedor con red y volumen propios. En local, el lanzador crea treinta procesos para cinco regiones.

Identidad posee usuarios y sesiones; Inventario posee cupos y holds; Pagos posee autorizaciones; Reservas posee journal, idempotencia y outbox; el Broker posee eventos deduplicados. Cada servicio utiliza exclusivamente su propia base SQLite. El gateway compone respuestas llamando a los servicios, sin leer sus archivos de base de datos.

El diagrama reproducible se entrega en docs/arquitectura.svg y su fuente Graphviz en docs/arquitectura.dot. Los contenedores son regiones lógicas locales, no centros de datos geográficos.

## 4. Transacción distribuida T0

El cliente crea una llave y un cuerpo inmutable de reserva. El gateway resuelve identidad y remite la solicitud. Reservas comprueba la llave por usuario y valida duración, fecha, medio de pago y cotización. Guarda el estado pending antes de efectos externos.

Inventario verifica capacidad y retiene el cupo en una transacción BEGIN IMMEDIATE. Al serializar la lectura y escritura del cupo se elimina la ventana de carrera que existía cuando el mock separaba ambos pasos con await.

Pagos preautoriza y captura usando el ID de reserva como clave estable. Repetir cualquiera de esos pasos conserva un único efecto. Inventario confirma el hold y Reservas escribe el estado confirmado y el evento de salida en una sola transacción local.

La actualización de catálogo puede ocurrir entre la cotización y el pago. Ambos clientes envían expectedAmount; si difiere de la tarifa actual, el servidor devuelve PRICE_CHANGED antes de retener o cobrar. La reserva confirmada conserva el snapshot de tarifa utilizado.

## 5. Fallas y compensaciones

Un rechazo de pago termina en compensación y libera el cupo. Un timeout se considera resultado incierto: puede haberse producido la captura. El reintento reutiliza la misma llave y cuerpo; el coordinador consulta o repite pasos idempotentes.

Si la retención venció después de una captura, se devuelve el pago de prueba. Cancelación y salida se registran primero como estados recuperables; si Inventario no responde, el trabajador retoma la liberación posteriormente. El journal persiste tras reiniciar el proceso.

La outbox se guarda junto con el estado de la reserva. Un trabajador la publica al broker y la marca entregada tras el ACK. Si el ACK se pierde, el broker acepta de nuevo el mismo ID sin duplicar el evento. Las notificaciones son consultas dentro de la app para conductor y propietario, no push externo.

No existe una transacción ACID global ni una garantía de entrega exactamente una vez. Se combinan transacciones locales, estados de saga, compensaciones, reenvío y deduplicación. La versión admite un coordinador de reservas por región; no implementa elección de líder ni réplicas.

## 6. Localización

Las diferencias de región son datos: locale, idioma, moneda, decimales, zona IANA, medios de pago, tarifas iniciales, impuesto didáctico y comisión. La lógica de reserva no contiene condiciones por país. Las fechas se guardan en UTC y se muestran con Intl en la zona regional.

Los importes son enteros en unidad menor. COP y JPY usan cero decimales por convención del ejercicio; BRL, USD y EUR utilizan dos. La base y el impuesto incluido suman exactamente el total; la comisión del anfitrión se resta de su ingreso y no se añade al conductor.

El equivalente del caso obligatorio es reservar dos horas de estacionamiento el 15 de noviembre de 2026 a las 20:30 locales. Los totales seed por carro son COP 16.560, BRL 24,00, USD 36.00, EUR 26,40 y JPY 1.800. No son tarifas comerciales verificadas ni importes económicamente equivalentes. Las pruebas comprueban separadores, decimales, textos y la conversión UTC de cada zona.

## 7. Seguridad e interfaz

Las contraseñas usan PBKDF2-HMAC-SHA256 con sal; los tokens opacos se almacenan como hashes, vencen a las doce horas y se revocan con logout. El registro público no permite crear administradores ni operadores. El gateway ignora identidades enviadas por el cliente y verifica el token con Identidad.

Las altas fijan propietario y métricas en el servidor. Cada propietario modifica solo sus espacios. Se usan parámetros SQL, límite de JSON, CORS explícito y una política CSP. Los servicios internos escuchan en loopback con clave de servicio. La exposición pública comercial requeriría TLS, gestión de secretos y controles adicionales; no se afirma certificación de seguridad.

La consola usa navegación lateral en escritorio e inferior en móvil, estados con texto, tema claro/oscuro, controles HTML nativos, foco visible y movimiento reducido. La web conserva solicitudes inciertas al recargarse para evitar generar otra llave. Las listas se actualizan por consulta cuando la pantalla está visible e inactiva.

## 8. Evidencia y reproducibilidad

La suite de Python contiene 35 casos de lógica, persistencia y contrato HTTP sobre streams. Hay 18 pruebas de localización/almacenamiento, 7 del mock y 7 del transporte Expo: 67 casos en total. Las 99 aserciones adicionales de cliente/plantillas recorren código real de la consola con los handlers por streams, sin verificar CSS o gestos.

Las pruebas de red real se ejecutan con python3 -m unittest server.tests.http_smoke -v. Inician treinta procesos y verifican cinco flujos, concurrencia, muerte y restauración del proceso de Pagos y permisos. El verificador de Chrome genera treinta y cinco capturas a varios tamaños y temas.

El entorno de edición bloquea sockets, Chrome, el daemon Docker y DNS de npm/GitHub. Por ello no se presentan como aprobadas las pruebas de procesos, la inspección visual ni el bundle Expo. Los resultados concretos y omisiones están en artifacts/verification/report.json y docs/VERIFICACION.md. Es necesario ejecutar esas comprobaciones en una máquina que permita los recursos antes de afirmar una entrega desplegada y validada en dispositivos.

## 9. Ejecución

Desde tuespacio/: python3 -m server.run --regions all. Abrir http://127.0.0.1:8080. Las regiones siguientes usan 8090, 8100, 8110 y 8120. También se entrega compose.yaml.

Cuentas ficticias: conductor@demo.test, parqueadero@demo.test, anfitrion@demo.test y admin@demo.test; contraseña demo123. La interfaz permite usar la cuenta de prueba por perfil. Cada región conserva sus propias sesiones y reservas.

Para verificar y guardar logs: python3 scripts/verificar.py --integration --docker. Para capturas: añadir --browser. Para el cliente nativo se necesita Node >=22.13 y npm ci en app/; las pruebas de interfaz deben completarse con Expo Go compatible o un development build.

## 10. Límites y trabajo comercial futuro

La disponibilidad es del momento, no una agenda por intervalos; un cupo confirmado se mantiene hasta cancelación o salida. No hay GPS, cobros reales, factura fiscal, verificación documental, push externo, replicación ni conmutación automática geográfica. Los impuestos y comisión del 5 % son datos didácticos.

La entrega aporta la implementación del prototipo y pruebas diferenciadas por alcance. Un uso comercial requeriría resolver políticas de negocio, integrar proveedores, implementar reservas por franja, administrar identidad y secretos, añadir réplicas y medir carga. Esas capacidades no se presentan como existentes.

## Fuentes y uso de IA

Se utilizaron los documentos y código originales del equipo, el informe Hito 4 y la confirmación del caso de parqueaderos. Referencias técnicas: documentación oficial de SQLite (transacciones y WAL), Python (http.server y zoneinfo) y Expo SDK 58; enlaces en docs/ARQUITECTURA.md.

Se utilizó asistencia de IA para implementar, documentar y revisar. Cada integrante debe comprender y reproducir los flujos, las compensaciones y los límites antes de la sustentación.
