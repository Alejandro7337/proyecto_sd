import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Header, Screen } from '../../components/layout';
import { Button, Chip, Segmented, Txt } from '../../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { ReservationCard, SpaceCard } from '../../components/parking';
import { SchematicMap } from '../../components/SchematicMap';
import { api } from '../../api';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';
import { VEHICLES } from '../../domain/rules';
import { font, radius, softShadow, space } from '../../theme';
import { usePreferences, useStyles } from '../../state/Preferences';

const FILTERS = [
  { key: 'covered', label: 'Techado', icon: 'umbrella-outline' },
  { key: 'noKeys', label: 'Sin dejar llaves', icon: 'lock-closed-outline' },
  { key: 'formal', label: 'Parqueaderos', icon: 'business-outline' },
  { key: 'particular', label: 'Particulares', icon: 'home-outline' },
];

export default function Explore() {
  const { user } = useApp();
  const router = useRouter();
  const { colors, t } = usePreferences();
  const styles = useStyles(makeStyles);
  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState(null);
  const [vehicle, setVehicle] = useState(user.vehicle || 'car');
  const [filters, setFilters] = useState({ covered: false, noKeys: false, kind: null });
  const [sort, setSort] = useState('distance');
  const [selectedId, setSelectedId] = useState(null);

  const suggestions = useQuery(() => api.searchDestinations(query), [query], { enabled: !destination });
  const upcoming = useQuery(() => api.myReservations(), []);
  const spaces = useQuery(
    () => api.listSpaces({ destinationId: destination.id, vehicle, covered: filters.covered, noKeys: filters.noKeys, kind: filters.kind, sort }),
    [destination?.id, vehicle, filters.covered, filters.noKeys, filters.kind, sort],
    { enabled: !!destination }
  );

  const toggleFilter = (key) => {
    setSelectedId(null);
    if (key === 'formal' || key === 'particular') setFilters((f) => ({ ...f, kind: f.kind === key ? null : key }));
    else setFilters((f) => ({ ...f, [key]: !f[key] }));
  };
  const isOn = (key) => (key === 'formal' || key === 'particular' ? filters.kind === key : filters[key]);
  const clearFilters = () => setFilters({ covered: false, noKeys: false, kind: null });

  const pickDestination = (d) => {
    setDestination(d);
    setQuery('');
    setSelectedId(null);
  };

  const active = (upcoming.data || []).find((r) => r.status === 'confirmed' || r.status === 'active');

  if (!destination) {
    return (
      <Screen header={<Header title={t.home} />}>
        <Txt variant="muted">Hola, {user.name.split(' ')[0]}</Txt>
        <Txt variant="h1" style={{ marginTop: 2 }}>
          ¿A dónde vas?
        </Txt>
        <Txt variant="muted" style={{ marginTop: space.xs }}>
          Buscamos sobre tu destino, no sobre dónde estás.
        </Txt>

        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.accent} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Escribe una zona o destino"
            placeholderTextColor={colors.textSubtle}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Buscar destino"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Borrar búsqueda">
              <Ionicons name="close-circle" size={20} color={colors.textSubtle} />
            </Pressable>
          ) : null}
        </View>

        {active ? (
          <View style={{ marginTop: space.xxl }}>
            <Txt variant="eyebrow" style={{ marginBottom: space.sm }}>
              Tu reserva
            </Txt>
            <ReservationCard r={active} onPress={() => router.push(`/reservation/${active.id}`)} />
          </View>
        ) : null}

        <Txt variant="eyebrow" style={{ marginTop: space.xxxl, marginBottom: space.xs }}>
          {query ? 'Resultados' : 'Zonas piloto'}
        </Txt>
        {suggestions.loading && !suggestions.data ? (
          <LoadingState label="Buscando destinos…" />
        ) : suggestions.error ? (
          <ErrorState error={suggestions.error} onRetry={suggestions.reload} />
        ) : suggestions.data.length === 0 ? (
          <EmptyState
            icon="location-outline"
            title="No encontramos ese destino"
            message="Por ahora Tu Espacio opera en 3 zonas piloto de una ciudad. Prueba con “empresarial”, “universitaria” o “clínicas”."
          />
        ) : (
          suggestions.data.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => pickDestination(d)}
              accessibilityRole="button"
              accessibilityLabel={`${d.name}. ${d.hint}`}
              android_ripple={{ color: colors.surfacePressed }}
              style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.surface }]}
            >
              <View style={styles.suggestionIcon}>
                <Ionicons name="location" size={20} color={colors.accent} accessibilityElementsHidden importantForAccessibility="no" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionTitle}>{d.name}</Text>
                <Text style={styles.suggestionHint}>{d.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
            </Pressable>
          ))
        )}
      </Screen>
    );
  }

  const list = spaces.data || [];
  const selected = list.find((s) => s.id === selectedId);
  const anyFilter = filters.covered || filters.noKeys || filters.kind;

  return (
    <Screen header={<Header title={t.home} />} onRefresh={spaces.reload} refreshing={spaces.loading && !!spaces.data}>
      <Pressable onPress={() => setDestination(null)} style={styles.destBar} accessibilityLabel="Cambiar destino">
        <Ionicons name="search" size={20} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.destLabel}>Destino</Text>
          <Text style={styles.destName} numberOfLines={1}>
            {destination.name}
          </Text>
        </View>
        <Text style={styles.destChange}>Cambiar</Text>
      </Pressable>

      <Segmented
        options={Object.entries(VEHICLES).map(([k, v]) => ({ value: k, label: v.label }))}
        value={vehicle}
        onChange={(v) => {
          setVehicle(v);
          setSelectedId(null);
        }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.md, marginHorizontal: -space.xl }} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.xl }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} icon={f.icon} selected={isOn(f.key)} onPress={() => toggleFilter(f.key)} />
        ))}
      </ScrollView>

      <View style={{ marginTop: space.lg }}>
        <SchematicMap spaces={list} vehicle={vehicle} selectedId={selectedId} onSelect={setSelectedId} destinationName={destination.name} />
      </View>

      {selected ? (
        <View style={{ marginTop: space.md }}>
          <SpaceCard space={selected} vehicle={vehicle} selected onPress={() => router.push({ pathname: `/space/${selected.id}`, params: { vehicle } })} />
          <Button
            title="Ver detalle y reservar"
            icon="arrow-forward"
            onPress={() => router.push({ pathname: `/space/${selected.id}`, params: { vehicle } })}
            style={{ marginTop: space.md }}
          />
        </View>
      ) : null}

      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Txt variant="h3">Cupos cerca de tu destino</Txt>
          <Txt variant="small">
            {spaces.data ? `${list.length} ${list.length === 1 ? 'opción' : 'opciones'} para ${VEHICLES[vehicle].label.toLowerCase()} · Ahora` : 'Consultando…'}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <SortButton label="Cercanía" active={sort === 'distance'} onPress={() => setSort('distance')} />
          <SortButton label="Precio" active={sort === 'price'} onPress={() => setSort('price')} />
        </View>
      </View>

      {spaces.loading && !spaces.data ? (
        <LoadingState label="Consultando cupos y tarifas…" />
      ) : spaces.error && !spaces.data ? (
        <ErrorState error={spaces.error} onRetry={spaces.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="car-outline"
          title="Sin espacios con estos filtros"
          message={anyFilter ? 'Quita algún filtro para ver más opciones cerca de tu destino.' : 'No hay espacios que reciban este vehículo en esta zona.'}
          actionLabel={anyFilter ? 'Quitar filtros' : undefined}
          onAction={clearFilters}
        />
      ) : (
        list.map((s) => (
          <SpaceCard key={s.id} space={s} vehicle={vehicle} selected={s.id === selectedId} onPress={() => router.push({ pathname: `/space/${s.id}`, params: { vehicle } })} />
        ))
      )}
    </Screen>
  );
}

function SortButton({ label, active, onPress }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} accessibilityState={{ selected: active }} style={[styles.sort, active && styles.sortActive]} hitSlop={4}>
      <Text style={[styles.sortText, active && styles.sortTextActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors) => ({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xxl,
    minHeight: 54,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    ...(colors.dark ? null : softShadow),
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 12, fontWeight: '500' },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  suggestionIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  suggestionTitle: { fontSize: font.md, fontWeight: '800', color: colors.text },
  suggestionHint: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  destBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: space.md,
    ...(colors.dark ? null : softShadow),
  },
  destLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  destName: { fontSize: font.sm, fontWeight: '800', color: colors.text },
  destChange: { fontSize: font.sm, fontWeight: '800', color: colors.primary },
  listHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.xxl, marginBottom: space.md, gap: space.sm },
  sort: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  sortActive: { backgroundColor: colors.dark ? colors.accent : colors.navy, borderColor: colors.dark ? colors.accent : colors.navy },
  sortText: { fontSize: font.xs, fontWeight: '600', color: colors.textMuted },
  sortTextActive: { color: colors.dark ? colors.navy : colors.white, fontWeight: '800' },
});
