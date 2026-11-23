// Herramientas de demostración: solo existen en el prototipo.
import { Text, View } from 'react-native';
import { useState } from 'react';
import { Screen, Header } from '../components/layout';
import { Badge, Button, Card, Chip, Note, SectionTitle, SwitchRow, Txt } from '../components/ui';
import { EmptyState } from '../components/states';
import { api } from '../api';
import { faults, setFault } from '../api/mock/demoControls';
import { apiMode } from '../api/transport';
import { useApp } from '../state/AppContext';
import { useQuery } from '../state/useQuery';
import { formatTime } from '../utils/format';
import { font, space } from '../theme';
import { useStyles, useTheme } from '../state/Preferences';

const OUTCOMES = [
  { value: 'none', label: 'Normal' },
  { value: 'taken', label: 'Cupo tomado' },
  { value: 'declined', label: 'Pago rechazado' },
  { value: 'timeout', label: 'Pasarela sin respuesta' },
];

const STEP_TONE = { ok: 'success', fail: 'danger', comp: 'warning', retry: 'warning', start: 'primary', info: 'neutral' };
const OUTCOME = { committed: { label: 'Confirmada', tone: 'success' }, aborted: { label: 'Abortada', tone: 'danger' }, running: { label: 'En curso', tone: 'info' } };

export default function Demo() {
  const { offline, setOffline, resetDemoData, showToast, dataVersion } = useApp();
  const colors = useTheme();
  const styles = useStyles(makeStyles);
  const [next, setNext] = useState(faults.nextReservation);
  const [slow, setSlow] = useState(faults.latencyMs > 1000);
  const wasOffline = offline;
  const log = useQuery(() => (wasOffline ? Promise.resolve(null) : api.demoTransactions()), [wasOffline, dataVersion]);

  return (
    <Screen header={<Header back title="Herramientas de demo" subtitle="Solo prototipo" />}>
      <Note icon="flask-outline">
        Este prototipo no se conecta con pasarelas de pago, mapas, cámaras ni servicios reales. Todo lo que ves son datos y respuestas simuladas{apiMode === 'mock' ? ' dentro de la app' : ''}.
      </Note>

      <SectionTitle title="Red" />
      <Card>
        <SwitchRow label="Simular sin conexión" description="Las consultas fallan con error de red." value={offline} onValueChange={setOffline} />
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

      <SectionTitle title="Próxima reserva" />
      <Card>
        <Txt variant="muted" style={{ marginBottom: space.md }}>
          Fuerza el resultado de la próxima transacción “Reservar cupo con pago”.
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

      <SectionTitle title="Registro de transacciones (T0)" />
      {offline ? (
        <Txt variant="muted">Desactiva “sin conexión” para consultar el registro.</Txt>
      ) : !log.data || log.data.length === 0 ? (
        <EmptyState icon="git-network-outline" title="Sin transacciones todavía" message="Haz una reserva como conductor y vuelve aquí para ver cada subtransacción y sus compensaciones." />
      ) : (
        log.data.map((tx) => (
          <Card key={tx.id} style={{ marginBottom: space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt variant="title" style={{ flex: 1 }} numberOfLines={1}>
                {tx.meta.space}
              </Txt>
              <Badge {...OUTCOME[tx.outcome]} />
            </View>
            <Txt variant="small" style={{ marginBottom: space.sm }}>
              {formatTime(tx.startedAt)} · llave {tx.meta.idempotencyKey.slice(0, 14)}…
            </Txt>
            {tx.steps.map((st, i) => (
              <View key={i} style={styles.step}>
                <Text style={[styles.stepId, { color: colors[STEP_TONE[st.status]] || colors.primary }]}>{st.step}</Text>
                <Text style={styles.stepDetail}>{st.detail}</Text>
              </View>
            ))}
          </Card>
        ))
      )}

      <SectionTitle title="Datos" />
      <Button
        title="Restablecer datos de demostración"
        icon="refresh"
        variant="secondary"
        onPress={() => {
          resetDemoData();
          showToast('Datos de demostración restablecidos');
        }}
      />
      <Txt variant="small" style={{ marginTop: space.sm }}>
        Vuelve a los cupos, reservas y espacios iniciales. Las cuentas creadas se pierden.
      </Txt>
    </Screen>
  );
}

const makeStyles = (colors) => ({
  step: { flexDirection: 'row', gap: space.sm, paddingVertical: 3 },
  stepId: { width: 40, fontSize: font.xs, fontWeight: '800' },
  stepDetail: { flex: 1, fontSize: font.xs, color: colors.text, lineHeight: 16 },
});
