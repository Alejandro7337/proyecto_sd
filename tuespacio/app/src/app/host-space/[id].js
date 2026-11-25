import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Header } from '../../components/layout';
import { ErrorState, LoadingState } from '../../components/states';
import { SpaceForm } from '../../components/SpaceForm';
import { api } from '../../api';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';

// Publicar (id = "new") o editar un espacio particular.
export default function HostSpaceEditor() {
  const { id } = useLocalSearchParams();
  const isNew = id === 'new';
  const router = useRouter();
  const { invalidate, showToast } = useApp();
  const destinations = useQuery(() => api.searchDestinations(''), []);
  const existing = useQuery(() => api.getSpace(id), [id], { enabled: !isNew });

  const submit = async (payload) => {
    const result = isNew ? await api.createHostSpace(payload) : await api.updateSpace(id, payload);
    invalidate();
    showToast(isNew ? (result.status === 'published' ? 'Espacio publicado' : 'Espacio enviado a revisión') : 'Cambios guardados');
    router.back();
  };

  const ready = destinations.data && (isNew || existing.data);
  const failed = destinations.error || existing.error;

  return (
    <Screen header={<Header back title={isNew ? 'Publicar espacio' : 'Editar espacio'} subtitle={isNew ? 'Espacio particular' : existing.data?.name} />}>
      {ready ? (
        <SpaceForm
          initial={isNew ? null : existing.data}
          mode={isNew ? 'create' : 'host-edit'}
          destinations={destinations.data}
          onSubmit={submit}
          submitLabel={isNew ? 'Enviar espacio' : 'Guardar cambios'}
        />
      ) : failed ? (
        <ErrorState error={failed} onRetry={() => (destinations.error ? destinations.reload() : existing.reload())} />
      ) : (
        <LoadingState />
      )}
    </Screen>
  );
}
