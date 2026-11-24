import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Logo } from '../components/ui';
import { isDemoMode } from '../api/transport';
import { useStyles, useTheme } from '../state/Preferences';
import { font, radius, space } from '../theme';

const PROFILES = [
  { role: 'driver', icon: 'car-outline', title: 'Soy conductor', text: 'Cupo, tarifa y condiciones antes de salir. Gratis.' },
  { role: 'owner', icon: 'business-outline', title: 'Tengo un parqueadero', text: 'Cupos, tarifas, horarios y tu demanda.' },
  { role: 'host', icon: 'home-outline', title: 'Tengo un garaje o lote', text: 'Publica tu espacio libre y recibe reservas.' },
];

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' };

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.lg }]}>
        <Logo size={56} tone="accent" />
        <Text style={styles.brand}>Tu Espacio</Text>
        <Text style={styles.headline} accessibilityRole="header">
          Parquea sin vueltas.
        </Text>
        <Text style={styles.tagline}>Tu parqueadero, resuelto antes de salir.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>¿Cómo usarás la app?</Text>
          {PROFILES.map((p, i) => (
            <Pressable
              key={p.role}
              accessibilityRole="button"
              accessibilityLabel={`${p.title}. ${p.text}`}
              onPress={() => router.push({ pathname: '/login', params: { role: p.role } })}
              android_ripple={{ color: c.surfacePressed }}
              style={({ pressed }) => [styles.profile, i > 0 && styles.profileDivider, pressed && { backgroundColor: c.surface }]}
            >
              <View style={styles.profileIcon} {...hidden}>
                <Ionicons name={p.icon} size={22} color={c.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileTitle}>{p.title}</Text>
                <Text style={styles.profileText}>{p.text}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textSubtle} {...hidden} />
            </Pressable>
          ))}
        </View>

        <View style={{ flex: 1 }} />
        <View style={styles.links}>
          {isDemoMode ? (
            <Pressable onPress={() => router.push('/demo')} style={styles.demoLink} hitSlop={8} accessibilityRole="link">
              <Ionicons name="flask-outline" size={15} color="rgba(255,255,255,0.7)" {...hidden} />
              <Text style={styles.demoText}>Presentación guiada y herramientas de demo</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/settings')} style={styles.demoLink} hitSlop={8} accessibilityRole="link">
            <Ionicons name="settings-outline" size={15} color="rgba(255,255,255,0.7)" {...hidden} />
            <Text style={styles.demoText}>Apariencia e idioma</Text>
          </Pressable>
        </View>
        <Text style={[styles.demoText, { textAlign: 'center' }]}>{isDemoMode ? 'Modo demo · datos ficticios · sin cobros reales' : ''}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.navy },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl },
  brand: { color: c.accent, fontSize: font.xs, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginTop: space.xxxl },
  headline: { color: c.white, fontSize: 38, fontWeight: '900', letterSpacing: -1.2, lineHeight: 44, marginTop: space.md },
  tagline: { color: 'rgba(255,255,255,0.65)', fontSize: font.md, marginTop: space.sm, lineHeight: 24, maxWidth: 320 },
  card: { backgroundColor: c.card, borderRadius: radius.xl, paddingVertical: space.sm, marginTop: space.xxxl, overflow: 'hidden' },
  label: { color: c.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xs },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, paddingHorizontal: space.xl, minHeight: 72, overflow: 'hidden' },
  profileDivider: { borderTopWidth: 1, borderTopColor: c.border },
  profileIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  profileTitle: { color: c.text, fontSize: font.md, fontWeight: '800' },
  profileText: { color: c.textMuted, fontSize: font.sm, marginTop: 2, lineHeight: 20 },
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: space.xl, marginTop: space.xxl },
  demoLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: space.md, minHeight: 44 },
  demoText: { color: 'rgba(255,255,255,0.7)', fontSize: font.xs, fontWeight: '600' },
});
