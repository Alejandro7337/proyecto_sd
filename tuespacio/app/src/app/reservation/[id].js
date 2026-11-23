import { useState } from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Header } from '../../components/layout';
import { Button, Card, Divider, Note, Row, SectionTitle, Txt } from '../../components/ui';
import { ErrorState, LoadingState } from '../../components/states';
import { ConditionInline, ReservationBadge, VehicleIcon, rateLabel } from '../../components/parking';
import { api } from '../../api';
import { describeError } from '../../api/errors';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';
import { VEHICLES } from '../../domain/rules';
import { formatCOP, formatDateTime, formatDuration, formatTime } from '../../utils/format';
import { font, radius, space } from '../../theme';
import { useStyles, useTheme } from '../../state/Preferences';

export default function ReservationDetail() {
  const { id, fresh } = useLocalSearchParams();
  const router = useRouter();
  const { invalidate, showToast } = useApp();
  const colors = useTheme();
  const styles = useStyles(makeStyles);
  const { data: r, loading, error, reload } = useQuery(() => api.getReservation(id), [id]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  if (!r) {
    return (
      <Screen header={<Header back title="Reserva" />}>
        {loading ? <LoadingState /> : <ErrorState error={error} onRetry={reload} />}
      </Screen>
    );
  }

  const run = async (kind, fn, message) => {
    setBusy(kind);
    setActionError(null);
    try {
      await fn(r.id);
      invalidate();
      showToast(message);
      setConfirmCancel(false);
    } catch (e) {
      setActionError(describeError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const footer =
    r.status === 'confirmed' ? (
      confirmCancel ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="muted" style={{ textAlign: 'center' }}>
            ¿Cancelar la reserva {r.code}? El cupo se libera para otros conductores.
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="No, mantener" variant="secondary" onPress={() => setConfirmCancel(false)} style={{ flex: 1 }} />
            <Button title="Sí, cancelar" variant="danger" loading={busy === 'cancel'} onPress={() => run('cancel', api.cancelReservation, 'Reserva cancelada')} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button title="Llegué: registrar entrada" icon="enter-outline" loading={busy === 'in'} onPress={() => run('in', api.checkIn, 'Entrada registrada')} />
          <Button title="Cancelar reserva" variant="danger" onPress={() => setConfirmCancel(true)} />
        </View>
      )
    ) : r.status === 'active' ? (
      <Button title="Registrar salida" icon="exit-outline" loading={busy === 'out'} onPress={() => run('out', api.checkOut, 'Salida registrada. ¡Buen viaje!')} />
    ) : (
      <Button title="Buscar otro parqueadero" variant="secondary" onPress={() => router.dismissTo('/driver')} />
    );

  return (
    <Screen header={<Header back title="Tu reserva" subtitle={r.space.name} />} footer={footer} onRefresh={reload} refreshing={loading}>
      {fresh === '1' && r.status === 'confirmed' ? (
        <View style={styles.success}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={44} color={colors.successSolid} />
          </View>
          <Txt variant="h1" style={{ marginTop: space.lg, textAlign: 'center' }}>
            ¡Tu cupo está listo!
          </Txt>
          <Txt variant="muted" style={{ marginTop: space.xs, textAlign: 'center' }}>
            Presenta este código al llegar a {r.space.name}. Llega directo y entra.
          </Txt>
        </View>
      ) : null}

      <View style={styles.ticket}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.ticketLabel}>Código de reserva</Text>
          <ReservationBadge status={r.status} />
        </View>
        <Text style={styles.code} selectable>
          {r.code}
        </Text>
        <Text style={styles.ticketHint}>Muéstralo en la entrada si te lo piden (supuesto: el procedimiento de ingreso está por definir).</Text>
        <Text style={styles.ticketPaid}>
          {r.payment.status === 'refunded' ? 'Reembolsada' : 'Reserva pagada'} · {formatCOP(r.amount)}
        </Text>
        <View style={styles.ticketRow}>
          <View>
            <Text style={styles.ticketLabel}>Llegada</Text>
            <Text style={styles.ticketValue}>{formatTime(r.startAt)}</Text>
          </View>
          <View>
            <Text style={styles.ticketLabel}>Hasta</Text>
            <Text style={styles.ticketValue}>{formatTime(r.endAt)}</Text>
          </View>
          <View>
            <Text style={styles.ticketLabel}>Vehículo</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <VehicleIcon vehicle={r.vehicle} color={colors.white} />
              <Text style={styles.ticketValue}>{VEHICLES[r.vehicle].label}</Text>
            </View>
          </View>
        </View>
      </View>

      {actionError ? (
        <Note tone="danger" icon="alert-circle-outline" style={{ marginTop: space.lg }}>
          {actionError}
        </Note>
      ) : null}

      <SectionTitle title="Lugar" />
      <Card>
        <Txt variant="title">{r.space.name}</Txt>
        <Txt variant="small" style={{ marginTop: 2, marginBottom: space.md }}>
          {r.space.address}
        </Txt>
        <ConditionInline conditions={r.space.conditions} />
        <Button title="Ver detalle del lugar" variant="ghost" size="sm" onPress={() => router.push({ pathname: `/space/${r.space.id}`, params: { vehicle: r.vehicle } })} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
      </Card>

      <SectionTitle title="Pago" />
      <Card>
        <Row label="Fecha" value={formatDateTime(r.startAt)} />
        <Row label="Tarifa" value={rateLabel(r.space.rate)} />
        <Row label="Tiempo" value={formatDuration(r.durationMin)} />
        <Divider />
        <Row label={r.payment.status === 'refunded' ? 'Reembolsado (simulado)' : 'Pagado (simulado)'} value={formatCOP(r.amount)} strong />
        <Txt variant="small" style={{ marginTop: space.xs }}>
          {r.payment.method}
        </Txt>
      </Card>
      {r.status === 'confirmed' ? (
        <Note tone="warning" icon="help-circle-outline" style={{ marginTop: space.md }}>
          Política de cancelación, reembolso y tolerancia de llegada: por definir. En el prototipo, cancelar libera el cupo y simula el reembolso total.
        </Note>
      ) : null}
    </Screen>
  );
}

const makeStyles = (c) => ({
  success: { alignItems: 'center', paddingTop: space.md, paddingBottom: space.xxl },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center' },
  ticket: { backgroundColor: c.navy, borderRadius: radius.lg, padding: space.xl, borderWidth: c.dark ? 1 : 0, borderColor: c.border },
  ticketLabel: { color: 'rgba(255,255,255,0.65)', fontSize: font.xs, fontWeight: '600' },
  code: { color: c.white, fontSize: 44, fontWeight: '900', letterSpacing: 6, marginTop: space.sm },
  ticketHint: { color: 'rgba(255,255,255,0.6)', fontSize: font.xs, marginTop: space.xs, lineHeight: 17 },
  ticketPaid: { color: c.accent, fontSize: font.sm, fontWeight: '800', marginTop: space.md },
  ticketRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)' },
  ticketValue: { color: c.white, fontSize: font.md, fontWeight: '800', marginTop: 2 },
});
