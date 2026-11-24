import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Header } from '../../components/layout';
import { Badge, Button, Card, Chip, Divider, IconCircle, Note, Row, SectionTitle, Txt } from '../../components/ui';
import { ErrorState, LoadingState } from '../../components/states';
import { SpaceCard, VehicleIcon, rateLabel } from '../../components/parking';
import { api, newIdempotencyKey } from '../../api';
import { describeError } from '../../api/errors';
import { faults, setFault } from '../../api/mock/demoControls';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';
import { ARRIVAL_OPTIONS, DURATION_OPTIONS, HOLD_MINUTES, SCHEDULE_ISSUES, VEHICLES, estimateCost, scheduleIssue } from '../../domain/rules';
import { isDemoMode } from '../../api/transport';
import { formatCOP, formatDuration, formatTime } from '../../utils/format';
import { font, radius, space } from '../../theme';
import { useStyles, useTheme } from '../../state/Preferences';

const STEPS = ['Apartando tu cupo', 'Autorizando el pago', 'Confirmando la reserva'];

const SIMULATIONS = [
  { value: 'none', label: 'Resultado normal' },
  { value: 'taken', label: 'Cupo tomado' },
  { value: 'declined', label: 'Pago rechazado' },
  { value: 'timeout', label: 'Pasarela sin respuesta' },
  { value: 'expired', label: 'Retención vencida' },
];

export default function Reserve() {
  const { id, vehicle = 'car' } = useLocalSearchParams();
  const router = useRouter();
  const { invalidate, showToast } = useApp();
  const colors = useTheme();
  const styles = useStyles(makeStyles);
  const { data: s, loading, error, reload } = useQuery(() => api.getSpace(id), [id]);

  const [arrival, setArrival] = useState(30);
  const [duration, setDuration] = useState(120);
  const [simulation, setSimulation] = useState(faults.nextReservation);
  const [phase, setPhase] = useState('form'); // form | processing | error
  const [step, setStep] = useState(0);
  const [failure, setFailure] = useState(null);
  const idemKey = useRef(newIdempotencyKey());
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  if (!s) {
    return (
      <Screen header={<Header back title="Reservar" />}>
        {loading ? <LoadingState /> : <ErrorState error={error} onRetry={reload} />}
      </Screen>
    );
  }

  const rate = s.rates[vehicle];
  const amount = estimateCost(rate, duration);
  // La hora de llegada se recalcula en cada render a propósito: refleja "ahora + llegada".
  // eslint-disable-next-line react-hooks/purity
  const startAt = new Date(Date.now() + arrival * 60000);
  const endAt = new Date(startAt.getTime() + duration * 60000);
  // Misma regla que aplica el servidor: se avisa antes de enviar en lugar de fallar después.
  const outsideSchedule = scheduleIssue(s.schedule, startAt, endAt);

  const submit = async () => {
    if (isDemoMode) setFault('nextReservation', simulation);
    setPhase('processing');
    setStep(0);
    setFailure(null);
    timer.current = setInterval(() => setStep((x) => Math.min(x + 1, STEPS.length - 1)), 650);
    try {
      const r = await api.createReservation({
        spaceId: s.id,
        vehicle,
        startAt: startAt.toISOString(),
        durationMin: duration,
        idempotencyKey: idemKey.current,
      });
      clearInterval(timer.current);
      invalidate();
      showToast(`Reserva confirmada · ${r.code}`);
      router.replace({ pathname: `/reservation/${r.id}`, params: { fresh: '1' } });
    } catch (e) {
      clearInterval(timer.current);
      // Un fallo de red puede reintentarse con la misma llave; un aborto definitivo usa una nueva.
      if (e.code !== 'NETWORK' && e.code !== 'TIMEOUT') idemKey.current = newIdempotencyKey();
      setSimulation('none');
      setFailure(e);
      setPhase('error');
      invalidate();
    }
  };

  if (phase === 'processing') {
    return (
      <Screen header={<Header title="Procesando reserva" subtitle={s.name} />}>
        <Card style={{ marginTop: space.lg }}>
          {STEPS.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <View key={label} style={styles.step}>
                <View style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent]}>
                  {done ? <Ionicons name="checkmark" size={14} color={colors.white} /> : <Text style={styles.stepNum}>{i + 1}</Text>}
                </View>
                <Text style={[styles.stepText, (done || current) && { color: colors.text, fontWeight: '700' }]}>
                  {label}
                  {current ? '…' : ''}
                </Text>
              </View>
            );
          })}
        </Card>
        <Note style={{ marginTop: space.lg }}>
          Mientras confirmamos, el cupo queda retenido hasta {HOLD_MINUTES} minutos. Si algo falla, se libera y no se realiza ningún cobro.
        </Note>
      </Screen>
    );
  }

  if (phase === 'error') {
    const copy = describeError(failure);
    const alternatives = failure.details?.alternatives || [];
    return (
      <Screen
        header={<Header back title="No se pudo reservar" />}
        footer={
          <View style={{ gap: space.sm }}>
            {failure.code !== 'SPACE_TAKEN' ? <Button title="Intentar de nuevo" icon="refresh" onPress={submit} /> : null}
            <Button title="Volver al mapa" variant="secondary" onPress={() => router.dismissTo('/driver')} />
          </View>
        }
      >
        <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
          <IconCircle name={failure.code === 'NETWORK' ? 'cloud-offline-outline' : 'close-circle-outline'} tone="danger" size={64} />
          <Txt variant="h2" style={{ marginTop: space.lg, textAlign: 'center' }}>
            {copy.title}
          </Txt>
          <Txt variant="muted" style={{ marginTop: space.sm, textAlign: 'center' }}>
            {copy.message}
          </Txt>
        </View>
        {failure.code === 'SPACE_TAKEN' ? (
          <>
            <SectionTitle title="Alternativas cercanas" />
            {alternatives.length ? (
              alternatives.map((alt) => (
                <SpaceCard key={alt.id} space={alt} vehicle={vehicle} onPress={() => router.replace({ pathname: `/space/${alt.id}`, params: { vehicle } })} />
              ))
            ) : (
              <Txt variant="muted">No hay otros espacios con cupo para tu vehículo en esta zona ahora mismo.</Txt>
            )}
          </>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header back title="Confirmar reserva" subtitle={s.name} />}
      footer={
        <Button
          title={`Reservar y pagar ${formatCOP(amount)}`}
          icon="lock-closed-outline"
          onPress={submit}
          disabled={!!outsideSchedule || (s.availability[vehicle].free <= 0 && simulation === 'none')}
        />
      }
    >
      <Card style={{ padding: space.xl }}>
        <Badge
          label={s.availability[vehicle].free > 0 ? 'Cupo disponible' : 'Sin cupos ahora'}
          tone={s.availability[vehicle].free > 0 ? 'success' : 'danger'}
        />
        <Txt variant="h2" style={{ marginTop: space.md, fontSize: 22 }}>
          {s.name}
        </Txt>
        <Txt variant="small" style={{ marginTop: 2 }}>
          {s.address}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md }}>
          <VehicleIcon vehicle={vehicle} size={20} color={colors.accent} />
          <Txt variant="title" style={{ flex: 1 }}>
            {VEHICLES[vehicle].label} · {rateLabel(rate)}
          </Txt>
        </View>
      </Card>

      <SectionTitle title="¿Cuándo llegas?" />
      <View style={styles.chips}>
        {ARRIVAL_OPTIONS.map((m) => (
          <Chip key={m} label={'En ' + formatDuration(m)} selected={arrival === m} onPress={() => setArrival(m)} />
        ))}
      </View>

      <SectionTitle title="¿Cuánto tiempo?" />
      <View style={styles.chips}>
        {DURATION_OPTIONS.map((m) => (
          <Chip key={m} label={formatDuration(m)} selected={duration === m} onPress={() => setDuration(m)} />
        ))}
      </View>
      <Txt variant="small" style={{ marginTop: space.sm }}>
        Cupo apartado de {formatTime(startAt)} a {formatTime(endAt)}.
      </Txt>
      {outsideSchedule ? (
        <Note tone="danger" icon="time-outline" style={{ marginTop: space.md }}>
          {SCHEDULE_ISSUES[outsideSchedule]} Horario: {s.schedule.days} {s.schedule.open} – {s.schedule.close}.
        </Note>
      ) : null}

      <SectionTitle title="Resumen" />
      <Card>
        <Row label="Tarifa" value={rateLabel(rate)} />
        <Row label="Tiempo reservado" value={formatDuration(duration)} />
        <Row label="Cargo por usar la app" value="$ 0" />
        <Divider />
        <Row label="Total a pagar" value={formatCOP(amount)} strong />
        <View style={styles.payment}>
          <Ionicons name="card-outline" size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Txt>Medio de pago de prueba •••• 4242</Txt>
            <Txt variant="small">{isDemoMode ? 'Simulado. No se realiza ningún cobro real.' : 'Medios de pago reales: pendientes de integrar (docs/PENDING_BUSINESS_DECISIONS.md).'}</Txt>
          </View>
        </View>
      </Card>
      <Note tone="warning" icon="help-circle-outline" style={{ marginTop: space.md }}>
        Supuestos del prototipo: el cálculo por hora iniciada, las opciones de llegada y duración, y los medios de pago reales están por definir.
      </Note>

      {isDemoMode ? (
      <View style={styles.sim}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm }}>
          <Ionicons name="flask-outline" size={16} color={colors.textMuted} />
          <Text style={styles.simTitle}>Solo prototipo · simular resultado</Text>
        </View>
        <View style={styles.chips}>
          {SIMULATIONS.map((o) => (
            <Chip key={o.value} label={o.label} selected={simulation === o.value} onPress={() => setSimulation(o.value)} />
          ))}
        </View>
      </View>
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  payment: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md, padding: space.md, backgroundColor: colors.surface, borderRadius: radius.md },
  sim: { marginTop: space.xxl, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  simTitle: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.successSolid, borderColor: colors.successSolid },
  stepCurrent: { borderColor: colors.accent },
  stepNum: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  stepText: { fontSize: font.md, color: colors.textMuted },
});
