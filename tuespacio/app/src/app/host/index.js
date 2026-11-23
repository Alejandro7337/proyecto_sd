import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Header } from '../../components/layout';
import { Badge, Button, Card, Txt } from '../../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { AvailabilityBadge, KindTag, rateLabel, VehicleIcon } from '../../components/parking';
import { api } from '../../api';
import { describeError } from '../../api/errors';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';
import { VEHICLES } from '../../domain/rules';
import { space } from '../../theme';
import { useTheme } from '../../state/Preferences';

export default function HostSpaces() {
  const router = useRouter();
  const { invalidate, showToast } = useApp();
  const colors = useTheme();
  const [busy, setBusy] = useState(null);
  const { data, loading, error, reload } = useQuery(() => api.hostSpaces(), []);

  const toggle = async (s) => {
    setBusy(s.id);
    try {
      const paused = s.status === 'published';
      await api.updateSpace(s.id, { status: paused ? 'paused' : 'published' });
      invalidate();
      showToast(paused ? 'Espacio pausado: ya no aparece en el mapa' : 'Espacio publicado en el mapa');
    } catch (e) {
      showToast(describeError(e).title, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const publish = <Button title="Publicar un espacio" icon="add" onPress={() => router.push('/host-space/new')} />;

  return (
    <Screen header={<Header title="Mis espacios" subtitle="Garajes, lotes o antejardines que ofreces" />} onRefresh={reload} refreshing={loading && !!data}>
      {loading && !data ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data.length === 0 ? (
        <EmptyState
          icon="home-outline"
          title="Aún no publicas ningún espacio"
          message="Define tarifa, horarios y tipo de vehículo. Sin inversión ni obras: solo pagas comisión si hay reserva."
          actionLabel="Publicar mi primer espacio"
          onAction={() => router.push('/host-space/new')}
        />
      ) : (
        <>
          {data.map((s) => {
            const vehicles = Object.keys(VEHICLES).filter((v) => s.capacity[v] > 0);
            return (
              <Card key={s.id} style={{ marginBottom: space.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <KindTag kind={s.kind} hostType={s.hostType} />
                  <Badge label={s.status === 'published' ? 'Publicado' : 'Pausado'} tone={s.status === 'published' ? 'success' : 'neutral'} />
                </View>
                <Txt variant="title" style={{ marginTop: 6 }}>
                  {s.name}
                </Txt>
                <Txt variant="small">{s.address}</Txt>
                {vehicles.map((v) => (
                  <View key={v} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md }}>
                    <VehicleIcon vehicle={v} />
                    <Txt style={{ flex: 1 }}>{rateLabel(s.rates[v])}</Txt>
                    {s.status === 'published' ? <AvailabilityBadge availability={s.availability} vehicle={v} /> : null}
                  </View>
                ))}
                <Txt variant="small" style={{ marginTop: space.sm }}>
                  {s.schedule.days} · {s.schedule.open} – {s.schedule.close}
                </Txt>
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                  <Button title="Editar" icon="create-outline" size="sm" variant="secondary" onPress={() => router.push(`/host-space/${s.id}`)} style={{ flex: 1 }} />
                  <Button
                    title={s.status === 'published' ? 'Pausar' : 'Publicar'}
                    icon={s.status === 'published' ? 'pause-outline' : 'play-outline'}
                    size="sm"
                    variant="secondary"
                    loading={busy === s.id}
                    onPress={() => toggle(s)}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>
            );
          })}
          <View style={{ marginTop: space.sm }}>{publish}</View>
          <Txt variant="small" style={{ textAlign: 'center', marginTop: space.md, color: colors.textMuted }}>
            Los cambios se reflejan de inmediato en el mapa de los conductores.
          </Txt>
        </>
      )}
    </Screen>
  );
}
