# Tu Espacio

Reserva un parqueadero cerca de tu destino y administra disponibilidad, entradas, salidas e ingresos. El proyecto adapta el enunciado de Sistemas Distribuidos al negocio de parqueaderos, confirmado por el equipo.

## Ejecutar la aplicación

Requisito: **Python 3.11+** con SQLite y datos de zonas horarias IANA. No se requieren npm, claves de mapas ni cuenta de pagos para la consola web.

```bash
cd tuespacio
python3 -m server.run --regions all
```

| Región | Consola | Moneda | Zona horaria |
|---|---|---|---|
| Colombia · Bogotá | http://127.0.0.1:8080 | COP | America/Bogota |
| Brasil · São Paulo | http://127.0.0.1:8090 | BRL | America/Sao_Paulo |
| EE. UU. · New York | http://127.0.0.1:8100 | USD | America/New_York |
| Francia · Paris | http://127.0.0.1:8110 | EUR | Europe/Paris |
| Japón · 東京 | http://127.0.0.1:8120 | JPY | Asia/Tokyo |

El selector de región cambia de gateway; cada región tiene sus propias cuentas, sesiones y reservas, y solo muestra las regiones iniciadas. Para usar todos los idiomas, inicia todas las regiones con `python3 -m server.run --regions all`. Para ejecutar solo Colombia: `python3 -m server.run --regions co`. Para otros puertos: `--port 9080` (las siguientes regiones suman 10). `Ctrl+C` termina los procesos lanzados por este comando. Los datos permanecen en `.runtime/`.

## Cuentas de prueba

Contraseña para todas: **`demo123`**. También se puede usar el botón de cuenta de prueba eligiendo el perfil correspondiente.

| Perfil | Correo | Funciones |
|---|---|---|
| Conductor | conductor@demo.test | Buscar, filtrar, reservar, consultar comprobante, llegar, salir y cancelar |
| Operador | parqueadero@demo.test | Ver ocupación, entradas sin reserva, reservas recibidas y editar su parqueadero |
| Anfitrión | anfitrion@demo.test | Publicar, editar y pausar espacios particulares; gestionar reservas e ingresos |
| Administración | admin@demo.test | Estado de servicios, espacios regionales, reservas, trazas y perfiles regionales |

El registro permite cuentas nuevas de conductor y anfitrión. Operadores y administradores se provisionan como datos de prueba, no mediante registro público. La revisión de identidad es simulada: el anfitrión solicita la revisión, pero no se declara una verificación real ni se cargan documentos personales.

## Flujos implementados

- Búsqueda por zona/destino, carro o moto, techado, conservación de llaves, tipo de espacio y orden por precio o distancia. Mapa de referencia con tarifas y estados.
- Reserva de 15–480 minutos con importe calculado en el servidor, precio cotizado verificado, pago de prueba, código y comprobante descargable. La interfaz ofrece duraciones de 1, 2, 4 y 8 horas.
- Cancelación con reembolso de prueba, registro de llegada y salida; los cupos se liberan con la transición correspondiente.
- Idempotencia por cuenta y región, retención atómica del último cupo, journal de saga, compensaciones y recuperación tras perder respuestas o reiniciar el servicio.
- Outbox persistente y broker que deduplica mensajes. Notificaciones dentro de la app para conductor y propietario; no hay push externo.
- Consola por rol, tema claro/oscuro, formularios nativos accesibles, navegación móvil/escritorio y localización en cinco idiomas. Datos compartidos actualizados por consulta cada 15 segundos cuando la página está visible e inactiva; no se interrumpe un formulario o diálogo.

## Contenedores

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f co
```

Cinco contenedores, uno por región, cada uno con seis procesos independientes: identidad, inventario, pagos, reservas, broker y gateway. La comunicación entre servicios es HTTP por loopback dentro del contenedor regional. Cada región tiene red y volumen separados. Solo el gateway se publica en el host, ligado a `127.0.0.1`.

`docker compose down` conserva los volúmenes. Para consultar una región que no responde, revisar `docker compose logs <co|br|us|fr|jp>`. Las imágenes parten de Python 3.12; la construcción inicial requiere descargar esa imagen.

## Cliente Expo existente

El cliente móvil conserva los perfiles conductor, operador y anfitrión. La consola web es la superficie completa para cinco regiones y administración; la interfaz operativa móvil conserva los formatos colombianos.

```bash
cd app
# Usar Node >=22.13.0 (por ejemplo, nvm use 22).
npm ci
cp .env.example .env
npm start
```

El `.env.example` apunta a `http://localhost:8080/api` en modo HTTP. Para un teléfono físico, usar la IP LAN del computador en vez de `localhost` y levantar el backend con `--host 0.0.0.0`; ambos dispositivos deben estar en la misma red. El teléfono necesita Expo Go compatible con SDK 58 o un development build. Para usar el mock independiente del servidor: `EXPO_PUBLIC_API_MODE=mock`.

Se mantienen Expo Router, rutas existentes y compatibilidad del contrato de panel (`{space,plan,metrics}`) e ingresos (`{gross,pending,commissionRate,net,items}`). No se crearon directorios nativos a mano.

## Comprobaciones

```bash
# Desde tuespacio/:
python3 -m unittest discover -s server/tests -v
node server/tests/locale.test.mjs
node server/tests/views.test.mjs
npm run test:mock --prefix app
npm run test:transport --prefix app
docker compose config --quiet

# Pruebas con sockets y procesos reales:
python3 -m unittest server.tests.http_smoke -v

# Chrome real, flujo en cinco regiones y 35 capturas:
python3 -m server.tests.browser_check

# Con las dependencias Expo instaladas:
npm run lint --prefix app
npm run check --prefix app
```

La prueba opcional de Chrome usa `websocket-client`, disponible con `python3 -m pip install websocket-client` en un entorno virtual si no está instalado. Los archivos HTML de las pruebas de plantillas no son capturas de navegador. Consultar [VERIFICACION.md](docs/VERIFICACION.md) para distinguir lo ejecutado de lo pendiente por restricciones del entorno.

## Estructura

```text
app/                  Cliente Expo y backend mock de respaldo
web/                  Consola web, CSS, iconos y catálogos por idioma
server/               Servicios HTTP, perfiles y seed regional
server/tests/         Lógica, protocolo HTTP, UI, localización e integración real
docs/                 Arquitectura, contrato, guion y evidencia
scripts/              Preparación de entrega y subida con cuenta institucional
compose.yaml          Cinco regiones con redes y volúmenes independientes
.runtime/             Bases SQLite locales (excluidas del repositorio)
```

## Alcance de la entrega

El sistema es un prototipo académico ejecutable, no un servicio comercial desplegado. Los datos son ficticios. Las tarifas, impuestos incluidos y comisión del 5 % son ejemplos didácticos configurados en `server/regions.json`; no constituyen reglas fiscales certificadas ni una decisión comercial.

La disponibilidad representa cupos comprometidos en el momento, no una agenda de intervalos futuros: una reserva mantiene un cupo hasta cancelación o salida. No hay GPS, pasarela real, factura fiscal, push externo, verificación documental, replicación ni failover geográfico. SQLite usa un escritor por servicio y región; no se deben ejecutar dos coordinadores de reservas contra la misma base. TLS y exposición pública requieren un proxy y configuración de operación. Estos límites están separados de las pruebas de concurrencia, compensación e idempotencia implementadas.

### Destinos y pagos

Consulta [la configuración de Mercado Pago, búsqueda de direcciones y recibos](docs/PAGOS_Y_DESTINOS.md). La integración está implementada; su activación y validación externa siguen pendientes.
