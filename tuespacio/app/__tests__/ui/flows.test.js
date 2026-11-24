// Flujos de pantalla: conductor (buscar, filtrar, detalle, reservar, llegada, salida, cancelar),
// dueño (entrada sin reserva), configuración (tema e idioma), demo y accesibilidad básica.
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';
import { clearStorage, renderApp, secureStore, storeSession, waitForPath } from '../support/ui';
import { DEMO, freshDb } from '../support/backend';
import { clock, findSpace, getDb } from '../../src/api/mock/db';

jest.setTimeout(20000);
const realNow = Date.now;
beforeEach(() => {
  freshDb();
  clearStorage();
});
afterEach(() => {
  Date.now = realNow;
});

// Fija la hora de la app y del servidor simulado (martes 10:00 en Bogotá por defecto).
function at(iso = '2026-11-24T10:00:00-05:00') {
  const t = new Date(iso).getTime();
  Date.now = () => t;
  clock.now = () => t;
}

describe('conductor', () => {
  test('búsqueda sin resultados muestra el estado vacío', async () => {
    await storeSession(DEMO.driver);
    const app = await renderApp('/driver');
    await waitForPath(app, '/driver');
    fireEvent.changeText(await screen.findByLabelText('Buscar destino'), 'Marte');
    expect(await screen.findByText('No encontramos ese destino')).toBeTruthy();
  });

  test('busca destino, filtra y un filtro sin resultados muestra su estado vacío', async () => {
    await storeSession(DEMO.driver);
    const app = await renderApp('/driver');
    await waitForPath(app, '/driver');
    fireEvent.changeText(await screen.findByLabelText('Buscar destino'), 'empresarial');
    fireEvent.press(await screen.findByRole('button', { name: /Zona Empresarial/ }));
    expect(await screen.findByText('Parqueadero Torre 72')).toBeTruthy();
    fireEvent.press(await screen.findByRole('button', { name: 'Particulares' }));
    await waitFor(() => expect(screen.queryByText('Parqueadero Torre 72')).toBeNull());
    expect(await screen.findByText('Garaje cubierto Cra. 11')).toBeTruthy();
    // Los filtros de tipo son excluyentes; moto + particular + techado no tiene resultados.
    fireEvent.press(await screen.findByText('Moto'));
    fireEvent.press(await screen.findByRole('button', { name: 'Techado' }));
    expect(await screen.findByText('Sin espacios con estos filtros')).toBeTruthy();
  });

  test('reserva completa: confirmar → código → llegada → salida', async () => {
    at();
    await storeSession(DEMO.driver);
    const app = await renderApp('/reserve/s-cli-1?vehicle=car');
    fireEvent.press(await screen.findByRole('button', { name: /Reservar y pagar/ }));
    expect(await screen.findByText('¡Tu cupo está listo!', {}, { timeout: 8000 })).toBeTruthy();
    expect(app.getPathname()).toMatch(/^\/reservation\//);
    const r = getDb().reservations[0];
    expect(await screen.findByText(r.code)).toBeTruthy();
    fireEvent.press(await screen.findByRole('button', { name: 'Llegué: registrar entrada' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Registrar salida' }, { timeout: 8000 }));
    await waitFor(() => expect(getDb().reservations[0].status).toBe('completed'), { timeout: 8000 });
  });

  test('cancelar pide confirmación y muestra el reembolso', async () => {
    at();
    await storeSession(DEMO.driver);
    const app = await renderApp('/reserve/s-cli-1?vehicle=car');
    fireEvent.press(await screen.findByRole('button', { name: /Reservar y pagar/ }));
    await screen.findByText('¡Tu cupo está listo!', {}, { timeout: 8000 });
    fireEvent.press(await screen.findByRole('button', { name: 'Cancelar reserva' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Sí, cancelar' }));
    expect(await screen.findByText(/Reembolsada/, {}, { timeout: 8000 })).toBeTruthy();
    expect(app.getPathname()).toMatch(/^\/reservation\//);
  });

  test('fuera de horario: el botón de pago se deshabilita y explica el motivo', async () => {
    at('2026-11-24T18:30:00-05:00'); // el Garaje Cra. 11 cierra a las 19:00
    await storeSession(DEMO.driver);
    await renderApp('/reserve/s-emp-4?vehicle=car');
    const pay = await screen.findByRole('button', { name: /Reservar y pagar/ });
    expect(pay).toBeDisabled();
    expect(await screen.findByText(/termina después del cierre/)).toBeTruthy();
  });

  test('pago rechazado simulado: muestra el error, no crea reserva y permite reintentar', async () => {
    at();
    await storeSession(DEMO.driver);
    await renderApp('/reserve/s-cli-1?vehicle=car');
    fireEvent.press(await screen.findByRole('button', { name: 'Pago rechazado' }));
    fireEvent.press(await screen.findByRole('button', { name: /Reservar y pagar/ }));
    expect(await screen.findByText('No se pudo reservar', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Pago rechazado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy();
    expect(getDb().reservations.filter((r) => r.driverId === 'u-driver' && r.status === 'confirmed')).toHaveLength(0);
  });
});

describe('dueño de parqueadero', () => {
  test('registra una entrada sin reserva desde el resumen', async () => {
    await storeSession(DEMO.owner);
    const app = await renderApp('/owner');
    await waitForPath(app, '/owner');
    const before = findSpace('s-emp-1').occupied.car;
    // La primera tarjeta es la de carros.
    fireEvent.press((await screen.findAllByRole('button', { name: 'Entrada' }))[0]);
    await waitFor(() => expect(findSpace('s-emp-1').occupied.car).toBe(before + 1));
    expect(await screen.findByText(`${before + 1} sin reserva`)).toBeTruthy();
  });
});

describe('configuración', () => {
  test('modo oscuro e idioma: se aplican y se guardan', async () => {
    await storeSession(DEMO.driver);
    const app = await renderApp('/settings');
    await waitForPath(app, '/settings');
    fireEvent.press(await screen.findByText('Modo claro'));
    expect(await screen.findByText('Modo oscuro')).toBeTruthy();
    fireEvent.press(await screen.findByText('Idioma'));
    fireEvent.press(await screen.findByRole('radio', { name: /English/ }));
    expect(await screen.findByText('Settings')).toBeTruthy();
    const saved = JSON.parse(secureStore().get('tuespacio.prefs'));
    expect(saved).toMatchObject({ dark: true, language: 'en' });
  });
});

describe('presentación guiada (demo)', () => {
  test('ejecuta "Dos conductores, un cupo" y muestra que solo uno gana', async () => {
    const app = await renderApp('/demo');
    await waitForPath(app, '/demo');
    const card = (await screen.findByText('Dos conductores, un cupo')).parent.parent.parent;
    fireEvent.press(within(card).getByRole('button', { name: 'Ejecutar' }));
    expect(await screen.findByText(/Sin sobreventa/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByText('Confirmada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rechazada').length).toBeGreaterThan(0);
  });

  test('restablecer datos borra el registro técnico', async () => {
    await renderApp('/demo');
    const card = (await screen.findByText('Reserva exitosa')).parent.parent.parent;
    fireEvent.press(within(card).getByRole('button', { name: 'Ejecutar' }));
    await waitFor(() => expect(getDb().txLog.length).toBe(1), { timeout: 8000 });
    fireEvent.press(await screen.findByRole('button', { name: 'Restablecer datos de demostración' }));
    await waitFor(() => expect(getDb().txLog).toHaveLength(0));
    expect(await screen.findByText('Sin transacciones todavía')).toBeTruthy();
  });
});

describe('accesibilidad básica', () => {
  const screens = [
    ['/welcome', null],
    ['/login?role=driver', null],
    ['/driver', DEMO.driver],
    ['/driver/profile', DEMO.driver],
    ['/owner', DEMO.owner],
    ['/host', DEMO.host],
    ['/settings', DEMO.driver],
    ['/demo', null],
  ];
  test.each(screens)('%s: todo botón tiene nombre accesible y área táctil ≥ 44 px', async (url, account) => {
    if (account) await storeSession(account);
    await renderApp(url);
    await waitFor(() => expect(screen.queryAllByRole('button').length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    for (const b of screen.queryAllByRole('button')) {
      const name = b.props.accessibilityLabel || within(b).queryAllByText(/.+/).map((t) => t.props.children).join(' ');
      expect(String(name).trim().length).toBeGreaterThan(0);
      const style = StyleSheet.flatten(typeof b.props.style === 'function' ? b.props.style({ pressed: false }) : b.props.style) || {};
      const slop = typeof b.props.hitSlop === 'number' ? b.props.hitSlop * 2 : (b.props.hitSlop?.top || 0) + (b.props.hitSlop?.bottom || 0);
      const height = Math.max(style.minHeight || 0, style.height || 0) + slop;
      if (height > 0) expect({ name, height: height >= 44 }).toEqual({ name, height: true });
    }
  });
});
