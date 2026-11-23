// Reglas de negocio compartidas por la UI y el backend simulado.
// Lo marcado como [supuesto] no está definido en los documentos del proyecto.

export const VEHICLES = {
  // Íconos de MaterialCommunityIcons (Ionicons no tiene motocicleta).
  car: { label: 'Carro', icon: 'car-side' },
  moto: { label: 'Moto', icon: 'motorbike' },
};

export const RATE_UNITS = {
  minute: { label: 'por minuto', short: '/min' },
  hour: { label: 'por hora', short: '/h' },
};

export const SPACE_KINDS = {
  formal: { label: 'Parqueadero', icon: 'business-outline' },
  particular: { label: 'Espacio particular', icon: 'home-outline' },
};

export const HOST_SPACE_TYPES = ['Garaje', 'Lote', 'Antejardín'];

// Ejemplo citado en la presentación de la transacción distribuida ("p. ej. 10 min").
export const HOLD_MINUTES = 10;

// Precio de planes y % de comisión se definen en Fase 0: no se inventan.
export const PLANS = ['Básico', 'Destacado'];
export const COMMISSION_RATE = null;

// [supuesto] Opciones de llegada y duración para estimar el valor de la reserva.
export const ARRIVAL_OPTIONS = [15, 30, 60, 120];
export const DURATION_OPTIONS = [60, 120, 240, 480];

// [supuesto] Cobro por hora iniciada; por minuto, minuto exacto.
export function estimateCost(rate, durationMin) {
  if (!rate) return null;
  if (rate.unit === 'minute') return rate.price * durationMin;
  return rate.price * Math.ceil(durationMin / 60);
}

export function availabilityStatus(free, capacity, paused) {
  if (paused) return 'paused';
  if (!capacity) return 'unsupported';
  if (free <= 0) return 'full';
  if (free <= 3) return 'few';
  return 'available';
}

export const AVAILABILITY = {
  available: { label: 'Disponible', tone: 'success' },
  few: { label: 'Pocos cupos', tone: 'warning' },
  full: { label: 'Lleno', tone: 'danger' },
  unsupported: { label: 'No recibe este vehículo', tone: 'neutral' },
  paused: { label: 'No publicado', tone: 'neutral' },
};

export const RESERVATION_STATUS = {
  confirmed: { label: 'Confirmada', tone: 'info' },
  active: { label: 'En curso', tone: 'success' },
  completed: { label: 'Finalizada', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
};

export const ROLES = {
  driver: { label: 'Conductor', home: '/driver' },
  owner: { label: 'Dueño de parqueadero', home: '/owner' },
  host: { label: 'Anfitrión', home: '/host' },
};
