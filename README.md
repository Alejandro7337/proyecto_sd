# Tu Espacio · Sistemas Distribuidos

Aplicación de reserva de parqueaderos y espacios particulares, con consola web, cliente móvil Expo y cinco regiones lógicas. Pagos, mapas y verificación de identidad son de demostración; los servicios, la persistencia y la comunicación HTTP están implementados.

```bash
cd tuespacio
python3 -m server.run --regions all
```

Abrir **http://127.0.0.1:8080** y usar «Entrar con cuenta de prueba». Python 3.11 o superior; la consola y el backend no requieren instalar paquetes.

- [Ejecución y cuentas](tuespacio/README.md)
- [Arquitectura y consistencia](tuespacio/docs/ARQUITECTURA.md)
- [Informe de implementación en PDF](tuespacio/docs/INFORME_IMPLEMENTACION.pdf)
- [Guion de sustentación](tuespacio/docs/DEMOSTRACION.md)
- [Contrato HTTP](tuespacio/docs/API.md)
- [Pruebas y límites de la evidencia](tuespacio/docs/VERIFICACION.md)
- [Especificación y decisiones](tuespacio/docs/PROMPT_MAESTRO.md)

Los documentos originales en `Informacion/` y `Entrega_Hito4/` describen antecedentes del proyecto. La documentación de la implementación actual está en `tuespacio/docs/`.
