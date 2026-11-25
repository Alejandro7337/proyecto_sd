# Pendientes para activar producción

Estos pendientes no impiden entregar el código y revisar el PR. La aplicación tiene 101 pruebas aprobadas y 105 comprobaciones de plantillas; esa evidencia no sustituye validar servicios externos o el despliegue real.

- [ ] Configurar las credenciales de la cuenta Mercado Pago existente y el secreto del webhook en el servidor, fuera de Git.
- [ ] Configurar dominio, DNS, HTTPS y URL pública de retorno/notificaciones.
- [ ] Configurar un geocodificador propio o con garantía de servicio para producción.
- [ ] Validar con Mercado Pago compra, rechazo, notificación, vencimiento y devolución.
- [ ] Ejecutar pruebas HTTP entre procesos, Chrome y compilación/lint de Expo con sus dependencias y Node >=22.13.
- [ ] Dar de alta el administrador y aprobar espacios reales con coordenadas; confirmar tarifas, impuestos y política comercial del comercio.
- [ ] Probar respaldo y restauración del volumen de producción.

Configuración y comandos: [PRODUCCION.md](PRODUCCION.md). Resultados y límites: [REVISION_FINAL.md](REVISION_FINAL.md). No guardar tokens, contraseñas o datos bancarios en este documento ni en el commit.
