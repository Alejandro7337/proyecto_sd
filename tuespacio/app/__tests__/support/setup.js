// Configuración común: backend simulado sin latencia y almacenamiento seguro en memoria.
import { faults } from '../../src/api/mock/demoControls';

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
  };
});

beforeEach(() => {
  faults.latencyMs = 0;
  faults.timeScale = 0;
  faults.offline = false;
  faults.nextReservation = 'none';
});
