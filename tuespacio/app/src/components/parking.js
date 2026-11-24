// Componentes del dominio: tarifas, disponibilidad, condiciones y tarjetas de espacio/reserva.
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { font, radius, softShadow, space } from '../theme';
import { AVAILABILITY, RATE_UNITS, RESERVATION_STATUS, SPACE_KINDS, VEHICLES } from '../domain/rules';
import { formatCOP, formatDistance, formatHeight, formatDay, formatTime, formatDuration } from '../utils/format';
import { Badge } from './ui';
import { usePreferences, useStyles, useTheme } from '../state/Preferences';

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' };

export const rateLabel = (rate) => (rate ? formatCOP(rate.price) + RATE_UNITS[rate.unit].short : '—');

// Sigla corta para la miniatura de la tarjeta (p. ej. "Parqueadero Torre 72" → "PT7").
export const spaceInitials = (name) =>
  name
    .replace(/[·\-().]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(de|del|la|el|los|las|para|y|cra|cl|#)$/i.test(w))
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');

export function VehicleIcon({ vehicle, size = 18, color }) {
  const c = useTheme();
  return <MaterialCommunityIcons name={VEHICLES[vehicle].icon} size={size} color={color || c.textMuted} />;
}

export function AvailabilityBadge({ availability, vehicle }) {
  const a = availability[vehicle];
  const meta = AVAILABILITY[a.status];
  const label = a.status === 'available' || a.status === 'few' ? `${a.free} ${a.free === 1 ? 'cupo libre' : 'cupos libres'}` : meta.label;
  return <Badge label={label} tone={meta.tone} />;
}

export function ReservationBadge({ status }) {
  const meta = RESERVATION_STATUS[status];
  return <Badge label={meta.label} tone={meta.tone} />;
}

export function KindTag({ kind, hostType }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.kind}>
      <Ionicons name={SPACE_KINDS[kind].icon} size={12} color={c.textMuted} {...hidden} />
      <Text style={styles.kindText}>{kind === 'particular' && hostType ? `${hostType} particular` : SPACE_KINDS[kind].label}</Text>
    </View>
  );
}

// Miniatura del mockup: cuadro marino (parqueadero) o celeste (particular) con la sigla.
export function SpaceThumb({ space: s, size = 72 }) {
  const c = useTheme();
  const formal = s.kind === 'formal';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: formal ? c.navy : c.accent,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 6,
      }}
      {...hidden}
    >
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.16)' }} />
      <Ionicons name={formal ? 'business' : 'home'} size={size * 0.3} color="rgba(255,255,255,0.9)" style={{ marginBottom: 2 }} />
      <Text style={{ color: c.white, fontSize: 11, fontWeight: '900', letterSpacing: 0.6 }}>{spaceInitials(s.name)}</Text>
    </View>
  );
}

// Resumen compacto de condiciones para listas.
export function ConditionInline({ conditions }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const items = [
    conditions.covered ? { icon: 'umbrella-outline', label: 'Techado' } : { icon: 'sunny-outline', label: 'Descubierto' },
    conditions.keys ? { icon: 'key-outline', label: 'Deja llaves' } : { icon: 'lock-closed-outline', label: 'Sin dejar llaves' },
  ];
  if (conditions.maxHeight) items.push({ icon: 'resize-outline', label: 'Máx. ' + formatHeight(conditions.maxHeight) });
  return (
    <View style={styles.inline}>
      {items.map((i) => (
        <View key={i.label} style={styles.inlineItem}>
          <Ionicons name={i.icon} size={13} color={c.accent} {...hidden} />
          <Text style={styles.inlineText}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Detalle explícito de condiciones (diferenciador del producto según los documentos).
export function ConditionGrid({ conditions, capacity }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const accepted = Object.keys(VEHICLES).filter((v) => capacity[v] > 0);
  const items = [
    { icon: 'umbrella-outline', title: 'Techado', value: conditions.covered ? 'Sí' : 'No, descubierto' },
    { icon: 'key-outline', title: 'Entrega de llaves', value: conditions.keys ? 'Sí, se dejan las llaves' : 'No, te llevas tus llaves' },
    { icon: 'resize-outline', title: 'Altura máxima', value: conditions.maxHeight ? formatHeight(conditions.maxHeight) : 'Sin restricción' },
    { icon: 'car-outline', title: 'Vehículos', value: accepted.map((v) => VEHICLES[v].label).join(' y ') },
  ];
  return (
    <View style={styles.grid}>
      {items.map((i) => (
        <View key={i.title} style={styles.gridItem}>
          <View style={styles.gridIcon}>
            <Ionicons name={i.icon} size={18} color={c.accent} {...hidden} />
          </View>
          <Text style={styles.gridTitle}>{i.title}</Text>
          <Text style={styles.gridValue}>{i.value}</Text>
        </View>
      ))}
    </View>
  );
}

// Tarjeta de resultado del mockup: miniatura, nombre, dirección, tarifa y cupos libres.
export function SpaceCard({ space: s, vehicle, onPress, selected }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const a = s.availability[vehicle];
  const dim = a.status === 'full';
  const rate = s.rates[vehicle];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${s.name}, ${rate ? `${formatCOP(rate.price)} ${RATE_UNITS[rate.unit].label}` : 'no recibe este vehículo'}, a ${formatDistance(s.distanceM)}`}
      accessibilityState={{ selected: !!selected }}
      android_ripple={{ color: c.surfacePressed }}
      style={({ pressed }) => [styles.spaceCard, selected && styles.spaceCardSelected, pressed && !selected && { backgroundColor: c.surface }]}
    >
      <SpaceThumb space={s} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.cardName, dim && { color: c.textMuted }]} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {s.address}
            </Text>
          </View>
          <View style={styles.kindPill}>
            <Text style={styles.kindPillText}>{s.kind === 'formal' ? 'Formal' : s.hostType || 'Particular'}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <View>
            <Text style={[styles.price, dim && { color: c.textMuted }]}>
              {rate ? formatCOP(rate.price) : '—'}
              {rate ? <Text style={styles.priceUnit}>{RATE_UNITS[rate.unit].short}</Text> : null}
            </Text>
            <Text style={styles.cardMeta}>a {formatDistance(s.distanceM)} de tu destino</Text>
          </View>
          <AvailabilityBadge availability={s.availability} vehicle={vehicle} />
        </View>
        <View style={{ marginTop: space.sm }}>
          <ConditionInline conditions={s.conditions} />
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSubtle} style={{ alignSelf: 'center' }} {...hidden} />
    </Pressable>
  );
}

export function ReservationSummary({ r, showDriver }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.cardTop}>
        <Text style={[styles.cardName, { flex: 1, fontSize: font.md }]} numberOfLines={1}>
          {showDriver ? r.driverName : r.space.name}
        </Text>
        <ReservationBadge status={r.status} />
      </View>
      <View style={styles.inline}>
        <View style={styles.inlineItem}>
          <Ionicons name="calendar-outline" size={13} color={c.accent} {...hidden} />
          <Text style={styles.inlineText}>
            {formatDay(r.startAt)} · {formatTime(r.startAt)} – {formatTime(r.endAt)}
          </Text>
        </View>
        <View style={styles.inlineItem}>
          <VehicleIcon vehicle={r.vehicle} size={14} color={c.accent} />
          <Text style={styles.inlineText}>{VEHICLES[r.vehicle].label}</Text>
        </View>
      </View>
      <View style={styles.inline}>
        <Text style={styles.inlineText}>
          Código <Text style={styles.code}>{r.code}</Text> · {formatDuration(r.durationMin)} · <Text style={{ fontWeight: '900', color: c.text }}>{formatCOP(r.amount)}</Text>
        </Text>
      </View>
    </View>
  );
}

// Tarjeta de reserva del mockup: franja de color por estado y contenido.
export function ReservationCard({ r, onPress, showDriver, children, style }) {
  const c = useTheme();
  const { tones } = usePreferences();
  const styles = useStyles(makeStyles);
  const tone = tones[RESERVATION_STATUS[r.status].tone] || tones.neutral;
  const body = (
    <>
      <View style={{ height: 6, backgroundColor: tone.solid }} />
      <View style={{ padding: space.lg }}>
        <ReservationSummary r={r} showDriver={showDriver} />
        {children}
      </View>
    </>
  );
  if (!onPress) return <View style={[styles.resCard, style]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.surfacePressed }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.resCard, pressed && { backgroundColor: c.surface }, style]}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (c) => ({
  kind: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindText: { fontSize: font.xs, color: c.textMuted, fontWeight: '700' },
  inline: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 4, flexShrink: 1 },
  inlineItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inlineText: { fontSize: font.xs, color: c.textMuted },
  code: { fontWeight: '900', color: c.text, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gridItem: {
    width: '48.5%',
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 2,
  },
  gridIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  gridTitle: { fontSize: font.xs, color: c.textMuted, fontWeight: '600', marginTop: space.sm },
  gridValue: { fontSize: font.sm, color: c.text, fontWeight: '800' },
  spaceCard: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    marginBottom: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    overflow: 'hidden',
    ...(c.dark ? null : softShadow),
  },
  spaceCardSelected: { borderColor: c.accent, borderWidth: 2, backgroundColor: c.primarySoft },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  cardName: { fontSize: font.sm, fontWeight: '900', color: c.text },
  cardMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  kindPill: { backgroundColor: c.surface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  kindPillText: { fontSize: 10, fontWeight: '700', color: c.textMuted },
  price: { fontSize: font.md, fontWeight: '900', color: c.heading },
  priceUnit: { fontSize: font.xs, fontWeight: '500', color: c.textMuted },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  resCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    overflow: 'hidden',
    marginBottom: space.md,
    ...(c.dark ? null : softShadow),
  },
});
