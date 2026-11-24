// Las reglas de horario dependen de la hora local: las pruebas corren en la zona del mercado inicial.
module.exports = async () => {
  process.env.TZ = 'America/Bogota';
};
