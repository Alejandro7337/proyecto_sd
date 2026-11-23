import { Text, View } from 'react-native';
import { Screen, Header } from '../../components/layout';
import { Card, Divider, Note, Row, SectionTitle, Txt } from '../../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { ReservationBadge } from '../../components/parking';
import { api } from '../../api';
import { useQuery } from '../../state/useQuery';
import { formatCOP, formatDay } from '../../utils/format';
import { font, space } from '../../theme';
import { useTheme } from '../../state/Preferences';

export default function HostEarnings() {
  const { data, loading, error, reload } = useQuery(() => api.hostEarnings(), []);
  const colors = useTheme();

  if (!data) {
    return (
      <Screen header={<Header title="Ingresos" />}>
        {loading ? <LoadingState /> : <ErrorState error={error} onRetry={reload} />}
      </Screen>
    );
  }

  return (
    <Screen header={<Header title="Ingresos" subtitle="Reservas pagadas en la app (simulado)" />} onRefresh={reload} refreshing={loading}>
      <Card>
        <Txt variant="small">Total de reservas finalizadas</Txt>
        <Text style={{ fontSize: 36, fontWeight: '900', color: colors.heading, marginTop: 4 }}>{formatCOP(data.gross)}</Text>
        <Divider style={{ marginVertical: space.md }} />
        <Row label="Por finalizar" value={formatCOP(data.pending)} />
        <Row label="Comisión Tu Espacio" value={data.commissionRate === null ? 'Por definir' : `${data.commissionRate * 100} %`} />
        <Row label="Neto para ti" value={data.net === null ? 'Por definir' : formatCOP(data.net)} strong />
      </Card>
      <Note tone="warning" icon="help-circle-outline" style={{ marginTop: space.md }}>
        La comisión se cobra solo si hay reserva. Su porcentaje, la fecha de pago al anfitrión y el medio de giro están por definir en la Fase 0.
      </Note>

      <SectionTitle title="Movimientos" />
      {data.items.length === 0 ? (
        <EmptyState icon="wallet-outline" title="Sin movimientos" message="Cuando recibas reservas, verás aquí cada pago." />
      ) : (
        <Card>
          {data.items.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="title" style={{ fontSize: font.sm }} numberOfLines={1}>
                    {r.space.name}
                  </Txt>
                  <Txt variant="small">
                    {formatDay(r.startAt)} · {r.driverName} · {r.code}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Txt variant="title" style={{ fontSize: font.sm }}>
                    {formatCOP(r.amount)}
                  </Txt>
                  <ReservationBadge status={r.status} />
                </View>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
