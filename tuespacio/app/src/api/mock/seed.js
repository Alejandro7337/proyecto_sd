// Datos FICTICIOS de demostración. Nombres, direcciones, cupos y tarifas son inventados
// para recorrer los flujos; no representan parqueaderos ni personas reales.
import { estimateCost } from '../../domain/rules';

const MIN = 60 * 1000;
const at = (offsetMin) => new Date(Date.now() + offsetMin * MIN).toISOString();

const minute = (price) => ({ unit: 'minute', price });
const hour = (price) => ({ unit: 'hour', price });

export function createSeed() {
  const users = [
    { id: 'u-driver', role: 'driver', name: 'Laura Gómez', email: 'conductor@demo.test', password: 'demo123', vehicle: 'car' },
    // Cuenta demo del mockup de diseño. Dominio reservado .test: nunca coincide con un correo real.
    { id: 'u-juan', role: 'driver', name: 'Juan Manuel', email: 'juan@demo.test', password: 'TuEspacio2026!', vehicle: 'car' },
    { id: 'u-owner', role: 'owner', name: 'Carlos Pérez', email: 'parqueadero@demo.test', password: 'demo123', plan: 'Destacado' },
    { id: 'u-host', role: 'host', name: 'Marta Rincón', email: 'anfitrion@demo.test', password: 'demo123', identity: 'pending' },
    { id: 'u-host2', role: 'host', name: 'Jorge Medina', email: 'jorge@demo.test', password: 'demo123', identity: 'pending' },
    { id: 'u-host3', role: 'host', name: 'Andrés Pardo', email: 'andres@demo.test', password: 'demo123', identity: 'pending' },
  ];

  const destinations = [
    { id: 'd-emp', name: 'Zona Empresarial · Calle 72', hint: 'Centros empresariales y oficinas' },
    { id: 'd-uni', name: 'Zona Universitaria · Centro', hint: 'Universidades y sedes académicas' },
    { id: 'd-cli', name: 'Zona de Clínicas · Norte', hint: 'Clínicas y consultorios médicos' },
  ];

  const base = { status: 'published' };

  const spaces = [
    // Zona Empresarial
    {
      ...base, id: 's-emp-1', destinationId: 'd-emp', kind: 'formal', ownerId: 'u-owner', plan: 'Destacado',
      name: 'Parqueadero Torre 72', address: 'Cra. 9 #72-15 (ficticia)', pos: { x: 0.25, y: -0.2 }, distanceM: 190,
      rates: { car: minute(138), moto: minute(95) }, capacity: { car: 40, moto: 12 }, occupied: { car: 30, moto: 7 },
      schedule: { open: '06:00', close: '22:00', days: 'Lun – Sáb' },
      conditions: { covered: true, keys: false, maxHeight: 2.1 },
      metrics: { views: [48, 55, 61, 52, 70, 66, 23], reservations: [5, 6, 8, 4, 9, 7, 0] },
    },
    {
      ...base, id: 's-emp-2', destinationId: 'd-emp', kind: 'formal', ownerId: 'u-x1', plan: 'Básico',
      name: 'Parqueadero La Esquina 70', address: 'Cl. 70 #10-08 (ficticia)', pos: { x: -0.55, y: 0.35 }, distanceM: 420,
      rates: { car: hour(7500), moto: hour(3500) }, capacity: { car: 25, moto: 20 }, occupied: { car: 25, moto: 11 },
      schedule: { open: '00:00', close: '23:59', days: 'Todos los días' },
      conditions: { covered: false, keys: true, maxHeight: null },
    },
    {
      ...base, id: 's-emp-3', destinationId: 'd-emp', kind: 'formal', ownerId: 'u-x2', plan: 'Básico',
      name: 'Edificio Ágora · Sótano', address: 'Cl. 73 #8-40 (ficticia)', pos: { x: 0.6, y: 0.45 }, distanceM: 510,
      rates: { car: minute(150), moto: null }, capacity: { car: 60, moto: 0 }, occupied: { car: 41, moto: 0 },
      schedule: { open: '05:30', close: '23:00', days: 'Todos los días' },
      conditions: { covered: true, keys: false, maxHeight: 1.9 },
    },
    {
      ...base, id: 's-emp-4', destinationId: 'd-emp', kind: 'particular', hostId: 'u-host', hostType: 'Garaje',
      name: 'Garaje cubierto Cra. 11', address: 'Cra. 11 #71-20 (ficticia)', pos: { x: -0.3, y: -0.5 }, distanceM: 350,
      rates: { car: hour(5000), moto: null }, capacity: { car: 1, moto: 0 }, occupied: { car: 0, moto: 0 },
      schedule: { open: '07:00', close: '19:00', days: 'Lun – Vie' },
      conditions: { covered: true, keys: false, maxHeight: 2.0 },
    },
    {
      ...base, id: 's-emp-5', destinationId: 'd-emp', kind: 'particular', hostId: 'u-host2', hostType: 'Antejardín',
      name: 'Antejardín para motos', address: 'Cl. 74 #12-31 (ficticia)', pos: { x: -0.7, y: -0.1 }, distanceM: 460,
      rates: { car: null, moto: hour(2000) }, capacity: { car: 0, moto: 3 }, occupied: { car: 0, moto: 1 },
      schedule: { open: '06:00', close: '20:00', days: 'Lun – Sáb' },
      conditions: { covered: false, keys: false, maxHeight: null },
    },
    // Zona Universitaria
    {
      ...base, id: 's-uni-1', destinationId: 'd-uni', kind: 'formal', ownerId: 'u-x3', plan: 'Básico',
      name: 'Parqueadero Plaza Universitaria', address: 'Cl. 21 #5-12 (ficticia)', pos: { x: 0.2, y: 0.3 }, distanceM: 240,
      rates: { car: minute(120), moto: minute(80) }, capacity: { car: 80, moto: 40 }, occupied: { car: 62, moto: 37 },
      schedule: { open: '06:00', close: '21:00', days: 'Lun – Sáb' },
      conditions: { covered: false, keys: false, maxHeight: null },
    },
    {
      ...base, id: 's-uni-2', destinationId: 'd-uni', kind: 'formal', ownerId: 'u-x4', plan: 'Destacado',
      name: 'Parking Centro Histórico', address: 'Cra. 4 #18-50 (ficticia)', pos: { x: -0.45, y: -0.35 }, distanceM: 380,
      rates: { car: hour(6800), moto: hour(3000) }, capacity: { car: 30, moto: 10 }, occupied: { car: 18, moto: 10 },
      schedule: { open: '06:30', close: '20:00', days: 'Lun – Vie' },
      conditions: { covered: true, keys: true, maxHeight: 2.0 },
    },
    {
      ...base, id: 's-uni-3', destinationId: 'd-uni', kind: 'particular', hostId: 'u-host', hostType: 'Lote',
      name: 'Lote esquina Calle 20', address: 'Cl. 20 #3-15 (ficticia)', pos: { x: 0.65, y: -0.4 }, distanceM: 470,
      rates: { car: hour(4500), moto: hour(2000) }, capacity: { car: 4, moto: 4 }, occupied: { car: 1, moto: 0 },
      schedule: { open: '06:00', close: '19:00', days: 'Lun – Sáb' },
      conditions: { covered: false, keys: false, maxHeight: null },
    },
    {
      ...base, id: 's-uni-4', destinationId: 'd-uni', kind: 'formal', ownerId: 'u-x5', plan: 'Básico',
      name: 'Parqueadero El Rosario', address: 'Cl. 23 #6-30 (ficticia)', pos: { x: -0.2, y: 0.6 }, distanceM: 410,
      rates: { car: minute(130), moto: minute(85) }, capacity: { car: 45, moto: 15 }, occupied: { car: 44, moto: 3 },
      schedule: { open: '06:00', close: '22:00', days: 'Lun – Sáb' },
      conditions: { covered: true, keys: false, maxHeight: 2.05 },
    },
    // Zona de Clínicas
    {
      ...base, id: 's-cli-1', destinationId: 'd-cli', kind: 'formal', ownerId: 'u-x6', plan: 'Destacado',
      name: 'Parqueadero Salud 127', address: 'Cl. 127 #19-40 (ficticia)', pos: { x: 0.15, y: -0.3 }, distanceM: 210,
      rates: { car: minute(145), moto: minute(90) }, capacity: { car: 70, moto: 20 }, occupied: { car: 55, moto: 12 },
      schedule: { open: '00:00', close: '23:59', days: 'Todos los días' },
      conditions: { covered: true, keys: false, maxHeight: 2.2 },
    },
    {
      ...base, id: 's-cli-2', destinationId: 'd-cli', kind: 'formal', ownerId: 'u-x7', plan: 'Básico',
      name: 'Autoparking Calle 134', address: 'Cl. 134 #17-22 (ficticia)', pos: { x: -0.5, y: 0.4 }, distanceM: 520,
      rates: { car: hour(8000), moto: hour(4000) }, capacity: { car: 35, moto: 8 }, occupied: { car: 20, moto: 2 },
      schedule: { open: '06:00', close: '22:00', days: 'Todos los días' },
      conditions: { covered: false, keys: true, maxHeight: null },
    },
    {
      ...base, id: 's-cli-3', destinationId: 'd-cli', kind: 'particular', hostId: 'u-host3', hostType: 'Garaje',
      name: 'Garaje familiar Cedritos', address: 'Cra. 15 #140-12 (ficticia)', pos: { x: 0.55, y: 0.35 }, distanceM: 440,
      rates: { car: hour(5500), moto: null }, capacity: { car: 1, moto: 0 }, occupied: { car: 0, moto: 0 },
      schedule: { open: '06:00', close: '20:00', days: 'Lun – Sáb' },
      conditions: { covered: true, keys: false, maxHeight: 2.0 },
    },
    {
      ...base, id: 's-cli-4', destinationId: 'd-cli', kind: 'particular', hostId: 'u-host3', hostType: 'Garaje',
      name: 'Garaje doble Calle 128', address: 'Cl. 128 #20-05 (ficticia)', pos: { x: -0.35, y: -0.55 }, distanceM: 390,
      rates: { car: hour(6000), moto: hour(2500) }, capacity: { car: 2, moto: 1 }, occupied: { car: 0, moto: 0 },
      schedule: { open: '07:00', close: '21:00', days: 'Todos los días' },
      conditions: { covered: true, keys: true, maxHeight: 1.95 },
    },
  ];

  const byId = Object.fromEntries(spaces.map((s) => [s.id, s]));
  const reservation = (id, spaceId, driverName, driverId, vehicle, startOffsetMin, durationMin, status, code) => ({
    id, code, spaceId, driverId, driverName, vehicle, status, durationMin,
    startAt: at(startOffsetMin),
    endAt: at(startOffsetMin + durationMin),
    amount: estimateCost(byId[spaceId].rates[vehicle], durationMin),
    createdAt: at(startOffsetMin - 90),
    checkInAt: status === 'active' || status === 'completed' ? at(startOffsetMin) : null,
  });

  const reservations = [
    reservation('r-1001', 's-emp-1', 'Diana R.', 'u-other', 'car', 40, 120, 'confirmed', 'TE-4F7K'),
    reservation('r-1002', 's-emp-1', 'Sergio L.', 'u-other', 'car', -50, 180, 'active', 'TE-9QX2'),
    reservation('r-1003', 's-emp-1', 'Paola M.', 'u-other', 'moto', -240, 60, 'completed', 'TE-2MB8'),
    reservation('r-1004', 's-emp-1', 'Julián T.', 'u-other', 'car', -120, 60, 'cancelled', 'TE-7HD3'),
    reservation('r-1005', 's-uni-1', 'Laura Gómez', 'u-driver', 'car', -2 * 24 * 60, 120, 'completed', 'TE-5KP1'),
    reservation('r-1006', 's-emp-4', 'Diana R.', 'u-other', 'car', -3 * 24 * 60, 240, 'completed', 'TE-8LN4'),
    reservation('r-1007', 's-uni-3', 'Felipe C.', 'u-other', 'car', -24 * 60, 120, 'completed', 'TE-3VR6'),
    reservation('r-1008', 's-uni-3', 'Camila S.', 'u-other', 'moto', 180, 120, 'confirmed', 'TE-6WJ9'),
  ];

  return { users, destinations, spaces, reservations, holds: [], idempotency: {}, revokedTokens: [], txLog: [] };
}
