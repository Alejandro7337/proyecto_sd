import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Header } from '../../components/layout';
import { Segmented } from '../../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { ReservationCard } from '../../components/parking';
import { api } from '../../api';
import { useQuery } from '../../state/useQuery';
import { space } from '../../theme';
import { reservationTab } from '../../domain/rules';

const TABS = [
  { value: 'current', label: 'Actuales' },
  { value: 'history', label: 'Historial' },
];

export default function MyReservations() {
  const router = useRouter();
  const [tab, setTab] = useState('current');
  const { data, loading, error, reload } = useQuery(() => api.myReservations(), []);
  const list = (data || []).filter((r) => reservationTab(r.status) === tab);

  return (
    <Screen header={<Header title="Mis reservas" />} onRefresh={reload} refreshing={loading && !!data}>
      <Segmented
        options={TABS.map((t) => ({ value: t.value, label: data ? `${t.label} (${data.filter((r) => reservationTab(r.status) === t.value).length})` : t.label }))}
        value={tab}
        onChange={setTab}
      />
      <View style={{ marginTop: space.lg }}>
        {loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : list.length === 0 ? (
          tab === 'current' ? (
            <EmptyState
              icon="calendar-outline"
              title="No tienes reservas pendientes o activas"
              message="Elige tu destino, compara tarifas y condiciones, y reserva antes de salir."
              actionLabel="Buscar parqueadero"
              onAction={() => router.navigate('/driver')}
            />
          ) : (
            <EmptyState icon="time-outline" title="Sin historial todavía" message="Aquí verás tus reservas finalizadas, canceladas y no completadas." />
          )
        ) : (
          list.map((r) => (
            <ReservationCard key={r.id} r={r} onPress={() => router.push(`/reservation/${r.id}`)} />
          ))
        )}
      </View>
    </Screen>
  );
}
