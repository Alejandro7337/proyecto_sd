// Controles de demostración: permiten forzar fallas para probar los estados de error.
// Solo existen en el backend simulado; un backend real no expone nada parecido.
export const faults = {
  offline: false,
  // 'none' | 'taken' | 'declined' | 'timeout' — se consume en la siguiente reserva.
  nextReservation: 'none',
  latencyMs: 650,
  // Multiplicador de los retardos simulados de la T0 y la pasarela (0 en pruebas automáticas).
  timeScale: 1,
};

export function setFault(key, value) {
  faults[key] = value;
}
