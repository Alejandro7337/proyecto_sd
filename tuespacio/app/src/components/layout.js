// Estructura de pantalla: encabezado de marca, contenido desplazable y pie fijo con acción principal.
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { font, radius, space } from '../theme';
import { useApp } from '../state/AppContext';
import { useStyles, useTheme } from '../state/Preferences';
import { Logo } from './ui';

export function Screen({ children, header, footer, scroll = true, onRefresh, refreshing = false, contentStyle, safeTop = true, style }) {
  const insets = useSafeAreaInsets();
  const { offline } = useApp();
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <KeyboardAvoidingView style={[styles.root, safeTop && { paddingTop: insets.top }, style]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      {offline ? <OfflineBanner /> : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.accent]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

// Encabezado del mockup: volver · logo marino · "TU ESPACIO" en celeste · título en negrita.
export function Header({ title, subtitle, back, onBack, right }) {
  const router = useRouter();
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <View style={styles.header}>
      {back ? (
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Volver" hitSlop={8} style={({ pressed }) => [styles.backBtn, pressed && { backgroundColor: c.surface }]}>
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
      ) : null}
      <Logo size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function OfflineBanner() {
  const { setOffline } = useApp();
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.offline}>
      <Ionicons name="cloud-offline-outline" size={16} color={c.white} />
      <Text style={styles.offlineText}>Sin conexión (simulada). Los cambios no se pueden enviar.</Text>
      <Pressable onPress={() => setOffline(false)} hitSlop={8}>
        <Text style={[styles.offlineText, { fontWeight: '800', textDecorationLine: 'underline' }]}>Reconectar</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    backgroundColor: c.bg,
  },
  backBtn: { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  brand: { fontSize: 10, fontWeight: '800', color: c.accent, letterSpacing: 1.8, textTransform: 'uppercase' },
  title: { fontSize: font.lg, fontWeight: '700', color: c.heading, letterSpacing: -0.2, marginTop: 1 },
  subtitle: { fontSize: font.xs, color: c.textMuted, marginTop: 1 },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: c.overlay,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: c.navy,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  offlineText: { color: c.white, fontSize: font.xs, flexShrink: 1 },
});
