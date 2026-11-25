# Correcciones finales · ronda 2

El usuario revocó la exclusión previa y autorizó corregir lo necesario y subirlo. Se conserva la procedencia de los hallazgos del ledger; no se atribuye consenso inicial a los señalados por un solo juez. Esta es la segunda y última ronda, sin reiniciar el presupuesto de Judgment Day.

El agente implementó las correcciones y regresiones, pero agotó su cuota antes de entregar el informe. El coordinador inspeccionó los archivos guardados, completó la protección de lectura privada para el propietario, ejecutó los tests y preparó este registro.

- **S-01:** Gateway rechaza segmentos internos, variantes codificadas y recorridos de ruta antes de prestar credenciales internas. Regresión HTTP intenta liberar una reserva con siete variantes y confirma que el slot sigue comprometido.
- **S-02:** consulta autenticada de una reserva pendiente fuerza reconciliación con Mercado Pago; el worker limita sus consultas a 30 segundos y fuerza una antes de vencer. Conserva el cotejo de importe/comercio/moneda y la devolución si el hold realmente venció. Dos regresiones cubren pérdida del webhook, consulta explícita, límite de sondeo y vencimiento.
- **S-03:** Photon recibe Accept-Language con fallback, sin parámetro lang que pueda rechazar idiomas no importados. La prueba inspecciona la solicitud real del adaptador con respuesta fixture; el endpoint externo no se contactó.
- **S-04:** formulario nativo extrae conversión común, siempre envía estado y valida coordenadas completas. Los nuevos espacios sin zona heredada usan custom. Dos regresiones del mock verifican el contrato y entradas incompletas/fuera de rango.
- **S-05:** acceso, navegación y pie usan el modo real; producción avisa de cobros reales. Consentimiento y anfitrión ya no afirman verificación simulada. Se añadieron seis aserciones a plantillas.
- **I-01:** espacios de producción pendientes no pueden publicarse ni aparecer en catálogo. Su propietario autenticado conserva acceso al detalle privado. Pruebas de inventario y HTTP verifican ambas condiciones.
- **I-02:** servidor publica el mínimo de contraseña y el formulario y error usan 12 en producción.
- **I-03:** migración repetible añade provider_id e índice único, rellena registros previos y consulta el webhook por índice. Prueba usa un esquema anterior y EXPLAIN QUERY PLAN.

## Preparación operativa añadida por el coordinador

OPS-01 añade CLI local de alta administrativa y aprobación auditada de espacios reales; contraseña fuera de argumentos, PBKDF2, rechazo de sobrescritura/demos/coordenadas inválidas. OPS-02 añade Compose de Colombia con volumen separado y Caddy HTTPS, sin puertos de servicios internos publicados; el supervisor detiene todos los hijos si falla uno en producción. OPS-03 excluye .env privados de Git, Docker, parche y respaldo, conservando .env.example. Documentación: docs/PRODUCCION.md. Tres pruebas de administración/supervisión pasan y Compose de producción valida su configuración.

## Evidencia

Antes de la última corrección del acceso privado: 59 pruebas Python, 12 del mock y 105 aserciones de plantillas aprobadas. La regresión HTTP adicional de lectura del propietario pasa por separado. El reporte automatizado final consolidará la ejecución completa. Sintaxis válida de 55 archivos Expo; py_compile válido. Lint encuentra ESLint global 6.4 sin dependencias Expo; TypeScript offline responde ENOTCACHED. No se instaló software ni se presentaron esas comprobaciones como aprobadas.

No se ejecutó Chrome, HTTP entre procesos, compilación nativa, compra bancaria ni emisión real de certificados. Credenciales del comercio, DNS/HTTPS y validación externa son requisitos de activación, no verificaciones realizadas.

Reversión: cada ID corresponde al delta de sus funciones y pruebas. Revertir la migración no exige borrar registros: la columna adicional es compatible con el formato JSON anterior. Revertir acceso privado debe conservar el bloqueo de rutas internas. Los archivos de infraestructura y CLI son unidades separadas; no se modificaron datos productivos ni se desplegó nada.

Skill Resolution: paths-injected — /home/david/.claude/skills/judgment-day/SKILL.md; /home/david/.claude/skills/impeccable/SKILL.md; /home/david/.codex/skills/.system/review-agent/SKILL.md; /home/david/Escritorio/SD/proyecto_sd-main/.claude/skills/ui-ux-pro-max/SKILL.md.
