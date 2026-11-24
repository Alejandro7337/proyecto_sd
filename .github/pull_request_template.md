## Qué cambia y por qué

<!-- Una o dos frases. Enlaza el issue: "Cierra #123". -->

## Tipo de cambio

- [ ] Corrección de error
- [ ] Funcionalidad nueva
- [ ] Cambio de contrato de API (actualicé `tuespacio/docs/API.md`)
- [ ] Migración de base de datos (nueva, nunca edité una ya aplicada)
- [ ] Documentación / CI

## Cómo lo probé

<!-- Comandos ejecutados y resultado. Para UI: plataforma (Android, iOS, web) y capturas. -->

- [ ] `npm run lint` y `npm test` en `tuespacio/app`
- [ ] `npm test` en `tuespacio/server` (si toqué el servidor)
- [ ] Probé el flujo afectado a mano en: <!-- Android / iOS / web -->

## Riesgos

- [ ] Toca la T0 (reservas, retención, pagos, compensaciones): describí el escenario de falla probado
- [ ] Toca autenticación o permisos entre roles
- [ ] Agrega variables de entorno (actualicé `.env.example` y `docs/ENVIRONMENT.md`)
- [ ] No incluye secretos, certificados, llaves ni datos personales reales

## Pendiente de decisión de negocio o legal

<!-- Si el cambio asume una regla no definida, márcala como [supuesto] y enlázala en docs/PENDING_BUSINESS_DECISIONS.md -->
