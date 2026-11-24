// Catálogo (búsqueda, filtros, orden, estados vacíos) y panel de dueño y anfitrión.
import { call, DEMO, freshDb, login, reservationBody, setClock } from './support/backend';
import { findSpace, getDb } from '../src/api/mock/db';

beforeEach(() => {
  freshDb();
  setClock();
});

describe('búsqueda de destino y filtros', () => {
  test('busca sin tildes ni mayúsculas', async () => {
    const { data } = await call('GET', '/destinations?q=CLINICAS');
    expect(data.map((d) => d.id)).toEqual(['d-cli']);
  });
  test('sin coincidencias → lista vacía (estado vacío en la UI)', async () => {
    expect((await call('GET', '/destinations?q=marte')).data).toEqual([]);
  });
  test('búsqueda vacía devuelve todos los destinos', async () => {
    expect((await call('GET', '/destinations?q=')).data).toHaveLength(3);
  });
  test('destino inexistente → 404', async () => {
    expect((await call('GET', '/spaces?destinationId=d-nada')).error.status).toBe(404);
  });

  const ids = async (qs) => (await call('GET', '/spaces?destinationId=d-emp&' + qs)).data.map((s) => s.id);

  test('por vehículo: solo espacios que reciben motos', async () => {
    expect(await ids('vehicle=moto')).toEqual(['s-emp-1', 's-emp-2', 's-emp-5']);
  });
  test('techado + sin dejar llaves', async () => {
    const list = (await call('GET', '/spaces?destinationId=d-emp&covered=true&noKeys=true')).data;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.conditions.covered && !s.conditions.keys)).toBe(true);
  });
  test('solo particulares', async () => {
    expect(await ids('kind=particular')).toEqual(['s-emp-4']);
  });
  test('orden por cercanía y por precio equivalente por hora', async () => {
    expect(await ids('sort=distance')).toEqual(['s-emp-1', 's-emp-4', 's-emp-2', 's-emp-3']);
    // 5.000/h · 7.500/h · 138×60 = 8.280/h · 150×60 = 9.000/h
    expect(await ids('sort=price')).toEqual(['s-emp-4', 's-emp-2', 's-emp-1', 's-emp-3']);
  });
  test('filtros sin resultados → lista vacía', async () => {
    expect(await ids('vehicle=moto&kind=particular&covered=true')).toEqual([]);
  });
  test('un espacio pausado no aparece en el mapa', async () => {
    findSpace('s-emp-4').status = 'paused';
    expect(await ids('')).not.toContain('s-emp-4');
  });
  test('abrir el detalle con track=true suma una visita a las métricas del dueño', async () => {
    const before = findSpace('s-emp-1').metrics.views[6];
    await call('GET', '/spaces/s-emp-1?track=true');
    await call('GET', '/spaces/s-emp-1');
    expect(findSpace('s-emp-1').metrics.views[6]).toBe(before + 1);
  });
});

describe('panel del dueño de parqueadero', () => {
  let owner;
  beforeEach(async () => {
    owner = await login(DEMO.owner);
  });

  test('consulta su parqueadero, plan y métricas de 7 días', async () => {
    const { data } = await call('GET', '/owner/space', null, owner);
    expect(data.space.id).toBe('s-emp-1');
    expect(data.plan).toBe('Destacado');
    expect(data.metrics.views).toHaveLength(7);
    expect(data.metrics.reservations).toHaveLength(7);
  });

  test('las reservas de hoy cuentan en la métrica del día', async () => {
    const driver = await login(DEMO.driver);
    const before = (await call('GET', '/owner/space', null, owner)).data.metrics.reservations[6];
    await call('POST', '/reservations', reservationBody({ spaceId: 's-emp-1' }), driver);
    const { data } = await call('GET', '/owner/space', null, owner);
    expect(data.metrics.reservations[6]).toBe(before + 1);
  });

  test('gestiona cupos, tarifa y horario; el conductor ve el cambio al instante', async () => {
    const { data } = await call(
      'PATCH',
      '/spaces/s-emp-1',
      {
        capacity: { car: 45, moto: 12 },
        rates: { car: { unit: 'hour', price: 7000 }, moto: { unit: 'minute', price: 95 } },
        schedule: { open: '07:00', close: '21:00', days: 'Todos los días' },
      },
      owner
    );
    expect(data.capacity.car).toBe(45);
    const seen = (await call('GET', '/spaces/s-emp-1')).data;
    expect(seen.rates.car).toEqual({ unit: 'hour', price: 7000 });
    expect(seen.schedule).toMatchObject({ open: '07:00', close: '21:00', days: 'Todos los días' });
  });

  test('no puede bajar los cupos por debajo de los que están en uso', async () => {
    const { error } = await call('PATCH', '/spaces/s-emp-1', { capacity: { car: 5, moto: 12 } }, owner);
    expect(error.details.fields['capacity.car']).toMatch(/en uso/);
  });

  test.each([
    [{ rates: { car: { unit: 'hour', price: 0 }, moto: { unit: 'hour', price: 1 } } }, 'rates.car'],
    [{ schedule: { open: '25:00', close: '20:00', days: 'Lun – Vie' } }, 'schedule.open'],
    [{ schedule: { open: '20:00', close: '08:00', days: 'Lun – Vie' } }, 'schedule.close'],
    [{ schedule: { open: '08:00', close: '20:00', days: 'Feriados' } }, 'schedule.days'],
    [{ conditions: { covered: true, keys: false, maxHeight: 9 } }, 'conditions.maxHeight'],
    [{ status: 'borrado' }, 'status'],
  ])('rechaza %j (campo %s)', async (input, field) => {
    const { error } = await call('PATCH', '/spaces/s-emp-1', input, owner);
    expect(error.status).toBe(422);
    expect(error.details.fields).toHaveProperty([field]);
  });

  test('registra entrada y salida de vehículos sin reserva', async () => {
    const before = findSpace('s-emp-1').occupied.car;
    const inRes = await call('POST', '/spaces/s-emp-1/occupancy', { vehicle: 'car', delta: 1 }, owner);
    expect(inRes.data.availability.car.occupied).toBe(before + 1);
    const outRes = await call('POST', '/spaces/s-emp-1/occupancy', { vehicle: 'car', delta: -1 }, owner);
    expect(outRes.data.availability.car.occupied).toBe(before);
  });

  test('no registra entradas sin cupo ni salidas sin vehículos', async () => {
    const space = findSpace('s-emp-1');
    space.occupied.moto = 0;
    expect((await call('POST', '/spaces/s-emp-1/occupancy', { vehicle: 'moto', delta: -1 }, owner)).error.code).toBe('NOTHING_TO_RELEASE');
    space.occupied.car = space.capacity.car;
    expect((await call('POST', '/spaces/s-emp-1/occupancy', { vehicle: 'car', delta: 1 }, owner)).error.code).toBe('NO_FREE_SPOTS');
    expect((await call('POST', '/spaces/s-emp-1/occupancy', { vehicle: 'car', delta: 5 }, owner)).error.status).toBe(422);
  });
});

describe('panel del anfitrión', () => {
  let host;
  const newSpace = {
    name: 'Garaje de prueba',
    address: 'Cl. 1 #2-3 (ficticia)',
    destinationId: 'd-uni',
    hostType: 'Garaje',
    capacity: { car: 1, moto: 0 },
    rates: { car: { unit: 'hour', price: 4000 }, moto: null },
    schedule: { open: '07:00', close: '19:00', days: 'Lun – Vie' },
    conditions: { covered: true, keys: false, maxHeight: null },
    identityConsent: true,
  };
  beforeEach(async () => {
    host = await login(DEMO.host);
  });

  test('publica un espacio: aparece en el mapa y su identidad pasa a revisión', async () => {
    const { data } = await call('POST', '/host/spaces', newSpace, host);
    expect(data.status).toBe('published');
    expect((await call('GET', '/spaces?destinationId=d-uni')).data.map((s) => s.id)).toContain(data.id);
    expect((await call('GET', '/me', null, host)).data.identity).toBe('in_review');
  });

  test('sin consentimiento de verificación de identidad no publica', async () => {
    const { error } = await call('POST', '/host/spaces', { ...newSpace, identityConsent: false }, host);
    expect(error.details.fields).toHaveProperty('identityConsent');
  });

  test('pausa un espacio: deja de recibir reservas y vuelve a publicarse', async () => {
    await call('PATCH', '/spaces/s-emp-4', { status: 'paused' }, host);
    const driver = await login(DEMO.driver);
    expect((await call('POST', '/reservations', reservationBody({ spaceId: 's-emp-4' }), driver)).error.code).toBe('SPACE_UNAVAILABLE');
    await call('PATCH', '/spaces/s-emp-4', { status: 'published' }, host);
    expect((await call('POST', '/reservations', reservationBody({ spaceId: 's-emp-4' }), driver)).data.status).toBe('confirmed');
  });

  test('recibe la reserva y la ve en su ingreso pendiente; al finalizar pasa a bruto', async () => {
    const driver = await login(DEMO.driver);
    const { data: r } = await call('POST', '/reservations', reservationBody({ spaceId: 's-emp-4', durationMin: 120 }), driver);
    expect((await call('GET', '/host/reservations', null, host)).data.map((x) => x.id)).toContain(r.id);
    const before = (await call('GET', '/host/earnings', null, host)).data;
    expect(before.pending).toBeGreaterThanOrEqual(r.amount);
    await call('POST', `/reservations/${r.id}/check-in`, null, driver);
    await call('POST', `/reservations/${r.id}/check-out`, null, driver);
    const after = (await call('GET', '/host/earnings', null, host)).data;
    expect(after.gross).toBe(before.gross + r.amount);
    // La comisión no está definida (Fase 0): no se inventa un neto.
    expect(after.commissionRate).toBeNull();
    expect(after.net).toBeNull();
  });

  test('las reservas canceladas no cuentan como ingreso', async () => {
    const driver = await login(DEMO.driver);
    const { data: r } = await call('POST', '/reservations', reservationBody({ spaceId: 's-emp-4' }), driver);
    await call('POST', `/reservations/${r.id}/cancel`, null, driver);
    const { data } = await call('GET', '/host/earnings', null, host);
    expect(data.items.map((x) => x.id)).not.toContain(r.id);
    expect(getDb().reservations.find((x) => x.id === r.id).status).toBe('cancelled');
  });
});
