# Estado de la implementación y entrega

La revisión vigente está en [REVISION_FINAL.md](REVISION_FINAL.md). El usuario autorizó corregir todos los hallazgos y subir los cambios. Se han preparado la integración de Mercado Pago, búsqueda por direcciones, recibos y herramientas de administración y despliegue. La activación comercial y las pruebas externas siguen pendientes.

La evidencia actual está en `artifacts/verification/report.json`; no sustituye navegador, dispositivo o transacciones bancarias. La configuración del comercio y dominio está documentada en [PRODUCCION.md](PRODUCCION.md). No se almacenan secretos en el repositorio.

La cuenta de subida indicada es `santyshark1`. El sandbox no resuelve GitHub y por ello no puede verificar la identidad remota; el resultado del intento de entrega se conserva en la revisión final. No se presenta un enlace de rama o PR sin confirmación del remoto.

Para regenerar parche y respaldo: `python3 tuespacio/scripts/preparar-entrega.py` desde la raíz. Se conserva el ZIP original como referencia; no se inventa historial Git.

## Subir desde la terminal local

```bash
bash /home/david/Escritorio/SD/proyecto_sd-main/tuespacio/scripts/subir-avance.sh
```

El script activa y verifica `santyshark1`, clona el repositorio con su historial en `SD/proyecto_sd-git`, comprueba y aplica el parche, crea un commit y sube una rama `avance/tu-espacio-FECHA-HORA`. No usa force push ni modifica `main`. Si el remoto cambió de forma incompatible, `git apply --check` se detiene antes de modificar archivos.

Si la cuenta necesita autenticación, ejecutar primero `gh auth login --hostname github.com` y seleccionar la cuenta institucional. No compartir tokens en el chat.

Después del push, el script crea un PR en borrador contra la rama principal, con el alcance y las comprobaciones pendientes. Si la rama ya se subió antes de esta actualización, ejecutar `bash tuespacio/scripts/crear-pr.sh` desde la copia original para crear el PR; si ya existe, muestra su enlace.

## Ejecutar el avance

```bash
cd /home/david/Escritorio/SD/proyecto_sd-main/tuespacio
python3 -m server.run --regions all
```

Abrir `http://127.0.0.1:8080`. Cuentas de prueba: `conductor@demo.test`, `parqueadero@demo.test`, `anfitrion@demo.test`, `admin@demo.test`; contraseña `demo123`. Cada región mantiene cuentas y reservas independientes. Colombia usa 8080, Brasil 8090, EE. UU. 8100, Francia 8110 y Japón 8120.
