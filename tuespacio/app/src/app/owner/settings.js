import { Screen, Header } from '../../components/layout';
import { ErrorState, LoadingState } from '../../components/states';
import { SpaceForm } from '../../components/SpaceForm';
import { api } from '../../api';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';

export default function OwnerSettings() {
  const { invalidate, showToast } = useApp();
  const { data, loading, error, reload } = useQuery(() => api.ownerSpace(), []);

  const save = async (payload) => {
    await api.updateSpace(data.space.id, payload);
    invalidate();
    showToast('Cambios publicados. Los conductores ya los ven.');
  };

  return (
    <Screen header={<Header title="Mi parqueadero" subtitle="Cupos, tarifas, horario y condiciones" />}>
      {data ? (
        <SpaceForm initial={data.space} mode="edit" onSubmit={save} submitLabel="Guardar y publicar" />
      ) : loading ? (
        <LoadingState />
      ) : (
        <ErrorState error={error} onRetry={reload} />
      )}
    </Screen>
  );
}
