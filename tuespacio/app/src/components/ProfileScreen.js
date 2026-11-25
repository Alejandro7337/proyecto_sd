// Perfil común a los tres roles (diseño del mockup): tarjeta marina con la cuenta, accesos,
// contenido propio del rol, herramientas de demo y cierre de sesión.
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Header } from './layout';
import { Button, Card, ListRow, Note, SettingsSection, SwitchRow, Txt } from './ui';
import { useApp } from '../state/AppContext';
import { usePreferences, useStyles } from '../state/Preferences';
import { ROLES } from '../domain/rules';
import { apiMode } from '../api/transport';
import { font, radius, space } from '../theme';

const initials = (name) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => (w[0] || '').toUpperCase())
    .join('');

const SWITCH_LABEL = { driver: 'Cambiar a modo propietario', owner: 'Cambiar de perfil', host: 'Cambiar de perfil' };

export function ProfileScreen({ children }) {
  const { user, signOut, offline, setOffline } = useApp();
  const { t, colors: c } = usePreferences();
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const leave = () => {
    signOut();
    router.replace('/welcome');
  };
  return (
    <Screen header={<Header title={t.profile} />}>
      <View style={styles.hero}>
        <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles.avatarText}>{initials(user.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroName} numberOfLines={1}>
            {user.name}
          </Text>
          <Text style={styles.heroMeta} numberOfLines={1}>
            {ROLES[user.role].label}
            {user.role === 'driver' ? ' · Cuenta gratis' : user.plan ? ` · Plan ${user.plan}` : ''}
          </Text>
          <Text style={styles.heroMeta} numberOfLines={1}>
            {user.email}
          </Text>
        </View>
      </View>

      <Card style={{ padding: 0, marginTop: space.lg }}>
        <ListRow icon="swap-horizontal" label={SWITCH_LABEL[user.role]} detail="Entra con la cuenta de otro perfil" onPress={leave} />
        <ListRow icon="settings-outline" label={t.settings} detail={`${t.appearance} · ${t.language}`} onPress={() => router.push('/settings')} last />
      </Card>

      {children}

      <SettingsSection title="Prototipo" icon="flask-outline">
        <View style={{ paddingHorizontal: space.lg }}>
          <SwitchRow
            icon="cloud-offline-outline"
            label="Simular sin conexión"
            description="Las consultas fallan como si no hubiera red."
            value={offline}
            onValueChange={setOffline}
          />
        </View>
        <ListRow icon="construct-outline" label="Herramientas de demostración" detail="Fallas, red lenta y registro de T0" onPress={() => router.push('/demo')} last />
      </SettingsSection>
      <Txt variant="small" style={{ marginTop: space.sm, paddingHorizontal: 4 }}>
        Backend: {apiMode === 'mock' ? 'simulado dentro de la app' : 'HTTP'} · Los datos son ficticios.
      </Txt>

      <Card flat style={{ marginTop: space.xl, flexDirection: 'row', gap: space.md }}>
        <Ionicons name="phone-portrait-outline" size={22} color={c.accent} />
        <View style={{ flex: 1 }}>
          <Txt variant="title" style={{ fontSize: font.sm }}>
            Instala Tu Espacio
          </Txt>
          <Txt variant="small" style={{ marginTop: 2 }}>
            Agrégala a tu pantalla de inicio para reservar más rápido.
          </Txt>
        </View>
      </Card>

      <Button title={t.signOut} icon="log-out-outline" variant="danger" onPress={leave} style={{ marginTop: space.xl }} />
    </Screen>
  );
}

export function PendingNote({ children }) {
  return (
    <Note tone="warning" icon="help-circle-outline" style={{ marginTop: space.md }}>
      {children}
    </Note>
  );
}

const makeStyles = (c) => ({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: c.navy,
    borderRadius: radius.lg,
    padding: space.xl,
    borderWidth: c.dark ? 1 : 0,
    borderColor: c.border,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: c.dark ? c.navy : c.white, fontSize: 20, fontWeight: '700' },
  heroName: { color: c.white, fontSize: font.md, fontWeight: '800' },
  heroMeta: { color: 'rgba(255,255,255,0.65)', fontSize: font.xs, marginTop: 2 },
});
