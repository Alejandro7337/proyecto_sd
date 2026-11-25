# Verificación de la implementación

Fecha de revisión: 24 de noviembre de 2026. Los resultados de una ejecución concreta quedan en `tuespacio/artifacts/verification/report.json`, con comandos, códigos de salida, duración y logs. Los artefactos de ejecución se excluyen del repositorio.

## Comprobaciones disponibles

| Comando desde `tuespacio/` | Cobertura | Qué no prueba |
|---|---|---|
| `python3 -m unittest discover -s server/tests -v` | 35 casos: concurrencia, saga, journal, SQLite, permisos, serialización y handlers HTTP reales sobre streams | Sockets y distribución entre procesos |
| `node server/tests/locale.test.mjs` | 18 casos: cinco monedas/zonas/idiomas, enteros, catálogos, errores y almacenamiento bloqueado | Traducción humana ni presentación de fuentes en dispositivo |
| `npm run test:mock --prefix app` | 7 casos del mock: último cupo, duplicados, cotización, fechas y retenciones separadas | Backend real ni interfaz nativa |
| `npm run test:transport --prefix app` | 7 casos del cliente HTTP Expo: token, URL, errores, timeout de cuerpo, offline y logout | Empaquetado Android/iOS |
| `node server/tests/views.test.mjs` | 99 aserciones: código real del cliente con API por streams, plantillas de cuatro roles y flujo en cinco regiones | CSS, gestos, foco visual ni navegador real |
| `python3 -m unittest server.tests.http_smoke -v` | Red real, 30 procesos, cinco regiones, concurrencia y muerte/restauración de Pagos | Despliegue geográfico o carga sostenida |
| `python3 -m server.tests.browser_check` | Chrome real, flujo y 35 capturas a múltiples tamaños/temas | Aprobación visual automática ni uso en teléfono físico |
| `docker compose config --quiet` | Sintaxis y composición del despliegue | Que los contenedores hayan arrancado |
| `npm run lint --prefix app` | Reglas ESLint del proyecto con dependencias locales | Build nativo |
| `npm run check --prefix app` | Bundle Android mediante Expo SDK 58 | Instalación y rendimiento en hardware |

La suma de los primeros cuatro grupos es **67 casos de prueba**; las 99 aserciones de plantillas se informan aparte. No se suman sockets omitidos como pruebas aprobadas.

## Ejecutar y guardar evidencia

```bash
python3 scripts/verificar.py --integration --docker
```

Para incluir Chrome: añadir `--browser`. Para incluir lint/exportación móvil después de `npm ci` con Node >=22.13: añadir `--expo`.

El reporte distingue `passed`, `failed`, `blocked` y `skipped`. `completed` solo es verdadero cuando todos los grupos solicitados pasaron. Un comando omitido por no haberse solicitado no queda validado implícitamente.

## Restricciones observadas en el entorno de edición

- La apertura de sockets locales devuelve `Operation not permitted`. La suite de procesos debe omitirse explícitamente aquí.
- Chrome termina al intentar crear sockets internos. No se han obtenido ni aprobado capturas reales desde este sandbox.
- Docker Compose puede validarse, pero no se puede acceder al daemon Docker del usuario.
- No hay `node_modules` del cliente Expo, y npm/GitHub no se resuelven por DNS. El Node del entorno es 20.20.2; las dependencias declaran mínimo 22.13.0. ESLint global 6 no sirve para el flat config ESLint 9 del proyecto.
- Se intentaron lint, typecheck (`npx --offline tsc --noEmit`) y exportación Android; no pudieron verificarse por dependencias ausentes. El proyecto móvil original usa JavaScript y no trae configuración TypeScript ni dependencia `typescript`; no se declara un chequeo de tipos aprobado.

Estas restricciones no convierten los handlers en un despliegue de red probado. Las pruebas por streams conservan el formato HTTP y las reglas reales del servicio; la suite externa es la evidencia necesaria para afirmar que los procesos se comunican correctamente en ejecución.

## Revisión manual pendiente en un entorno con navegador

Abrir las 35 capturas, revisar las pantallas a 320/390/768/1440 px y en tema oscuro, y recorrer el flujo usando teclado. Verificar nombres largos, errores de formulario, selección/foco, cancelación, retención de una reserva incierta y recuperación al recargar. Ejecutar Expo en emulador o teléfono si se va a sustentar el cliente nativo.

Los catálogos japonés, francés y portugués requieren revisión lingüística del equipo antes de una publicación comercial. Los importes e impuestos son datos de clase, no una validación fiscal.

## Integración continua preparada

`.github/workflows/verify.yml` ejecuta servicios/contratos con procesos reales, lint/exportación Expo y Chrome en jobs separados al hacer push o abrir un PR. Usa Python 3.12, Node 22 y sube logs/capturas como artefactos. El job de servicios exige que los grupos solicitados hayan pasado: una omisión no basta para aprobarlo. El workflow está preparado y su YAML fue validado localmente; no se afirma que se haya ejecutado en GitHub antes de subir la rama.
