// Navegación principal, inicio y cierre de sesión, persistencia, token vencido y acceso entre roles.
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { clearStorage, renderApp, storeSession, storedSession, waitForPath } from '../support/ui';
import { DEMO, freshDb } from '../support/backend';
import { clock, getDb } from '../../src/api/mock/db';
import { SESSION_TTL_HOURS } from '../../src/domain/rules';

beforeEach(() => {
  freshDb();
  clearStorage();
});

test('sin sesión: la entrada lleva a la bienvenida con los tres perfiles', async () => {
  const app = await renderApp('/');
  await waitForPath(app, '/welcome');
  for (const title of ['Soy conductor', 'Tengo un parqueadero', 'Tengo un garaje o lote']) {
    expect(await screen.findByRole('button', { name: new RegExp(title) })).toBeTruthy();
  }
});

test('inicio de sesión del conductor con cuenta demo → explorar con sus pestañas', async () => {
  const app = await renderApp('/welcome');
  fireEvent.press(await screen.findByRole('button', { name: /Soy conductor/ }));
  await waitForPath(app, '/login');
  fireEvent.press(await screen.findByRole('button', { name: 'Usar cuenta de prueba' }));
  expect(await screen.findByDisplayValue(DEMO.driver)).toBeTruthy();
  fireEvent.press(await screen.findByRole('button', { name: 'Iniciar sesión' }));
  await waitForPath(app, '/driver');
  for (const tab of ['Inicio', 'Reservas', 'Perfil']) expect((await screen.findAllByText(tab)).length).toBeGreaterThan(0);
  // Persistencia: la sesión queda guardada en el almacenamiento seguro.
  expect(storedSession().user.email).toBe(DEMO.driver);
});

test('login valida los campos antes de llamar al servidor y muestra el error del servidor', async () => {
  const app = await renderApp('/login?role=driver');
  await waitForPath(app, '/login');
  fireEvent.press(await screen.findByRole('button', { name: 'Iniciar sesión' }));
  expect(await screen.findByText('Escribe un correo válido.')).toBeTruthy();
  expect(await screen.findByText('La contraseña tiene mínimo 6 caracteres.')).toBeTruthy();
  fireEvent.changeText(await screen.findByPlaceholderText('tu@correo.com'), DEMO.driver);
  fireEvent.changeText(await screen.findByPlaceholderText('••••••••'), 'incorrecta');
  fireEvent.press(await screen.findByRole('button', { name: 'Iniciar sesión' }));
  expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeTruthy();
  expect(app.getPathname()).toBe('/login');
});

test('un rol desconocido en el enlace abre el login de conductor en lugar de fallar', async () => {
  const app = await renderApp('/login?role=admin');
  await waitForPath(app, '/login');
  expect(await screen.findByText(/Tu Espacio · Conductor/)).toBeTruthy();
});

test('sesión guardada: al abrir la app entra directo al inicio de su rol', async () => {
  await storeSession(DEMO.owner);
  const app = await renderApp('/');
  await waitForPath(app, '/owner');
  expect((await screen.findAllByText('Resumen')).length).toBeGreaterThan(0);
});

test('token vencido al abrir: borra la sesión y el login explica por qué', async () => {
  await storeSession(DEMO.driver);
  const real = clock.now;
  const later = Date.now() + SESSION_TTL_HOURS * 3600000 + 60000;
  clock.now = () => later;
  const app = await renderApp('/');
  await waitForPath(app, '/welcome');
  expect(storedSession()).toBeNull();
  fireEvent.press(await screen.findByRole('button', { name: /Soy conductor/ }));
  expect(await screen.findByText('Tu sesión expiró. Inicia sesión de nuevo.')).toBeTruthy();
  clock.now = real;
});

test('acceso entre roles: un conductor que abre /owner vuelve a su inicio', async () => {
  await storeSession(DEMO.driver);
  const app = await renderApp('/owner');
  await waitForPath(app, '/driver');
});

test('cerrar sesión: vuelve a la bienvenida, borra la sesión y revoca el token', async () => {
  const token = await storeSession(DEMO.driver);
  const app = await renderApp('/driver/profile');
  await waitForPath(app, '/driver/profile');
  fireEvent.press(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  await waitForPath(app, '/welcome');
  expect(storedSession()).toBeNull();
  await waitFor(() => expect(getDb().revokedTokens).toContain(token));
});

test('sin conexión: aparece el aviso y "Reconectar" lo quita', async () => {
  await storeSession(DEMO.driver);
  const app = await renderApp('/driver/profile');
  await waitForPath(app, '/driver/profile');
  fireEvent(await screen.findByRole('switch', { name: /Simular sin conexión/ }), 'valueChange', true);
  expect(await screen.findByText(/Sin conexión \(simulada\)/)).toBeTruthy();
  fireEvent.press(await screen.findByRole('button', { name: 'Reconectar' }));
  await waitFor(() => expect(screen.queryByText(/Sin conexión \(simulada\)/)).toBeNull());
});

test('la etiqueta de modo demo aparece en los encabezados', async () => {
  await storeSession(DEMO.driver);
  const app = await renderApp('/driver/profile');
  await waitForPath(app, '/driver/profile');
  expect(await screen.findByLabelText(/Modo demostración: datos ficticios/)).toBeTruthy();
});

test('una ruta inexistente no rompe la app', async () => {
  await act(async () => {
    await renderApp('/no-existe');
  });
  expect(screen.toJSON()).toBeTruthy();
});
