# Tu Espacio · Prototipo móvil interactivo

*Tu parqueadero, resuelto antes de salir.* Prototipo navegable para **Android** (y también iOS) que muestra cupo, tarifa y condiciones de parqueo antes de salir, y permite reservar. Todos los datos son **ficticios** y el backend está **simulado** dentro de la app.

## Tecnología

**React Native + Expo (SDK 58) en JavaScript, con Expo Router.** Una sola base de código para Android e iOS, se prueba en un teléfono con Expo Go sin compilar nada nativo y es fácil de aprender. No usa mapas, pagos ni servicios externos reales, así que no se necesitan llaves ni cuentas.

## Diseño

La interfaz fusiona el **mockup visual** (antes en `mockup-tu-espacio/`, Next.js + shadcn) con este prototipo funcional. Del mockup se tomó:

- **Identidad:** azul marino de marca `#0B2545`, acento celeste `#3FA2FF`, logo cuadrado con el símbolo de parqueo y el rótulo «TU ESPACIO» sobre cada título.
- **Componentes:** tarjetas blancas muy redondeadas (24 px) con borde fino, botones marinos de 16 px de radio, filtros en píldora, selector «Activas / Historial» en píldoras y barra inferior con el ítem activo en celeste.
- **Pantallas:** bienvenida e inicio de sesión sobre fondo marino con tarjeta blanca; «Encuentra tu cupo» con buscador en píldora, mapa con calles diagonales, pines de color y «Tu destino» al centro; tarjetas de resultado con miniatura, tarifa y cupos libres; detalle con cifras rápidas; confirmación de reserva; «¡Tu cupo está listo!» con el código en un ticket marino; reservas con franja de color por estado; perfil con tarjeta marina y accesos; y **Configuración**.
- **Configuración:** modo claro/oscuro, idioma (español, inglés, portugués, italiano, alemán, francés y japonés para navegación, perfil y ajustes), notificaciones, ayuda y cierre de sesión.

Se mantienen los criterios de accesibilidad del prototipo: el estado se muestra con punto y texto (no solo color), objetivos táctiles ≥ 44 px y contraste de texto ≥ 4.5:1. En modo oscuro la acción principal pasa al celeste para conservar el contraste.

Los tokens (paletas clara y oscura) están en `app/src/theme.js`; las preferencias de tema e idioma en `app/src/state/Preferences.js` y los textos traducidos en `app/src/i18n.js`.

## Ejecutar

Requisitos: [Node.js LTS](https://nodejs.org) (20.19 o superior) y, en el teléfono, la app **Expo Go** (Play Store / App Store).

```bash
cd app
npm install
npx expo start
```

- **Teléfono físico:** escanea el código QR con Expo Go (Android) o con la cámara (iOS). El teléfono y el computador deben estar en la misma red Wi‑Fi. Si no conecta, usa `npx expo start --tunnel`.
- **Emulador Android:** abre un dispositivo virtual en Android Studio y presiona `a` en la terminal de Expo.
- **Navegador (vista rápida):** `npx expo start --web`.
- **Verificar que compila:** `npm run check` (genera el bundle de Android en `dist/`).
- **Revisar el código:** `npm run lint`.

### Cuentas de prueba (contraseña `demo123`)

| Perfil | Correo |
|---|---|
| Conductor | `conductor@demo.test` |
| Dueño de parqueadero | `parqueadero@demo.test` |
| Anfitrión de garaje | `anfitrion@demo.test` |

También funciona la cuenta del mockup: `juan@tuespacio.co` / `TuEspacio2026!` (conductor).

En cada login está el botón **Usar cuenta de prueba**.

## Estructura

```
app/
  src/
    app/               Pantallas (Expo Router: cada archivo es una ruta)
      driver/          Conductor: Explorar · Mis reservas · Perfil
      owner/           Parqueadero: Resumen · Reservas · Mi parqueadero · Perfil
      host/            Anfitrión: Mis espacios · Reservas · Ingresos · Perfil
      space/[id]       Detalle del espacio
      reserve/[id]     Confirmar reserva y pago (transacción T0)
      reservation/[id] Reserva: código, llegada, salida, cancelación
      host-space/[id]  Publicar / editar espacio particular
      demo             Herramientas de demo (fallas y registro de T0)
      settings         Configuración: apariencia, idioma, preferencias y cuenta
    components/        UI reutilizable (botones, tarjetas, mapa ilustrativo, formularios)
    theme.js           Tokens visuales (paletas clara y oscura)
    i18n.js            Textos de la interfaz en 7 idiomas
    domain/rules.js    Reglas de negocio compartidas (estados, cálculo, supuestos)
    api/
      index.js         Cliente de la API: lo único que usan las pantallas
      transport.js     mock | http (EXPO_PUBLIC_API_MODE / EXPO_PUBLIC_API_URL)
      mock/            Backend simulado, dividido por servicios
        services/      auth · catalog · reservations · payments · panel
    state/             Sesión, preferencias (tema e idioma), invalidación de datos, consultas
docs/API.md            Contrato REST/JSON que debe cumplir el backend real
documentos/            Documentos fuente del proyecto
```

La app nunca accede a datos directamente: todo pasa por `api/index.js` → `transport.js`. Para conectar un backend real basta con definir `EXPO_PUBLIC_API_MODE=http` y `EXPO_PUBLIC_API_URL=https://…` y cumplir [docs/API.md](docs/API.md).

## Requisitos interpretados (de los documentos)

- **Conductor (gratis):** busca por destino (no por ubicación actual), compara parqueaderos cercanos con tarifa **por minuto u hora**, ve condiciones explícitas (**techado, entrega de llaves, altura, carro o moto**), reserva y llega directo.
- **Dueño de parqueadero formal:** paga mensualidad (planes **Básico** y **Destacado**), sin comisión por reserva. Panel sencillo para administrar **cupos, tarifas y horarios**, y para ver **cuántos conductores lo encontraron y cuántos reservaron**.
- **Anfitrión particular (función secundaria):** publica garaje, lote o antejardín con tarifa, horarios y tipo de vehículo. Tu Espacio cobra una **comisión pequeña solo si hay reserva**. Verificación de identidad, calificaciones y responsabilidad por daños son **obligatorias, por definir con el área legal**.
- **Mercado inicial:** una ciudad, 2–3 zonas densas (empresariales, clínicas, universidades), con carros y motos.
- **Transacción crítica T0 «Reservar cupo con pago»:** verificar → retener (con vencimiento, p. ej. 10 min) → preautorizar → registrar tarifa/comisión → capturar → confirmar, con compensación por paso, idempotencia y alternativas si el cupo ya fue tomado.

## Flujos que se pueden probar

1. **Conductor:** bienvenida → login (con validación) → “¿A dónde vas?” (búsqueda con estado vacío) → mapa y lista por destino → cambio carro/moto, filtros (techado, sin dejar llaves, parqueaderos/particulares) y orden por cercanía/precio → detalle con condiciones → confirmar → procesamiento → código de reserva → registrar llegada → registrar salida, o cancelar con confirmación.
2. **Errores de la reserva** (selector “Solo prototipo” en la pantalla de confirmar, o en Herramientas de demo): cupo tomado con alternativas cercanas, pago rechazado, pasarela sin respuesta con reintentos. En ningún caso se cobra.
3. **Sin conexión:** Perfil → “Simular sin conexión”: banner, pantallas de error y reintento.
4. **Dueño:** ocupación en vivo por vehículo, registrar entradas/salidas sin reserva, métricas de visitas y reservas, reservas recibidas (próximas / en curso / historial) con llegada y salida, edición de cupos, tarifas, horario, condiciones y publicación con validación. Los cambios se ven al instante en el mapa del conductor.
5. **Anfitrión:** ver, pausar y editar espacios, publicar uno nuevo (con validación y verificación de identidad simulada), reservas recibidas e ingresos.
6. **Configuración** (Perfil → Configuración, o «Apariencia e idioma» en la bienvenida): modo oscuro, idioma de la interfaz y notificaciones.
7. **Herramientas de demo:** red lenta, sin conexión, forzar el resultado de la próxima reserva, **registro paso a paso de cada T0** (T11…T13 y compensaciones) y restablecer datos.

## Supuestos (no documentados, marcados en la app)

- Cobro **por hora iniciada** cuando la tarifa es por hora; por minuto exacto cuando es por minuto.
- Opciones de llegada (15 min – 2 h) y de duración (1 – 8 h).
- El pago de la tarifa se captura al reservar, también en parqueaderos formales (la T0 es genérica).
- Medio de pago único “de prueba”; los medios reales para Colombia no están definidos.
- Cancelación libre con reembolso total antes de la llegada; no hay política documentada.
- Código de reserva para identificarse en la entrada.
- La disponibilidad es la de **ahora**, no por franja horaria.
- El alta de parqueaderos formales la hace el equipo comercial; solo conductores y anfitriones se registran solos.
- El panel del dueño y del anfitrión se muestra en la app móvil (el documento de arquitectura sugiere un panel web).
- Umbral de “pocos cupos”: 3 o menos.

## Preguntas pendientes

1. ¿El conductor paga la tarifa del **parqueadero formal** dentro de la app, o solo reserva y paga en sitio? El pitch dice que el conductor “no paga” y, a la vez, habla de “pago dentro de la app” y de la T0 con cobro.
2. Precio de los planes, beneficios del plan Destacado y porcentaje de comisión (Fase 0).
3. Medios de pago y pasarela para Colombia.
4. Política de cancelación, reembolso, tolerancia de llegada y qué pasa si el conductor excede el tiempo.
5. ¿Cómo se valida la reserva en la entrada (código, placa, QR)?
6. Reglas de verificación de identidad, calificaciones y daños (área legal).
7. ¿El panel del parqueadero será web, móvil o ambos?
8. ¿Habrá un rol de administrador de la plataforma? (No está descrito.)

## Limitaciones del prototipo

- Backend en memoria: los datos se reinician al recargar la app y no se comparten entre dispositivos.
- El idioma elegido traduce navegación, perfil y configuración; el contenido operativo sigue en español. Tema e idioma persisten solo en web (localStorage); en el teléfono duran mientras la app está abierta.
- Mapa **ilustrativo** (sin proveedor de mapas, GPS ni geocodificación).
- Sin pagos, notificaciones push, cámaras, sensores ni barreras reales.
- Autenticación simulada (sin contraseñas cifradas ni tokens reales).
- La concurrencia entre conductores se simula con un botón; no hay dos clientes reales compitiendo.

## Siguientes pasos hacia la app real

1. Resolver las preguntas pendientes con datos de la Fase 0 y validar el prototipo con conductores, parqueaderos y anfitriones.
2. Construir el backend según [docs/API.md](docs/API.md): base de datos transaccional con actualización condicional por cupo y horario, registro persistente de T0 y llaves de idempotencia.
3. Integrar la pasarela de pagos con preautorización/captura, un SDK de mapas y notificaciones push.
4. Autenticación real (OAuth/JWT), verificación de identidad y almacenamiento seguro del token.
5. Disponibilidad por franja horaria, actualización en tiempo real (WebSocket o push) y pruebas de concurrencia.
6. Compilaciones con EAS Build y publicación en Play Store / App Store.
