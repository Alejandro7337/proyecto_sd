# Preparación de producción

Esta configuración prepara una instancia de Colombia con Mercado Pago. El modo académico de cinco regiones se mantiene separado. La activación comercial requiere un comercio habilitado, credenciales propias, dominio HTTPS y una prueba real de compra y devolución. No se ha desplegado ni se han ejecutado cobros reales desde este entorno.

## Configurar el servidor

Copiar `.env.example` a `.env` y completar localmente: `PUBLIC_HOST`, `APP_PUBLIC_URL` con ese mismo dominio HTTPS, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_COLLECTOR_ID`, nombre e identificación fiscal del comercio y `GEOCODER_URL`. El token de producción empieza por `APP_USR-`; nunca se envía al frontend. El geocodificador de producción debe ser propio o tener servicio contratado; no se acepta el servidor público de demostración. No subir `.env` a Git.

Apuntar DNS al servidor y habilitar puertos 80 y 443 para el proxy. Ejecutar desde `tuespacio/`:

```bash
docker compose -f compose.production.yaml up -d --build
```

El proxy Caddy gestiona HTTPS y expone únicamente la entrada pública; los servicios internos no tienen puertos publicados. El volumen `production-data` es distinto de los volúmenes académicos. La configuración fuerza producción, Mercado Pago y cobros live; el backend rechaza credenciales incompletas, datos demo y configuración incompatible. Si un proceso del backend termina en producción, se detiene la instancia completa para que Docker la reinicie. [Referencia del proxy HTTPS](https://caddyserver.com/docs/quick-starts/reverse-proxy).

## Alta administrativa y aprobación de espacios

Con acceso de operador al servidor:

```bash
docker compose -f compose.production.yaml exec app python -m server.admin --data /data --region co create-admin --email ADMIN@TU-DOMINIO --name 'Administración'
```

La contraseña se solicita sin mostrarla ni pasarla como argumento. Mínimo 12 caracteres; se almacena mediante PBKDF2 y nunca se sobrescribe una cuenta existente. El acceso público no permite crear administradores.

Los anfitriones registran espacios con dirección, coordenadas y consentimiento. Quedan pendientes de revisión y no admiten reservas hasta aprobarlos. Después de verificar identidad, derecho de uso, dirección, condiciones y tarifas del espacio, el operador puede aprobar el ID real:

```bash
docker compose -f compose.production.yaml exec app python -m server.admin --data /data --region co approve-space --id ID_DEL_ESPACIO
```

Se rechazan espacios demo o sin coordenadas válidas y se registra la aprobación en el almacenamiento de auditoría local.

## Validación de salida

Configurar en Mercado Pago el webhook HTTPS `/api/payments/webhook` de Orders, con el secreto correspondiente al entorno. Comprobar compra aprobada, rechazo, retorno sin webhook, notificación duplicada, vencimiento del cupo y devolución. El usuario nunca debe confirmar pago mediante parámetros de retorno. El recibo descargable es HTML imprimible; guardar como PDF se hace desde el navegador. No es factura electrónica fiscal.

Ejecutar las verificaciones en un equipo con Node >=22.13, dependencias Expo, Chrome y permisos de red: `python3 scripts/verificar.py --integration --browser --docker --expo`. Este sandbox sólo puede ejecutar los grupos sin sockets; su resultado no reemplaza la validación del despliegue.

Antes de abrir al público, verificar tarifas/impuestos y política de cancelación del comercio, definir respaldo del volumen y probar su restauración. Para una copia consistente entre los seis servicios, detener `app`, respaldar `production-data` mediante el mecanismo del servidor y volver a iniciarlo. Conservar permisos y cifrado del respaldo; restaurar primero en un volumen separado y comprobar recuperación de reservas pendientes.

La descripción de PR, pruebas y resultado de la revisión están en `PR_AVANCE.md`, `artifacts/verification/report.json` y `docs/judgment-day/`. Una revisión de código no certifica el funcionamiento de servicios externos ni sustituye una compra de validación.
