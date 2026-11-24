// Presentación guiada y herramientas de demostración. Solo existen en modo demo (backend simulado):
// ningún botón de esta pantalla contacta servicios reales ni mueve dinero.
import { Text, View } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Screen, Header } from '../components/layout';
import { Badge, Button, Card, Chip, Note, SectionTitle, SwitchRow, Txt } from '../components/ui';
import { EmptyState } from '../components/states';
import { api } from '../api';
import { describeError } from '../api/errors';
import { faults, setFault } from '../api/mock/demoControls';
import { isDemoMode } from '../api/transport';
import { useApp } from '../state/AppContext';
import { useQuery } from '../state/useQuery';
import { HOLD_MINUTES, ROLES } from '../domain/rules';
import { formatCOP, formatTime } from '../utils/format';
import { font, radius, space } from '../theme';
import { useStyles, useTheme } from '../state/Preferences';

const OUTCOMES = [
  { value: 'none', label: 'Normal' },
  { value: 'taken', label: 'Cupo tomado' },
  { value: 'declined', label: 'Pago rechazado' },
  { value: 'timeout', label: 'Pasarela sin respuesta' },
  { value: 'expired', label: 'Retención vencida' },
];

// Escenarios que ejecuta el backend simulado con cuentas demo sobre un parqueadero 24 h.
const SCENARIOS = [
  { name: 'success', title: 'Reserva exitosa', shows: 'T11 → T12 → T21 → T22 → T23 → T13' },
  { name: 'taken', title: 'Cupo ocupado', shows: 'T11 falla · aborta antes de cobrar · alternativas' },
  { name: 'declined', title: 'Pago rechazado', shows: 'T21 falla · compensación C12 (libera el cupo)' },
  { name: 'timeout', title: 'Pasarela sin respuesta', shows: '3 reintentos con la misma llave · C12' },
  { name: 'expired', title: 'Retención vencida', shows: 'No captura · C22, C21 (anula preautorización), C12' },
  { name: 'idempotency', title: 'Idempotencia', shows: '3 envíos con la misma llave → 1 reserva, 1 cobro' },
  { name: 'race', title: 'Dos conductores, un cupo', shows: 'Solicitudes simultáneas: solo una gana' },
];

const ARCHITECTURE = [
  ['App (Expo Router)', 'Pantallas por rol. Solo hablan con src/api/index.js.'],
  ['Transporte', 'mock: backend simulado en la app · http: servidor real (EXPO_PUBLIC_API_URL).'],
  ['Autenticación', 'Sesión con vencimiento, acceso por rol.'],
  ['Catálogo', 'Destinos, espacios, condiciones, tarifas y horario.'],
  ['Reservas (coordinador T0)', 'Verifica, retiene, cobra y confirma; compensa si algo falla.'],
  ['Pagos', 'Preautoriza, captura, anula y reembolsa (pasarela simulada).'],
  ['Panel', 'Cupos, tarifas, horarios, métricas e ingresos de dueños y anfitriones.'],
];

const T0_STEPS = [
  ['T11', 'Verificar cupo libre', '—'],
  ['T12', `Retener el cupo (${HOLD_MINUTES} min)`, 'C12 liberar'],
  ['T21', 'Preautorizar el pago', 'C21 anular'],
  ['T22', 'Registrar tarifa y comisión', 'C22 reversar'],
  ['T23', 'Capturar el pago', 'reembolsar'],
  ['T13', 'Confirmar la reserva', 'cancelar'],
];

const STEP_TONE = { ok: 'success', fail: 'danger', comp: 'warning', retry: 'warning', start: 'primary', info: 'neutral' };
const STEP_LABEL = { ok: 'ok', fail: 'falla', comp: 'compensa', retry: 'reintento', start: 'inicio', info: 'info' };
const OUTCOME = {
  committed: { label: 'Confirmada', tone: 'success' },
  aborted: { label: 'Abortada', tone: 'danger' },
  running: { label: 'En curso', tone: 'info' },
};

export default function Demo() {
  const router = useRouter();
  const { offline, setOffline, resetDemoData, showToast, invalidate, user } = useApp();
  const styles = useStyles(makeStyles);
  const [next, setNext] = useState(faults.nextReservation);
  const [slow, setSlow] = useState(faults.latencyMs > 1000);
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const log = useQuery(() => (offline || !isDemoMode ? Promise.resolve(null) : api.demoTransactions()), [offline]);

  if (!isDemoMode) {
    return (
      <Screen header={<Header back title="Herramientas de demo" />}>
        <Note tone="warning" icon="shield-checkmark-outline">
          La app está conectada a un servidor real (modo HTTP). Las simulaciones y escenarios de demo están deshabilitados para no
          alterar datos reales.
        </Note>
      </Screen>
    );
  }

  const run = async (scenario) => {
    setRunning(scenario.name);
    setResult(null);
    try {
      const data = await api.demoScenario(scenario.name);
      setResult({ scenario, data });
    } catch (e) {
      setResult({ scenario, error: describeError(e) });
    } finally {
      setRunning(null);
      setNext('none');
      invalidate();
    }
  };

  return (
    <Screen header={<Header back title="Presentación guiada" subtitle="Modo demo · datos ficticios" />}>
      <Note icon="flask-outline">
        Modo demo: el backend está simulado dentro de la app. Los parqueaderos, personas, tarifas y pagos son ficticios y
        ningún botón realiza cobros. En modo real (HTTP) esta pantalla se desactiva.
      </Note>

      <SectionTitle title="1 · Arquitectura" />
      <Card>
        {ARCHITECTURE.map(([title, text]) => (
          <View key={title} style={styles.archRow}>
            <Text style={styles.archTitle}>{title}</Text>
            <Text style={styles.archText}>{text}</Text>
          </View>
        ))}
        <Txt variant="title" style={{ marginTop: space.md, marginBottom: space.xs }}>
          Transacción T0 «Reservar cupo con pago»
        </Txt>
        {T0_STEPS.map(([id, action, comp]) => (
          <View key={id} style={styles.t0Row}>
            <Text style={styles.stepId}>{id}</Text>
            <Text style={styles.archText}>{action}</Text>
            <Text style={styles.compText}>{comp}</Text>
          </View>
        ))}
        <Txt variant="small" style={{ marginTop: space.sm }}>
          T11 y T12 son atómicos (no hay sobreventa). La llave de idempotencia evita cobros dobles en reintentos.
        </Txt>
      </Card>

      <SectionTitle title="2 · Elige un rol" />
      <Card>
        {user ? (
          <Txt variant="small" style={{ marginBottom: space.sm }}>
            Sesión actual: {ROLES[user.role].label}. Al entrar con otro rol se reemplaza.
          </Txt>
        ) : null}
        <View style={{ gap: space.sm }}>
          {Object.entries(ROLES).map(([role, r]) => (
            <Button key={role} title={r.label} variant="secondary" icon="log-in-outline" onPress={() => router.push({ pathname: '/login', params: { role } })} />
          ))}
        </View>
        <Txt variant="small" style={{ marginTop: space.sm }}>
          En el login usa «Usar cuenta de prueba» (contraseña demo123).
        </Txt>
      </Card>

      <SectionTitle title="3 · Escenarios de la T0" />
      <Txt variant="muted" style={{ marginBottom: space.md }}>
        Cada escenario ejecuta la T0 del backend simulado con conductores demo en «Parqueadero Salud 127» (24 h). El resultado y
        cada paso quedan en el registro técnico (sección 6).
      </Txt>
      {SCENARIOS.map((sc) => (
        <Card key={sc.name} style={{ marginBottom: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="title">{sc.title}</Txt>
              <Txt variant="small">{sc.shows}</Txt>
            </View>
            <Button title="Ejecutar" size="sm" loading={running === sc.name} disabled={!!running || offline} onPress={() => run(sc)} />
          </View>
          {result?.scenario.name === sc.name ? <ScenarioResult result={result} /> : null}
        </Card>
      ))}
      {offline ? <Txt variant="small">Desactiva «sin conexión» para ejecutar escenarios.</Txt> : null}

      <SectionTitle title="4 · Red" />
      <Card>
        <SwitchRow label="Simular sin conexión" description="Todas las consultas fallan con error de red. Prueba navegar y reconectar." value={offline} onValueChange={setOffline} />
        <SwitchRow
          label="Red lenta"
          description="Aumenta la latencia para ver los estados de carga."
          value={slow}
          onValueChange={(v) => {
            setSlow(v);
            setFault('latencyMs', v ? 2200 : 650);
          }}
        />
      </Card>

      <SectionTitle title="5 · Próxima reserva hecha desde la app" />
      <Card>
        <Txt variant="muted" style={{ marginBottom: space.md }}>
          Fuerza el resultado de la próxima reserva que haga el conductor en la pantalla «Confirmar reserva».
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {OUTCOMES.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={next === o.value}
              onPress={() => {
                setNext(o.value);
                setFault('nextReservation', o.value);
              }}
            />
          ))}
        </View>
      </Card>

      <SectionTitle title="6 · Registro técnico (T0)" />
      {offline ? (
        <Txt variant="muted">Desactiva «sin conexión» para consultar el registro.</Txt>
      ) : !log.data || log.data.length === 0 ? (
        <EmptyState icon="git-network-outline" title="Sin transacciones todavía" message="Ejecuta un escenario o haz una reserva como conductor para ver cada subtransacción y sus compensaciones." />
      ) : (
        log.data.map((tx) => <TxCard key={tx.id} tx={tx} />)
      )}

      <SectionTitle title="7 · Reiniciar" />
      <Button
        title="Restablecer datos de demostración"
        icon="refresh"
        variant="secondary"
        onPress={() => {
          resetDemoData();
          setNext('none');
          setResult(null);
          showToast('Datos de demostración restablecidos');
        }}
      />
      <Txt variant="small" style={{ marginTop: space.sm }}>
        Vuelve a los cupos, reservas y espacios iniciales y borra el registro técnico. Las cuentas creadas se pierden.
      </Txt>
    </Screen>
  );
}

function ScenarioResult({ result }) {
  const styles = useStyles(makeStyles);
  if (result.error) {
    return (
      <Note tone="danger" style={{ marginTop: space.md }}>
        {result.error.title}: {result.error.message}
      </Note>
    );
  }
  const { data } = result;
  return (
    <View style={styles.result} accessibilityLiveRegion="polite">
      {data.results.map((r, i) => (
        <View key={i} style={styles.resultRow}>
          <Badge label={r.ok ? 'Confirmada' : 'Rechazada'} tone={r.ok ? 'success' : 'danger'} />
          <Text style={styles.resultText}>
            {r.driver}: {r.ok ? `reserva ${r.code} · ${formatCOP(r.amount)} (simulado)` : `${r.code} · ${describeError(r).title}`}
          </Text>
        </View>
      ))}
      {data.scenario === 'idempotency' ? (
        <Text style={styles.resultText}>
          {data.sameReservation ? 'Los tres envíos devolvieron la misma reserva.' : 'ATENCIÓN: se crearon reservas distintas.'} Transacciones cobradas:{' '}
          {data.transactionsCharged}.
        </Text>
      ) : null}
      {data.scenario === 'race' ? (
        <Text style={styles.resultText}>
          Cupos libres antes: {data.freeAtStart} · después: {data.freeAtEnd}. Sin sobreventa.
        </Text>
      ) : null}
    </View>
  );
}

function TxCard({ tx }) {
  const colors = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card style={{ marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="title" style={{ flex: 1 }} numberOfLines={1}>
          {tx.meta.space}
        </Txt>
        <Badge {...OUTCOME[tx.outcome]} />
      </View>
      <Txt variant="small" style={{ marginBottom: space.sm }}>
        {formatTime(tx.startedAt)} · {tx.meta.driver || 'conductor'} · llave {tx.meta.idempotencyKey.slice(0, 14)}…
      </Txt>
      {tx.steps.map((st, i) => (
        <View key={i} style={styles.step}>
          <Text style={[styles.stepId, { color: colors[STEP_TONE[st.status]] || colors.primary }]}>{st.step}</Text>
          <Text style={styles.stepStatus}>{STEP_LABEL[st.status] || st.status}</Text>
          <Text style={styles.stepDetail}>{st.detail}</Text>
        </View>
      ))}
    </Card>
  );
}

const makeStyles = (colors) => ({
  archRow: { paddingVertical: 4 },
  archTitle: { fontSize: font.sm, fontWeight: '800', color: colors.text },
  archText: { flex: 1, fontSize: font.xs, color: colors.textMuted, lineHeight: 16 },
  t0Row: { flexDirection: 'row', gap: space.sm, paddingVertical: 2 },
  compText: { fontSize: font.xs, color: colors.warning, fontWeight: '700' },
  result: { marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, gap: space.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  resultText: { flex: 1, fontSize: font.xs, color: colors.text, lineHeight: 16 },
  step: { flexDirection: 'row', gap: space.sm, paddingVertical: 3 },
  stepId: { width: 40, fontSize: font.xs, fontWeight: '800' },
  stepStatus: { width: 62, fontSize: font.xs, color: colors.textMuted },
  stepDetail: { flex: 1, fontSize: font.xs, color: colors.text, lineHeight: 16 },
});
