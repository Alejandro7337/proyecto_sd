# Destinos, Mercado Pago y recibos

**Estado vigente:** el usuario autorizó corregir todos los hallazgos pendientes. Consulta [la revisión final](REVISION_FINAL.md) y [la preparación de producción](PRODUCCION.md) para resultados y requisitos de activación.

La consola ya permite escribir cualquier dirección o lugar. El servidor busca primero en el catálogo y después en Photon, guarda los resultados y calcula la distancia geográfica a los espacios con coordenadas. Sólo muestra espacios registrados a menos de 5 km; buscar una dirección no crea parqueaderos ni cupos ficticios. Los espacios del escenario académico siguen identificados como datos de demostración y tienen coordenadas aproximadas. Se migran los datos demo locales anteriores conservando sus ediciones.

La búsqueda se envía al pulsar Buscar, también en Expo. Photon público se usa exclusivamente durante desarrollo, con una solicitud por segundo por proceso regional y caché de 24 horas. Ese servidor no ofrece garantía de servicio: para producción se exige `GEOCODER_URL` propio o contratado, con capacidad suficiente para el tráfico de todas las regiones. Atribución OpenStreetMap visible. [Documentación y condiciones de Photon](https://github.com/komoot/photon).

## Conectar la cuenta Mercado Pago existente

1. Copiar `.env.example` a `.env` y editarlo localmente. No pegar secretos en conversaciones ni subir `.env` a Git.
2. Configurar `PAYMENT_PROVIDER=mercadopago`, el Access Token de pruebas `TEST-…`, `MP_COLLECTOR_ID` (identificador del vendedor), `MP_WEBHOOK_SECRET` de la aplicación y `APP_PUBLIC_URL` con el origen HTTPS público que sirve el gateway. El entorno académico local funciona sin cuenta con `PAYMENT_PROVIDER=demo`, claramente indicado.
3. En la aplicación existente de Mercado Pago configurar notificaciones de **Orders (`orders_v2`)**, con destino `https://TU-DOMINIO/api/payments/webhook`. El secreto debe corresponder a esa aplicación y entorno. La API recibe el tópico `order`.
4. Ejecutar `python3 -m server.run --regions co --env-file .env`. HTTPS y acceso público al webhook requieren un proxy o despliegue fuera de este sandbox. Mercado Pago no admite retornos a localhost; no se ha creado ningún túnel ni desplegado infraestructura.
5. Completar una compra con los datos de pruebas de Mercado Pago, comprobar la notificación, el recibo y la devolución. Se usa Checkout Pro mediante **Orders API**, sin SDK frontend ni almacenamiento de tarjetas.

La cuenta configurada se limita a Colombia y COP. Brasil, Estados Unidos, Francia y Japón mantienen sus escenarios académicos cuando se usa el proveedor demo. No se ofrecen cobros reales en regiones sin una cuenta y un proveedor compatible.

### Qué verifica el servidor

El total sale de la tarifa y duración guardadas por reservas. La orden se crea con una clave de idempotencia UUID estable y se conserva antes de contactar a la pasarela. El token nunca se devuelve al navegador. El usuario paga en `www.mercadopago.com.co`; el retorno sólo abre su reserva y no cambia el estado de pago.

Las notificaciones requieren HMAC-SHA256 válido, ID firmado, entorno correcto y orden registrada. El servidor consulta la orden con su token privado y coteja ID, referencia, comercio, moneda, importe y total efectivamente acreditado. El worker confirma el cupo sólo después de la aprobación verificada. Repetir una notificación no crea otra reserva o recibo. Si la retención venció, se solicita el reembolso y nunca se confirma ese cupo.

Una cancelación queda persistida antes de solicitar una anulación o reembolso, y se reintenta si falla el transporte. Sólo se muestra cancelada cuando la pasarela confirma la reversión. Los cambios de pago notificados después de confirmar también se reflejan en la reserva; un pago revertido impide el ingreso. Para una reserva ya activa se conserva el cupo hasta registrar la salida.

Fuentes de la integración: [crear orden](https://www.mercadopago.com.co/developers/en/docs/checkout-pro-orders/create-order), [notificaciones](https://www.mercadopago.com.co/developers/en/docs/checkout-pro-orders/notifications), [estados](https://www.mercadopago.com.co/developers/en/docs/checkout-pro-orders/payment-management/status/order-status), [reembolso](https://www.mercadopago.com.co/developers/es/reference/online-payments/checkout-pro/refund-order/post).

## Recibo

Al confirmar la reserva se guarda una copia inmutable: número, fecha, comercio, cliente, parqueadero, importes, moneda e identificador de la transacción. Sólo pueden consultarla el cliente, el administrador y el operador del espacio correspondiente. La descarga requiere el token de sesión, no utiliza credenciales en la URL y lleva `Cache-Control: no-store`. Conserva Unicode y escapa los datos al generar HTML.

La consola descarga un **HTML autónomo imprimible**, con estilos incluidos: abrir el archivo y elegir Imprimir → Guardar como PDF. No genera un PDF binario directamente. Expo permite consultar el recibo dentro de la reserva. El recibo indica demostración/pruebas cuando corresponde y no se presenta como factura electrónica fiscal. Las cancelaciones conservan el recibo original y muestran el estado actual de la reversión.

## Antes de activar cobros reales

Cambiar a `APP_ENV=production`, `MP_LIVE_MODE=true` y token `APP_USR-…` requiere datos reales en un directorio nuevo, nombre e identificación fiscal del comercio y geocodificador con servicio garantizado. Las cuentas y espacios demo se rechazan en producción. No se habilitan escenarios de pago simulado con Mercado Pago. Las nuevas publicaciones quedan pausadas y requieren revisión operativa.

**Esta entrega no es un lanzamiento de producción aprobado.** Faltan credenciales del comercio, dominio/HTTPS, prueba real con Mercado Pago, validación en navegador y dispositivo, alta/verificación operativa de espacios reales, política comercial y fiscal definitiva, copias de seguridad, recuperación y observabilidad. Los impuestos y comisiones regionales del escenario académico deben validarse para el comercio antes de publicar. No se ha ejecutado ningún cobro real ni subida a GitHub.

## Pruebas reproducibles

`python3 -m unittest discover -s server/tests -v` incluye fixtures de contrato del proveedor: no contactan al banco ni sustituyen una compra de pruebas real. Cubre espera de pago, firma falsa, entorno equivocado, comercio/importe/moneda/referencia ajenos, notificaciones repetidas, pago tardío, recibo autorizado, cancelación/reembolso e idempotencia. Las pruebas HTTP usan handlers reales con streams en memoria; este entorno no permite abrir sockets.
