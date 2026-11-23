// Preferencias de interfaz del mockup: modo claro/oscuro e idioma.
// Se guardan en memoria (en web también en localStorage si está disponible).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { makeTones, palettes } from '../theme';
import { translate } from '../i18n';

const PreferencesContext = createContext(null);
const STORAGE_KEY = 'tuespacio.prefs';

function readStored() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStored(value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: las preferencias viven mientras la app esté abierta.
  }
}

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(() => ({ dark: false, language: 'es', notifications: true, ...readStored() }));

  const update = useCallback((patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writeStored(next);
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
