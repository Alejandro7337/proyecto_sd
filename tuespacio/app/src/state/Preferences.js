// Preferencias de interfaz del mockup: modo claro/oscuro e idioma.
// Persisten en el dispositivo (web: localStorage, leído al instante; teléfono: SecureStore).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { makeTones, palettes } from '../theme';
import { LANGUAGES, translate } from '../i18n';
import { readJSON, STORAGE_KEYS, writeJSON } from './storage';

const PreferencesContext = createContext(null);
const DEFAULTS = { dark: false, language: 'es', notifications: true };

// Descarta valores corruptos o de versiones anteriores.
export function sanitizePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    dark: typeof p.dark === 'boolean' ? p.dark : DEFAULTS.dark,
    language: LANGUAGES.some((l) => l.value === p.language) ? p.language : DEFAULTS.language,
    notifications: typeof p.notifications === 'boolean' ? p.notifications : DEFAULTS.notifications,
  };
}

function readWebSync() {
  try {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.prefs) || '{}');
  } catch {
    return {};
  }
}

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(() => sanitizePrefs(readWebSync()));

  useEffect(() => {
    if (Platform.OS === 'web') return;
    readJSON(STORAGE_KEYS.prefs).then((stored) => stored && setPrefs(sanitizePrefs(stored)));
  }, []);

  const update = useCallback((patch) => {
    setPrefs((p) => {
      const next = sanitizePrefs({ ...p, ...patch });
      writeJSON(STORAGE_KEYS.prefs, next);
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const colors = prefs.dark ? palettes.dark : palettes.light;
    return {
      ...prefs,
      colors,
      tones: makeTones(colors),
      t: translate(prefs.language),
      setDark: (dark) => update({ dark }),
      setLanguage: (language) => update({ language }),
      setNotifications: (notifications) => update({ notifications }),
    };
  }, [prefs, update]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);
export const useTheme = () => usePreferences().colors;

// Hoja de estilos que se recalcula al cambiar de tema: `const styles = useStyles(makeStyles)`.
export function useStyles(factory) {
  const { colors, tones } = usePreferences();
  return useMemo(() => StyleSheet.create(factory(colors, tones)), [factory, colors, tones]);
}
