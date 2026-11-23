import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Header } from '../../components/layout';
import { Badge, Button, Card, Note, Row, SectionTitle, Segmented, Txt } from '../../components/ui';
import { ErrorState, LoadingState } from '../../components/states';
import { AvailabilityBadge, ConditionGrid, KindTag, SpaceThumb, VehicleIcon, rateLabel } from '../../components/parking';
import { api } from '../../api';
import { useQuery } from '../../state/useQuery';
import { AVAILABILITY, RATE_UNITS, VEHICLES } from '../../domain/rules';
import { formatCOP, formatDistance } from '../../utils/format';
import { font, radius, space } from '../../theme';
import { useStyles, useTheme } from '../../state/Preferences';

const IDENTITY = {
  pending: { label: 'Verificación de identidad pendiente', tone: 'warning' },
  in_review: { label: 'Verificación de identidad en revisión', tone: 'warning' },
  verified: { label: 'Identidad verificada', tone: 'success' },
};

export default function SpaceDetail() {
  const { id, vehicle: initialVehicle = 'car' } = useLocalSearchParams();
  const router = useRouter();
  const [vehicle, setVehicle] = useState(initialVehicle);
  const colors = useTheme();
  const styles = useStyles(makeStyles);
  // Solo la primera consulta cuenta como "visita" para las métricas del dueño.
  const tracked = useRef(false);
  const { data: s, loading, error, reload } = useQuery(() => {
    const track = !tracked.current;
    tracked.current = true;
    return api.getSpace(id, track);
  }, [id]);

  if (!s) {
    return (
      <Screen header={<Header back title="Detalle" />}>
        {loading ? <LoadingState /> : <ErrorState error={error} onRetry={reload} />}
      </Screen>
    );
  }

  const accepted = Object.keys(VEHICLES).filter((v) => s.capacity[v] > 0 && s.rates[v]);
  const current = accepted.includes(vehicle) ? vehicle : accepted[0];
  const a = s.availability[current];
  const canReserve = a.status === 'available' || a.status === 'few';

  return (
    <Screen
      header={<Header back title="Detalle del parqueadero" />}
      onRefresh={reload}
      refreshing={loading}
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{formatCOP(s.rates[current].price)}</Txt>
            <Txt variant="small">{RATE_UNITS[s.rates[current].unit].label}</Txt>
          </View>
          <Button
            title={canReserve ? 'Reservar este cupo' : AVAILABILITY[a.status].label}
            iconRight={canReserve ? 'chevron-forward' : undefined}
            disabled={!canReserve}
            onPress={() => router.push({ pathname: `/reserve/${s.id}`, params: { vehicle: current } })}
            style={{ flex: 1.3 }}
          />
        </View>
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroStreet} />
        <View style={[styles.heroStreet, { top: '62%', transform: [{ rotate: '-24deg' }] }]} />
        <View style={styles.heroThumb}>
          <SpaceThumb space={s} size={64} />
        </View>
        <View style={styles.heroBadge}>
          <Ionicons name="navigate" size={13} color={colors.white} />
          <Text style={styles.heroBadgeText}>{formatDistance(s.distanceM)} de tu destino</Text>
        </View>
      </View>

      <View style={{ marginTop: space.lg }}>
        <KindTag kind={s.kind} hostType={s.hostType} />
      </View>
      <Txt variant="h2" style={{ marginTop: 4 }}>
        {s.name}
      </Txt>
      <Txt variant="muted" style={{ marginTop: 2 }}>
        {s.address} · {s.schedule.days} {s.schedule.open} – {s.schedule.close}
      </Txt>

      <View style={styles.stats}>
        <Stat value={canReserve ? String(a.free) : '0'} label={a.free === 1 ? 'cupo libre' : 'cupos libres'} styles={styles} />
        <Stat value={formatCOP(s.rates[current].price)} label={RATE_UNITS[s.rates[current].unit].label} styles={styles} />
        <Stat value={formatDistance(s.distanceM)} label="del destino" styles={styles} />
      </View>

      {accepted.length > 1 ? (
        <View style={{ marginTop: space.lg }}>
          <Segmented options={accepted.map((v) => ({ value: v, label: VEHICLES[v].label }))} value={current} onChange={setVehicle} />
        </View>
      ) : null}

      <Card style={{ marginTop: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <VehicleIcon vehicle={current} size={22} color={colors.accent} />
            <Txt variant="title">Disponibilidad ahora</Txt>
          </View>
          <AvailabilityBadge availability={s.availability} vehicle={current} />
        </View>
        <Txt variant="muted" style={{ marginTop: space.sm }}>
          {canReserve
            ? `${a.free === 1 ? 'Queda 1 cupo libre' : `Quedan ${a.free} cupos libres`} de ${a.capacity} para ${VEHICLES[current].label.toLowerCase()}. Al reservar, el cupo queda apartado mientras vas en camino.`
            : a.status === 'full'
              ? 'No hay cupos libres en este momento. Vuelve atrás para ver alternativas cercanas.'
              : 'Este espacio no está recibiendo reservas ahora.'}
        </Txt>
        {!canReserve ? <Button title="Ver otras opciones" variant="secondary" onPress={() => router.back()} style={{ marginTop: space.md }} /> : null}
      </Card>

      <SectionTitle title="Tarifas" />
      <Card>
        {accepted.map((v, i) => (
          <View key={v}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: colors.border }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10 }}>
              <VehicleIcon vehicle={v} />
              <Txt style={{ flex: 1, color: colors.textMuted }}>{VEHICLES[v].label}</Txt>
              <Txt variant="title">{rateLabel(s.rates[v])}</Txt>
            </View>
          </View>
        ))}
        <Txt variant="small" style={{ marginTop: space.xs }}>
          Tarifa publicada por {s.kind === 'formal' ? 'el parqueadero' : 'el anfitrión'}. Sin cargos adicionales para el conductor.
        </Txt>
      </Card>

      <SectionTitle title="Condiciones" />
      <ConditionGrid conditions={s.conditions} capacity={s.capacity} />

      <SectionTitle title="Horario" />
      <Card>
        <Row icon="time-outline" label={s.schedule.days} value={`${s.schedule.open} – ${s.schedule.close}`} />
      </Card>

      {s.kind === 'particular' && s.host ? (
        <>
          <SectionTitle title="Anfitrión" />
          <Card>
            <Txt variant="title">{s.host.name}</Txt>
            <Badge {...IDENTITY[s.host.identity]} style={{ marginTop: space.sm }} />
            <Note style={{ marginTop: space.md }}>
              Espacio particular: Tu Espacio intermedia la reserva y el pago. Las reglas de verificación, calificaciones y responsabilidad por daños están por definir con el área legal.
            </Note>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Stat({ value, label, styles }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (c) => ({
  hero: { height: 176, borderRadius: radius.lg, backgroundColor: c.mapWater, overflow: 'hidden', justifyContent: 'flex-end', padding: space.lg },
  heroStreet: { position: 'absolute', left: '-20%', width: '140%', top: '30%', height: 10, backgroundColor: c.mapStreet, transform: [{ rotate: '18deg' }] },
  heroThumb: { position: 'absolute', right: space.lg, top: space.lg },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: c.navy,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  heroBadgeText: { color: c.white, fontSize: font.xs, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  stat: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.sm, alignItems: 'center' },
  statValue: { fontSize: font.lg, fontWeight: '900', color: c.heading },
  statLabel: { fontSize: 11, color: c.textMuted, marginTop: 2 },
});
