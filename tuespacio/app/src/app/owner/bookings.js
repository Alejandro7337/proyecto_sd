import { Screen, Header } from '../../components/layout';
import { ErrorState, LoadingState } from '../../components/states';
import { BookingList } from '../../components/BookingList';
import { api } from '../../api';
import { useQuery } from '../../state/useQuery';

export default function OwnerBookings() {
  const { data, loading, error, reload } = useQuery(async () => {
    const { space } = await api.ownerSpace();
    return api.spaceReservations(space.id);
  }, []);

  return (
    <Screen header={<Header title="Reservas" subtitle="Conductores que reservaron en tu parqueadero" />} onRefresh={reload} refreshing={loading && !!data}>
      {data ? <BookingList reservations={data} /> : loading ? <LoadingState /> : <ErrorState error={error} onRetry={reload} />}
    </Screen>
  );
}
