import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';

// Consulta simple: { data, loading, error, reload }. Se repite cuando cambian las
// dependencias o cuando alguna mutación invalida los datos (dataVersion).
export function useQuery(fetcher, deps = [], { enabled = true } = {}) {
  const { dataVersion } = useApp();
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  // Se declara antes del efecto de consulta, así que corre primero en cada commit.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef
      .current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState((s) => ({ data: s.data, loading: false, error })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

// Envuelve una mutación con estado de envío y error.
export function useMutation(fn) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (...args) => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [fn]
  );
  return { run, pending, error, setError };
}
