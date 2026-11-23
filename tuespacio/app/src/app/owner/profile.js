import { View } from 'react-native';
import { ProfileScreen, PendingNote } from '../../components/ProfileScreen';
import { Badge, Card, SectionTitle, Txt } from '../../components/ui';
import { useApp } from '../../state/AppContext';
import { PLANS } from '../../domain/rules';
import { space } from '../../theme';
import { useTheme } from '../../state/Preferences';

export default function OwnerProfile() {
  const { user } = useApp();
  const colors = useTheme();
  return (
    <ProfileScreen>
      <SectionTitle title="Mensualidad" />
      {PLANS.map((p) => (
        <Card key={p} style={{ marginBottom: space.md, ...(user.plan === p ? { borderColor: colors.accent, borderWidth: 2 } : null) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="title">Plan {p}</Txt>
            {user.plan === p ? <Badge label="Tu plan" tone="info" /> : null}
          </View>
          <Txt variant="muted" style={{ marginTop: 4 }}>
            Precio: por definir en Fase 0
          </Txt>
        </Card>
      ))}
      <PendingNote>
        Los documentos definen los planes Básico y Destacado y una cuota fija sin comisión por reserva. Precios, beneficios de cada plan y facturación aún no están definidos.
      </PendingNote>
    </ProfileScreen>
  );
}
