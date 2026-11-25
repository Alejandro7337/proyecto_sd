import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Logo, Note, TextField, Txt } from '../components/ui';
import { OfflineBanner } from '../components/layout';
import { api } from '../api';
import { describeError } from '../api/errors';
import { useApp } from '../state/AppContext';
import { usePreferences, useStyles } from '../state/Preferences';
import { ROLES } from '../domain/rules';
import { isValidEmail } from '../utils/format';
import { font, radius, space } from '../theme';

const DEMO_EMAIL = { driver: 'conductor@demo.test', owner: 'parqueadero@demo.test', host: 'anfitrion@demo.test' };

export default function Login() {
  const { role = 'driver' } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, offline } = useApp();
  const { colors: c, t } = usePreferences();
  const styles = useStyles(makeStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(false);

  const fillDemo = () => {
    setEmail(DEMO_EMAIL[role]);
    setPassword('demo123');
    setErrors({});
    setFormError(null);
  };

  const submit = async () => {
    const next = {};
    if (!isValidEmail(email)) next.email = 'Escribe un correo válido.';
    if (password.length < 6) next.password = 'La contraseña tiene mínimo 6 caracteres.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      const session = await api.login(email, password, role);
      signIn(session);
      // La bienvenida y el login salen de la pila: "atrás" no debe volver a ellos con sesión abierta.
      router.dismissAll();
      router.replace(ROLES[role].home);
    } catch (e) {
      setFormError(describeError(e).message);
    } finally {
      setLoading(false);
    }
  };

  const canRegister = role === 'driver' || role === 'host';
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={{ paddingTop: insets.top }}>{offline ? <OfflineBanner /> : null}</View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Volver" hitSlop={8} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={c.white} />
        </Pressable>
        <Logo size={56} tone="accent" />
        <Text style={styles.brand}>Tu Espacio · {ROLES[role].label}</Text>
        <Text style={styles.headline} accessibilityRole="header">
          Vuelve a parquear sin vueltas.
        </Text>
        <Text style={styles.sub}>Inicia sesión para ver tus reservas y preferencias.</Text>

        <View style={styles.card}>
          <TextField
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="tu@correo.com"
            left={<Ionicons name="mail-outline" size={18} color={c.accent} />}
          />
          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            secureTextEntry={!showPass}
            placeholder="••••••••"
            onSubmitEditing={submit}
            left={<Ionicons name="lock-closed-outline" size={18} color={c.accent} />}
            inputStyle={{ paddingRight: 4 }}
          />
          <Pressable onPress={() => setShowPass((v) => !v)} style={{ alignSelf: 'flex-start', marginTop: -8, marginBottom: space.lg }} hitSlop={8}>
            <Txt variant="small" style={{ color: c.primary, fontWeight: '700' }}>
              {showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            </Txt>
          </Pressable>

          {formError ? (
            <Note tone="danger" icon="alert-circle-outline" style={{ marginBottom: space.lg }}>
              {formError}
            </Note>
          ) : null}

          <Button title={t.signIn} iconRight="log-in-outline" onPress={submit} loading={loading} />
          <Button title="Usar cuenta de prueba" variant="secondary" icon="person-circle-outline" onPress={fillDemo} style={{ marginTop: space.sm }} />
          <Txt variant="small" style={{ textAlign: 'center', marginTop: space.md }}>
            Cuenta demo: {DEMO_EMAIL[role]} · contraseña demo123
          </Txt>
        </View>

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          {canRegister ? (
            <Pressable onPress={() => router.push({ pathname: '/register', params: { role } })} style={styles.link} accessibilityRole="link">
              <Text style={styles.linkText}>{role === 'driver' ? 'Crear cuenta de conductor' : 'Crear cuenta de anfitrión'}</Text>
            </Pressable>
          ) : (
            <Text style={styles.footNote}>
              El alta de parqueaderos formales se hace con el equipo comercial al contratar un plan (supuesto: no está documentado un registro autónomo).
            </Text>
          )}
          <Text style={styles.footNote}>Autenticación simulada: no hay cuentas reales.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.navy },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.md },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8, marginBottom: space.lg },
  brand: { color: c.onBrandAccent, fontSize: font.xs, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase', marginTop: space.xxl },
  headline: { color: c.white, fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 40, marginTop: space.md },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: font.sm, lineHeight: 22, marginTop: space.sm, maxWidth: 300 },
  card: { backgroundColor: c.card, borderRadius: radius.xl, padding: space.xl, marginTop: space.xxl },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: c.white, fontSize: font.sm, fontWeight: '800', textDecorationLine: 'underline' },
  footNote: { color: 'rgba(255,255,255,0.6)', fontSize: font.xs, textAlign: 'center', lineHeight: 18 },
});
