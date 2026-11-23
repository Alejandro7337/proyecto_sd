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

const TABS = [
  { value: 'current', label: 'Activas', statuses: ['confirmed', 'active'] },
  { value: 'history', label: 'Historial', statuses: ['completed', 'cancelled'] },
];

export default function MyReservations() {
  const router = useRouter();
  const [tab, setTab] = useState('current');
  const { data, loading, error, reload } = useQuery(() => api.myReservations(), []);
  const statuses = TABS.find((t) => t.value === tab).statuses;
  const list = (data || []).filter((r) => statuses.includes(r.status));

  return (
    <Screen header={<Header title="Mis reservas" />} onRefresh={reload} refreshing={loading && !!data}>
      <Segmented
        options={TABS.map((t) => ({ value: t.value, label: data ? `${t.label} (${data.filter((r) => t.statuses.includes(r.status)).length})` : t.label }))}
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
              title="No tienes reservas activas"
              message="Elige tu destino, compara tarifas y condiciones, y reserva antes de salir."
              actionLabel="Buscar parqueadero"
              onAction={() => router.navigate('/driver')}
            />
          ) : (
            <EmptyState icon="time-outline" title="Sin historial todavía" message="Aquí verás tus reservas finalizadas y canceladas." />
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
