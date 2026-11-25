import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { setSessionToken } from '../api/transport';
import { api } from '../api';
import { faults, setFault } from '../api/mock/demoControls';
import { resetDb } from '../api/mock/db';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
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

  const signIn = useCallback(({ token, user }) => {
    setSessionToken(token);
    setSession({ token, user });
  }, []);

  const signOut = useCallback(() => {
    void api.logout().catch(() => {});
    setSessionToken(null);
    setSession(null);
  }, []);

  const updateUser = useCallback((user) => setSession((s) => (s ? { ...s, user } : s)), []);

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
    invalidate();
  }, [invalidate]);

  const value = useMemo(
    () => ({ session, user: session?.user, signIn, signOut, updateUser, offline, setOffline, dataVersion, invalidate, toast, showToast, resetDemoData }),
    [session, signIn, signOut, updateUser, offline, setOffline, dataVersion, invalidate, toast, showToast, resetDemoData]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
