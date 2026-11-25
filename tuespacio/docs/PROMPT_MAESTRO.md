# Prompt de ejecución · Tu Espacio

Completar Tu Espacio como prototipo funcional para Sistemas Distribuidos. El negocio es reservar parqueaderos formales y espacios particulares, no domicilios. Conservar los perfiles conductor, operador y anfitrión, y añadir supervisión de la plataforma. El usuario delega las decisiones de implementación y diseño. La cuenta institucional para una futura subida es `santyshark1`.

## Resultado esperado

1. Una aplicación usable de principio a fin: búsqueda por destino, condiciones y disponibilidad, reserva con pago simulado, comprobante, llegada, salida y cancelación con devolución; operación de espacios y reservas; supervisión de servicios y transacciones.
2. Cinco regiones configurables (Colombia, Brasil, Estados Unidos, Francia y Japón), con moneda, idioma y zona horaria derivados de datos. Importes enteros en unidad menor y fechas UTC. El mismo flujo debe funcionar en cada región.
3. Servicios de identidad, inventario, reservas, pagos y mensajería en procesos independientes comunicados por HTTP/JSON. Persistencia separada por región y servicio. Mensajes con identificador, outbox persistente y entrega repetible.
4. La transacción T0 debe soportar concurrencia, idempotencia, rechazo de pago, caída de un proceso, recuperación y compensaciones. No vender el último cupo dos veces ni capturar dos pagos para una misma reserva.
5. Interfaz empresarial: navegación clara por rol, jerarquía tipográfica, estados vacíos y de error útiles, controles accesibles, diseño móvil y escritorio, tema claro/oscuro. No inventar clientes, métricas, certificaciones o integraciones reales.
6. Pruebas reproducibles y documentación de ejecución, arquitectura, fallas, localización y límites reales. No declarar como verificado lo que el entorno impida ejecutar.

## Restricciones y decisiones

- Conservar Expo SDK 58 y sus rutas; respetar `app/AGENTS.md`. Consultar documentación de la versión antes de cambiar APIs nativas.
- Añadir consola web sin dependencias externas para permitir demostración offline. Usar Python 3.11+ y SQLite estándar en los servicios: cada base pertenece a un solo proceso de servicio; ningún servicio abre la base de otro.
- Cinco contenedores regionales ejecutan servicios independientes por HTTP; el lanzador local también permite detener cada proceso por separado. No confundir esto con réplicas, consenso o despliegue geográfico real.
- Pagos, mapas y notificaciones externas son simulados; el transporte entre procesos y la persistencia son reales. Las tasas son datos didácticos, no reglas fiscales certificadas.
- Trabajar con datos ficticios. Documentar TLS/proxy, secretos y limitaciones antes de hablar de producción.
- La copia proviene de un ZIP y no contiene historial Git. No crear una historia incompatible ni sobrescribir el remoto para subirla.

## Secuencia de trabajo

- [x] Inspeccionar código, informe Hito 4, contrato API y requisitos.
- [x] Confirmar el negocio de parqueaderos con el usuario.
- [x] Implementar servicios, perfiles regionales y persistencia.
- [x] Probar reservas concurrentes, idempotencia, compensación y reinicio con SQLite y transporte de pruebas.
- [x] Construir la consola web con los cuatro roles y cinco regiones.
- [x] Corregir riesgos del mock y el cliente Expo; probar transporte y cotización.
- [x] Verificar plantillas y flujos del cliente: 99 aserciones sobre API por streams.
- [x] Entregar arquitectura, guion, contrato, informe PDF y registro reproducible de pruebas.
- [ ] Completar HTTP entre procesos, Chrome a varios tamaños y bundle Expo en un entorno con puertos y dependencias. Las herramientas están preparadas y CI las exige; no se marcan aprobadas aquí.
- [ ] Subir con `santyshark1` cuando exista conexión y checkout con historial.

## Prompt de apoyo para Claude

Revisa Tu Espacio en `tuespacio/`, empezando por `docs/PROMPT_MAESTRO.md` y `docs/ARQUITECTURA.md`. Busca fallos de concurrencia, autorización, recuperación de sagas, idempotencia y contraste/overflow en `server/` y `web/`. Ejecuta `python3 -m unittest discover -s server/tests -v`. Devuelve hallazgos con archivo, línea, reproducción e impacto; distingue problemas comprobados de hipótesis. No cambies el negocio a domicilios ni declares reales los pagos/mapas simulados. No publiques ni cambies credenciales. Para verificar Expo usa Node >=22.13, `npm ci`, `npm run lint`, `npm run typecheck` y `npm run check`. Coordina antes de editar archivos que otro agente esté modificando.
