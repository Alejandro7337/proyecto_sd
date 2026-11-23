import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Header } from '../../components/layout';
import { Badge, Button, Card, SectionTitle, Txt } from '../../components/ui';
import { ErrorState, LoadingState, EmptyState } from '../../components/states';
import { AvailabilityBadge, ReservationCard, VehicleIcon } from '../../components/parking';
import { api } from '../../api';
import { describeError } from '../../api/errors';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';
import { VEHICLES } from '../../domain/rules';
import { font, radius, space } from '../../theme';
import { useStyles, useTheme } from '../../state/Preferences';

export default function OwnerDashboard() {
  const router = useRouter();
  const { invalidate, showToast } = useApp();
  const colors = useTheme();
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState(null);
  const panel = useQuery(() => api.ownerSpace(), []);
  const bookings = useQuery(() => (panel.data ? api.spaceReservations(panel.data.space.id) : Promise.resolve([])), [panel.data?.space.id], {
    enabled: !!panel.data,
  });

  if (!panel.data) {
    return (
      <Screen header={<Header title="Resumen" />}>
        {panel.loading ? <LoadingState /> : <ErrorState error={panel.error} onRetry={panel.reload} />}
      </Screen>
    );
  }

  const { space: s, plan, metrics } = panel.data;
  const vehicles = Object.keys(VEHICLES).filter((v) => s.capacity[v] > 0);
  const views = metrics.views.reduce((a, b) => a + b, 0);
  const booked = metrics.reservations.reduce((a, b) => a + b, 0);
  const upcoming = (bookings.data || []).filter((r) => r.status === 'confirmed').slice(0, 3);

  const adjust = async (vehicle, delta) => {
    setBusy(vehicle + delta);
    try {
      await api.adjustOccupancy(s.id, vehicle, delta);
      invalidate();
      showToast(delta > 0 ? `Entrada registrada (${VEHICLES[vehicle].label.toLowerCase()})` : `Salida registrada (${VEHICLES[vehicle].label.toLowerCase()})`);
    } catch (e) {
      showToast(describeError(e).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      header={<Header title={s.name} subtitle={s.address} right={<Badge label={`Plan ${plan}`} tone="info" icon="ribbon-outline" />} />}
      onRefresh={panel.reload}
      refreshing={panel.loading}
    >
      {s.status !== 'published' ? (
        <Card style={{ marginBottom: space.lg, borderColor: colors.warningSolid, borderWidth: 2 }}>
          <Txt variant="title">Tu parqueadero está pausado</Txt>
          <Txt variant="muted" style={{ marginTop: 4 }}>
            No apareces en el mapa ni recibes reservas nuevas.
          </Txt>
          <Button title="Ir a publicación" variant="secondary" size="sm" onPress={() => router.navigate('/owner/settings')} style={{ marginTop: space.md, alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      <Txt variant="eyebrow" style={{ marginBottom: space.md }}>
        Ocupación ahora
      </Txt>
      {vehicles.map((v) => {
        const a = s.availability[v];
        const pct = (n) => `${(n / a.capacity) * 100}%`;
        return (
          <Card key={v} style={{ marginBottom: space.md }}>
            <View style={styles.occTop}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <VehicleIcon vehicle={v} size={22} color={colors.accent} />
                <Txt variant="title">{VEHICLES[v].label}s</Txt>
              </View>
              <AvailabilityBadge availability={s.availability} vehicle={v} />
            </View>
            <Text style={styles.big}>
              {a.free}
              <Text style={styles.bigOf}> libres de {a.capacity}</Text>
            </Text>
            <View style={styles.bar} accessibilityLabel={`${a.occupied} sin reserva, ${a.reserved} con reserva, ${a.free} libres`}>
              <View style={{ width: pct(a.occupied), backgroundColor: colors.dark ? colors.white : colors.navy }} />
              <View style={{ width: pct(a.reserved + a.held), backgroundColor: colors.accent }} />
            </View>
            <View style={styles.legend}>
              <Legend color={colors.dark ? colors.white : colors.navy} label={`${a.occupied} sin reserva`} />
              <Legend color={colors.accent} label={`${a.reserved + a.held} con reserva`} />
              <Legend color={colors.border} label={`${a.free} libres`} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button title="Entrada" icon="add" size="sm" variant="secondary" loading={busy === v + 1} onPress={() => adjust(v, 1)} style={{ flex: 1 }} />
              <Button title="Salida" icon="remove" size="sm" variant="secondary" loading={busy === v + -1} onPress={() => adjust(v, -1)} style={{ flex: 1 }} />
            </View>
            <Txt variant="small" style={{ marginTop: space.sm }}>
              Registra vehículos que llegan sin reserva para que el cupo publicado sea real.
            </Txt>
          </Card>
        );
      })}

      <SectionTitle title="Demanda (últimos 7 días)" />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.metric}>{views}</Text>
          <Txt variant="small">conductores vieron tu parqueadero</Txt>
          <Txt variant="small" style={{ marginTop: 4, color: colors.primary, fontWeight: '700' }}>
            Hoy: {metrics.views[6]}
          </Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.metric}>{booked}</Text>
          <Txt variant="small">reservaron desde la app</Txt>
          <Txt variant="small" style={{ marginTop: 4, color: colors.primary, fontWeight: '700' }}>
            Hoy: {metrics.reservations[6]}
          </Txt>
        </Card>
      </View>
      <Txt variant="small" style={{ marginTop: space.sm }}>
        Con tu plan de mensualidad no pagas comisión: conservas el 100 % de tu tarifa.
      </Txt>

      <SectionTitle
        title="Próximas llegadas"
        action={<Button title="Ver todas" variant="ghost" size="sm" onPress={() => router.navigate('/owner/bookings')} />}
      />
      {upcoming.length === 0 ? (
        <EmptyState icon="calendar-clear-outline" title="Sin llegadas próximas" message="Las nuevas reservas aparecerán aquí." />
      ) : (
        upcoming.map((r) => (
          <ReservationCard key={r.id} r={r} showDriver />
        ))
      )}
    </Screen>
  );
}

function Legend({ color, label }) {
  const colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: font.xs, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors) => ({
  occTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big: { fontSize: 36, fontWeight: '900', color: colors.heading, marginTop: space.md },
  bigOf: { fontSize: font.md, fontWeight: '500', color: colors.textMuted },
  bar: { flexDirection: 'row', height: 10, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden', marginTop: space.md },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  metric: { fontSize: font.xxl, fontWeight: '900', color: colors.heading },
});
