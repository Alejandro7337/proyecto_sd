import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setSessionToken, setUnauthorizedHandler } from '../api/transport';
import { api } from '../api';
import { faults, setFault } from '../api/mock/demoControls';
import { resetDb } from '../api/mock/db';
import { readJSON, removeKey, STORAGE_KEYS, writeJSON } from './storage';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  // false hasta revisar si hay una sesión guardada: evita mostrar la bienvenida un instante.
  const [ready, setReady] = useState(false);
  // Motivo del último cierre de sesión forzado (token vencido o inválido), para el login.
  const [sessionNotice, setSessionNotice] = useState(null);
  const [offline, setOfflineState] = useState(faults.offline);
  const [dataVersion, setDataVersion] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((message, tone = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Tras una mutación, las pantallas montadas vuelven a consultar sus datos.
  const invalidate = useCallback(() => setDataVersion((v) => v + 1), []);

  const clearLocalSession = useCallback(() => {
    setSessionToken(null);
    setSession(null);
    removeKey(STORAGE_KEYS.session);
  }, []);

  const signIn = useCallback(({ token, user }) => {
    setSessionToken(token);
    setSession({ token, user });
    setSessionNotice(null);
    writeJSON(STORAGE_KEYS.session, { token, user });
  }, []);

  const signOut = useCallback(async () => {
    // Se revoca en el servidor si hay red; la sesión local se borra siempre.
    api.logout().catch(() => {});
    clearLocalSession();
  }, [clearLocalSession]);

  const updateUser = useCallback(
    (user) =>
      setSession((s) => {
        if (!s) return s;
        const next = { ...s, user };
        writeJSON(STORAGE_KEYS.session, next);
        return next;
      }),
    []
  );

  // Un 401 del servidor con la sesión actual (vencida, revocada o inválida) la cierra.
  useEffect(() => {
    setUnauthorizedHandler((error) => {
      clearLocalSession();
      setSessionNotice(error.code === 'TOKEN_EXPIRED' ? 'Tu sesión expiró. Inicia sesión de nuevo.' : 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocalSession]);

  // Restaura la sesión guardada y la valida contra el servidor antes de usarla.
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await readJSON(STORAGE_KEYS.session);
      if (stored?.token) {
        setSessionToken(stored.token);
        try {
          const user = await api.me();
          if (alive) setSession({ token: stored.token, user });
        } catch (e) {
          // 401 ya lo atendió el manejador; sin red se conserva el token para reintentar después.
          if (e.code === 'NETWORK' || e.code === 'TIMEOUT') {
            if (alive) setSession({ token: stored.token, user: stored.user });
          } else {
            clearLocalSession();
          }
        }
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [clearLocalSession]);

  const setOffline = useCallback(
    (value) => {
      setFault('offline', value);
      setOfflineState(value);
      if (!value) invalidate();
    },
    [invalidate]
  );

  const resetDemoData = useCallback(() => {
    resetDb();
    setFault('nextReservation', 'none');
    invalidate();
  }, [invalidate]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user,
      ready,
      sessionNotice,
      signIn,
      signOut,
      updateUser,
      offline,
      setOffline,
      dataVersion,
      invalidate,
      toast,
      showToast,
      resetDemoData,
    }),
    [session, ready, sessionNotice, signIn, signOut, updateUser, offline, setOffline, dataVersion, invalidate, toast, showToast, resetDemoData]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
