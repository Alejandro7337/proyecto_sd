export function safeStorage(name) {
  const memory = new Map();
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try {
        return globalThis[name].getItem(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try {
        globalThis[name].setItem(key, String(value));
      } catch {
        /* Conserva el valor en esta sesión. */
      }
    },
    removeItem(key) {
      memory.set(key, null);
      try {
        globalThis[name].removeItem(key);
      } catch {
        /* El almacenamiento puede estar deshabilitado. */
      }
    },
  };
}
