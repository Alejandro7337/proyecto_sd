// Lista de reservas recibidas, compartida por el panel del parqueadero y el del anfitrión.
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Segmented, Txt } from './ui';
import { ReservationCard } from './parking';
import { EmptyState } from './states';
import { api } from '../api';
import { useApp } from '../state/AppContext';
import { describeError } from '../api/errors';
import { space } from '../theme';

const FILTERS = [
  { value: 'upcoming', label: 'Próximas', statuses: ['confirmed'] },
  { value: 'active', label: 'En curso', statuses: ['active'] },
  { value: 'history', label: 'Historial', statuses: ['completed', 'cancelled'] },
];

const EMPTY = {
  upcoming: { title: 'Sin reservas próximas', message: 'Cuando un conductor reserve, la verás aquí con su código.' },
  active: { title: 'Nadie está parqueado con reserva', message: 'Registra la llegada de una reserva próxima para verla aquí.' },
  history: { title: 'Aún no hay historial', message: 'Las reservas finalizadas y canceladas aparecerán aquí.' },
};

export function BookingList({ reservations, showSpace }) {
  const [filter, setFilter] = useState('upcoming');
  const [busyId, setBusyId] = useState(null);
  const { invalidate, showToast } = useApp();
  const current = FILTERS.find((f) => f.value === filter);
  const list = reservations.filter((r) => current.statuses.includes(r.status));

  const act = async (r, action) => {
    setBusyId(r.id + action);
    try {
      if (action === 'in') await api.checkIn(r.id);
      else await api.checkOut(r.id);
      showToast(action === 'in' ? `Llegada registrada · ${r.code}` : `Salida registrada · ${r.code}`);
      invalidate();
    } catch (e) {
      showToast(describeError(e).title, 'danger');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View>
      <Segmented
        options={FILTERS.map((f) => ({
          value: f.value,
          label: `${f.label} (${reservations.filter((r) => f.statuses.includes(r.status)).length})`,
        }))}
        value={filter}
        onChange={setFilter}
      />
      <View style={{ marginTop: space.lg }}>
        {list.length === 0 ? (
          <EmptyState icon="calendar-clear-outline" {...EMPTY[filter]} />
        ) : (
          list.map((r) => (
            <ReservationCard key={r.id} r={r} showDriver>
              {showSpace ? (
                <Txt variant="small" style={{ marginTop: space.sm }}>
                  {r.space.name}
                </Txt>
              ) : null}
              {r.status === 'confirmed' ? (
                <Button
                  title="Registrar llegada"
                  icon="enter-outline"
                  size="sm"
                  variant="secondary"
                  style={{ marginTop: space.md }}
                  loading={busyId === r.id + 'in'}
                  onPress={() => act(r, 'in')}
                />
              ) : null}
              {r.status === 'active' ? (
                <Button
                  title="Registrar salida"
                  icon="exit-outline"
                  size="sm"
                  variant="secondary"
                  style={{ marginTop: space.md }}
                  loading={busyId === r.id + 'out'}
                  onPress={() => act(r, 'out')}
                />
              ) : null}
            </ReservationCard>
          ))
        )}
      </View>
    </View>
  );
}
