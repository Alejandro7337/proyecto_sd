import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Header } from '../components/layout';
import { Button, Chip, Note, TextField, Txt } from '../components/ui';
import { api } from '../api';
import { describeError } from '../api/errors';
import { useApp } from '../state/AppContext';
import { ROLES, VEHICLES } from '../domain/rules';
import { isValidEmail } from '../utils/format';
import { space } from '../theme';

export default function Register() {
  const { role = 'driver' } = useLocalSearchParams();
  const router = useRouter();
  const { signIn, showToast } = useApp();
  const [form, setForm] = useState({ name: '', email: '', password: '', vehicle: role === 'driver' ? 'car' : undefined });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const next = {};
    if (form.name.trim().length < 3) next.name = 'Escribe tu nombre completo.';
    if (!isValidEmail(form.email)) next.email = 'Escribe un correo válido.';
    if (form.password.length < 6) next.password = 'Mínimo 6 caracteres.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      const session = await api.register({ ...form, role });
      signIn(session);
      showToast('Cuenta creada');
      router.dismissAll();
      router.replace(ROLES[role].home);
    } catch (e) {
      if (e.details?.fields) setErrors(e.details.fields);
      setFormError(describeError(e).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen header={<Header back title="Crear cuenta" subtitle={ROLES[role].label} />}>
      <TextField label="Nombre completo" value={form.name} onChangeText={set('name')} error={errors.name} placeholder="Nombre y apellido" />
      <TextField
        label="Correo"
        value={form.email}
        onChangeText={set('email')}
        error={errors.email}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="tucorreo@dominio.com"
      />
      <TextField
        label="Contraseña"
        value={form.password}
        onChangeText={set('password')}
        error={errors.password}
        secureTextEntry
        placeholder="Mínimo 6 caracteres"
      />
      {role === 'driver' ? (
        <View style={{ marginBottom: space.lg }}>
          <Txt variant="title" style={{ fontSize: 14, marginBottom: 6 }}>
            ¿Qué vehículo usas?
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {Object.entries(VEHICLES).map(([k, v]) => (
              <Chip key={k} label={v.label} selected={form.vehicle === k} onPress={() => set('vehicle')(k)} />
            ))}
          </View>
          <Txt variant="small" style={{ marginTop: 6 }}>
            Lo usamos para mostrarte solo espacios que reciben tu vehículo. Puedes cambiarlo al buscar.
          </Txt>
        </View>
      ) : (
        <Note style={{ marginBottom: space.lg }}>
          Para publicar tu espacio deberás completar la verificación de identidad. Ese proceso está por definir con el área legal; aquí se simula.
        </Note>
      )}
      {formError ? (
        <Note tone="danger" icon="alert-circle-outline" style={{ marginBottom: space.lg }}>
          {formError}
        </Note>
      ) : null}
      <Button title="Crear cuenta" onPress={submit} loading={loading} />
      <Txt variant="small" style={{ textAlign: 'center', marginTop: space.lg }}>
        Registro simulado: los datos solo viven en este dispositivo mientras la app está abierta.
      </Txt>
    </Screen>
  );
}
