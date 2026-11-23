import { Screen, Header } from '../../components/layout';
import { ErrorState, LoadingState } from '../../components/states';
import { BookingList } from '../../components/BookingList';
import { api } from '../../api';
import { useQuery } from '../../state/useQuery';

export default function HostBookings() {
  const { data, loading, error, reload } = useQuery(() => api.hostReservations(), []);
  return (
    <Screen header={<Header title="Reservas" subtitle="En todos tus espacios" />} onRefresh={reload} refreshing={loading && !!data}>
      {data ? <BookingList reservations={data} showSpace /> : loading ? <LoadingState /> : <ErrorState error={error} onRetry={reload} />}
    </Screen>
  );
}
