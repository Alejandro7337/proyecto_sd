import { useState } from 'react';
import { View } from 'react-native';
import { ProfileScreen } from '../../components/ProfileScreen';
import { Card, Chip, ListRow, SectionTitle, Txt } from '../../components/ui';
import { api } from '../../api';
import { describeError } from '../../api/errors';
import { useApp } from '../../state/AppContext';
import { VEHICLES } from '../../domain/rules';
import { space } from '../../theme';

export default function DriverProfile() {
  const { user, updateUser, showToast } = useApp();
  const [saving, setSaving] = useState(null);

  const choose = async (vehicle) => {
    if (vehicle === user.vehicle) return;
    setSaving(vehicle);
    try {
      updateUser(await api.updateMe({ vehicle }));
      showToast('Vehículo actualizado');
    } catch (e) {
      showToast(describeError(e).title, 'danger');
    } finally {
      setSaving(null);
    }
  };

  return (
    <ProfileScreen>
      <SectionTitle title="Mis vehículos" />
      <Card>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {Object.entries(VEHICLES).map(([k, v]) => (
            <Chip key={k} label={saving === k ? 'Guardando…' : v.label} selected={user.vehicle === k} onPress={() => choose(k)} />
          ))}
        </View>
        <Txt variant="small" style={{ marginTop: space.md }}>
          Usar Tu Espacio es gratis para conductores: sin suscripción. Solo pagas la tarifa del lugar que reservas.
        </Txt>
      </Card>

      <SectionTitle title="Pagos y facturación" />
      <Card style={{ padding: 0 }}>
        <ListRow icon="card-outline" label="Medio de pago de prueba" detail="•••• 4242 · Simulado, sin cobros reales" last />
      </Card>
    </ProfileScreen>
  );
}
