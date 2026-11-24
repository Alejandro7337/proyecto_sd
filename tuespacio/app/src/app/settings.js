// Configuración (pantalla del mockup): apariencia, idioma, preferencias, ayuda y cuenta.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Header } from '../components/layout';
import { ListRow, SettingsSection, Txt } from '../components/ui';
import { useApp } from '../state/AppContext';
import { usePreferences, useStyles } from '../state/Preferences';
import { LANGUAGES } from '../i18n';
import { VEHICLES } from '../domain/rules';
import { isDemoMode } from '../api/transport';
import { font, radius, space } from '../theme';
import appConfig from '../../app.json';

export default function Settings() {
  const router = useRouter();
  const { user, signOut, showToast } = useApp();
  const { dark, setDark, language, setLanguage, notifications, setNotifications, t, colors: c } = usePreferences();
  const styles = useStyles(makeStyles);
  const [showLanguages, setShowLanguages] = useState(false);
  const current = LANGUAGES.find((l) => l.value === language) || LANGUAGES[0];
  const soon = (what) => showToast(`${what}: disponible en la versión real`, 'info');

  return (
    <Screen header={<Header back title={t.settings} />}>
      <Txt variant="muted">{t.personalize}</Txt>

      <SettingsSection title={t.appearance} icon="sunny-outline">
        <ListRow
          icon={dark ? 'moon-outline' : 'sunny-outline'}
          label={dark ? t.dark : t.light}
          detail={t.theme}
          onPress={() => setDark(!dark)}
          right={<Toggle value={dark} styles={styles} />}
        />
        <ListRow
          icon="globe-outline"
          label={t.language}
          detail={current.native}
          onPress={() => setShowLanguages((v) => !v)}
          right={<Ionicons name={showLanguages ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSubtle} />}
          last={!showLanguages}
        />
        {showLanguages ? (
          <View style={styles.languages} accessibilityRole="radiogroup">
            {LANGUAGES.map((l) => {
              const active = l.value === language;
              return (
                <Pressable
                  key={l.value}
                  onPress={() => {
                    setLanguage(l.value);
                    setShowLanguages(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  style={({ pressed }) => [styles.lang, active && styles.langActive, pressed && !active && { backgroundColor: c.surface }]}
                >
                  <Text style={[styles.langText, active && styles.langTextActive]}>{l.native}</Text>
                  {active ? <Ionicons name="checkmark" size={16} color={c.dark ? c.navy : c.white} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t.preferences} icon="options-outline">
        <ListRow
          icon="notifications-outline"
          label={t.notifications}
          detail="Reservas, recordatorios y novedades (simulado)"
          onPress={() => setNotifications(!notifications)}
          right={<Toggle value={notifications} styles={styles} />}
          last={user?.role !== 'driver'}
        />
        {user?.role === 'driver' ? (
          <ListRow icon="car-outline" label="Vehículo principal" detail={VEHICLES[user.vehicle || 'car'].label} onPress={() => router.navigate('/driver/profile')} last />
        ) : null}
      </SettingsSection>

      <SettingsSection title={t.help} icon="help-circle-outline">
        <ListRow icon="help-circle-outline" label="Centro de ayuda" detail="Resuelve tus dudas" onPress={() => soon('Centro de ayuda')} />
        <ListRow icon="shield-checkmark-outline" label="Privacidad y seguridad" detail="Controla tus datos" onPress={() => soon('Privacidad y seguridad')} last={!isDemoMode} />
        {isDemoMode ? <ListRow icon="flask-outline" label="Herramientas de demostración" detail="Solo modo demo" onPress={() => router.push('/demo')} last /> : null}
      </SettingsSection>

      <SettingsSection title={t.account} icon="lock-closed-outline">
        {user ? (
          <ListRow
            icon="log-out-outline"
            label={t.signOut}
            detail="Cerrar la sesión actual"
            tone="danger"
            onPress={() => {
              signOut();
              router.dismissAll();
              router.replace('/welcome');
            }}
            last
          />
        ) : (
          <ListRow icon="log-in-outline" label={t.signIn} detail="Usar otra cuenta" onPress={() => router.replace('/welcome')} last />
        )}
      </SettingsSection>

      <Txt variant="small" style={{ textAlign: 'center', marginTop: space.xxl }}>
        {t.version} {appConfig.expo.version}
      </Txt>
    </Screen>
  );
}

// Interruptor del mockup (pista celeste, perilla blanca). La fila completa es el control.
function Toggle({ value, styles }) {
  return (
    <View style={[styles.track, value && styles.trackOn]} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.knob, value && styles.knobOn]} />
    </View>
  );
}

const makeStyles = (c) => ({
  track: { width: 48, height: 28, borderRadius: 14, padding: 4, backgroundColor: c.borderStrong },
  trackOn: { backgroundColor: c.accent },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: c.white },
  knobOn: { transform: [{ translateX: 20 }] },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.lg, paddingTop: space.xs },
  lang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
  },
  langActive: { backgroundColor: c.dark ? c.accent : c.navy, borderColor: c.dark ? c.accent : c.navy },
  langText: { fontSize: font.sm, fontWeight: '600', color: c.text },
  langTextActive: { color: c.dark ? c.navy : c.white, fontWeight: '800' },
});
