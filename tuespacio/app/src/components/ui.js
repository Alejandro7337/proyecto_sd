// Componentes base reutilizables con la identidad visual del mockup: tarjetas blancas
// redondeadas (24 px), botones marinos de 16 px de radio, píldoras y tipografía de peso alto.
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { font, radius, softShadow, space } from '../theme';
import { usePreferences, useStyles, useTheme } from '../state/Preferences';

// Los íconos junto a un texto visible son decorativos: se ocultan a los lectores de pantalla.
const decorative = { accessibilityElementsHidden: true, importantForAccessibility: 'no' };

export function Txt({ style, variant = 'body', children, ...rest }) {
  const styles = useStyles(makeStyles);
  return (
    <Text style={[styles[variant], style]} {...rest}>
      {children}
    </Text>
  );
}

// Logo de marca del mockup: cuadro marino con el símbolo de parqueo.
export function Logo({ size = 40, tone = 'navy' }) {
  const c = useTheme();
  const bg = tone === 'accent' ? c.accent : c.navy;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: c.dark && tone === 'navy' ? 1 : 0, borderColor: c.borderStrong }}
      {...decorative}
    >
      <MaterialCommunityIcons name="parking" size={size * 0.6} color={c.white} />
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', icon, iconRight, loading, disabled, size = 'md', style }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const v = buttonVariants(c)[variant] || buttonVariants(c).primary;
  const isDisabled = disabled || loading;
  const iconSize = size === 'sm' ? 16 : 18;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      android_ripple={{ color: v.ripple }}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={iconSize} color={v.fg} {...decorative} /> : null}
          <Text style={[styles.buttonText, size === 'sm' && styles.buttonTextSm, { color: v.fg }]} numberOfLines={1}>
            {title}
          </Text>
          {iconRight ? <Ionicons name={iconRight} size={iconSize} color={v.fg} {...decorative} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants = (c) => ({
  primary: { bg: c.action, pressed: c.actionPressed, fg: c.onAction, border: c.action, ripple: 'rgba(255,255,255,0.2)' },
  dark: { bg: c.action, pressed: c.actionPressed, fg: c.onAction, border: c.action, ripple: 'rgba(255,255,255,0.2)' },
  accent: { bg: c.accent, pressed: '#2C8CE6', fg: c.navy, border: c.accent, ripple: 'rgba(255,255,255,0.2)' },
  secondary: { bg: c.card, pressed: c.surface, fg: c.text, border: c.border, ripple: c.surfacePressed },
  ghost: { bg: 'transparent', pressed: c.primarySoft, fg: c.primary, border: 'transparent', ripple: c.primarySoft },
  danger: { bg: c.card, pressed: c.dangerSoft, fg: c.danger, border: c.dark ? c.border : '#F5C2C2', ripple: c.dangerSoft },
});

// Tarjeta blanca con borde fino y sombra suave (rounded-3xl del mockup).
export function Card({ children, style, onPress, selected, flat }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const content = [styles.card, flat && styles.cardFlat, selected && styles.cardSelected, style];
  if (!onPress) return <View style={content}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.surfacePressed }}
      style={({ pressed }) => [...content, pressed && !selected && { backgroundColor: c.surface }]}
    >
      {children}
    </Pressable>
  );
}

// Estado como píldora suave con punto + texto: el color nunca es el único indicador.
export function Badge({ label, tone = 'neutral', icon, style, solid }) {
  const { tones, colors: c } = usePreferences();
  const styles = useStyles(makeStyles);
  const t = tones[tone] || tones.neutral;
  const fg = solid ? c.white : t.fg;
  return (
    <View style={[styles.badge, { backgroundColor: solid ? c.navy : t.bg }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} {...decorative} /> : <View style={[styles.badgeDot, { backgroundColor: fg }]} />}
      <Text style={[styles.badgeText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Píldora de filtro (Badge outline del mockup). Seleccionada: marino lleno.
export function Chip({ label, selected, onPress, icon }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const fg = selected ? (c.dark ? c.navy : c.white) : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      android_ripple={{ color: c.surfacePressed, borderless: false }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && { backgroundColor: c.surface }]}
    >
      {icon ? <Ionicons name={icon} size={15} color={selected ? fg : c.accent} {...decorative} /> : null}
      <Text style={[styles.chipText, { color: fg }, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// Selector en píldoras (Activas / Historial del mockup).
export function Segmented({ options, value, onChange }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && !active && { backgroundColor: c.surface }]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextField({ label, error, helper, style, inputStyle, left, ...props }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputWrap, error && styles.inputError]}>
        {left}
        <TextInput
          placeholderTextColor={c.textSubtle}
          accessibilityLabel={label}
          accessibilityHint={error || helper}
          style={[styles.input, inputStyle]}
          {...props}
        />
      </View>
      {error ? (
        <View style={styles.helperRow}>
          <Ionicons name="alert-circle" size={14} color={c.danger} {...decorative} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 999, label, error }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restar"
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          style={[styles.stepBtn, value <= min && styles.buttonDisabled]}
        >
          <Ionicons name="remove" size={20} color={c.text} />
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sumar"
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          style={[styles.stepBtn, value >= max && styles.buttonDisabled]}
        >
          <Ionicons name="add" size={20} color={c.text} />
        </Pressable>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function SwitchRow({ label, description, value, onValueChange, icon }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={() => onValueChange(!value)} style={styles.switchRow} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}>
      {icon ? (
        <View style={styles.listIcon} {...decorative}>
          <Ionicons name={icon} size={18} color={c.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? <Text style={styles.helper}>{description}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: c.accent, false: c.borderStrong }} thumbColor={c.white} />
    </Pressable>
  );
}

export function Row({ label, value, icon, strong }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={18} color={c.accent} style={{ marginRight: space.sm }} {...decorative} /> : null}
      <Text style={[styles.rowLabel, { flex: 1, color: strong ? c.text : c.textMuted, fontWeight: strong ? '800' : '500' }]}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontWeight: '900', fontSize: font.md }]}>{value}</Text>
    </View>
  );
}

// Fila de ajustes del mockup: ícono en cuadro celeste, etiqueta, detalle y acción.
export function ListRow({ icon, label, detail, right, onPress, tone, last }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const danger = tone === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      android_ripple={{ color: c.surfacePressed }}
      style={({ pressed }) => [styles.listRow, !last && styles.listRowDivider, pressed && { backgroundColor: c.surface }]}
    >
      <View style={[styles.listIcon, danger && { backgroundColor: c.dangerSoft }]} {...decorative}>
        <Ionicons name={icon} size={18} color={danger ? c.danger : c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.listLabel, danger && { color: c.danger }]}>{label}</Text>
        {detail ? (
          <Text style={styles.listDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? right : onPress ? <Ionicons name="chevron-forward" size={18} color={c.textSubtle} {...decorative} /> : null}
    </Pressable>
  );
}

// Sección con título en versalitas y su contenido dentro de una tarjeta.
export function SettingsSection({ title, icon, children, style }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[{ marginTop: space.xxl }, style]}>
      <View style={styles.settingsTitle}>
        {icon ? <Ionicons name={icon} size={14} color={c.accent} {...decorative} /> : null}
        <Text style={styles.settingsTitleText} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <Card style={{ padding: 0 }}>{children}</Card>
    </View>
  );
}

export function SectionTitle({ title, action }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.h3} accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}

// Avisos: supuestos e información van discretos (sin caja); éxito, advertencia y error con fondo suave.
export function Note({ children, tone = 'info', icon = 'information-circle-outline', style }) {
  const { tones, colors: c } = usePreferences();
  const styles = useStyles(makeStyles);
  const t = tones[tone] || tones.info;
  const boxed = tone !== 'info';
  return (
    <View style={[styles.note, boxed && { backgroundColor: t.bg, padding: space.md }, style]}>
      <Ionicons name={icon} size={16} color={tone === 'info' ? c.accent : t.fg} style={{ marginTop: 1 }} {...decorative} />
      <Text style={[styles.noteText, { color: boxed ? t.fg : c.textMuted }]}>{children}</Text>
    </View>
  );
}

export function Divider({ style }) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.divider, style]} />;
}

export function IconCircle({ name, tone = 'info', size = 40 }) {
  const { tones } = usePreferences();
  const t = tones[tone] || tones.info;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}
      {...decorative}
    >
      <Ionicons name={name} size={size * 0.5} color={tone === 'info' ? t.solid : t.fg} />
    </View>
  );
}

export const makeStyles = (c) => ({
  body: { fontSize: font.sm, color: c.text, lineHeight: 21 },
  muted: { fontSize: font.sm, color: c.textMuted, lineHeight: 21 },
  small: { fontSize: font.xs, color: c.textMuted, lineHeight: 17 },
  h1: { fontSize: font.xxl, fontWeight: '900', color: c.heading, letterSpacing: -0.8, lineHeight: 36 },
  h2: { fontSize: font.xl, fontWeight: '900', color: c.heading, letterSpacing: -0.4 },
  h3: { fontSize: font.lg, fontWeight: '900', color: c.heading, letterSpacing: -0.2 },
  title: { fontSize: font.md, fontWeight: '800', color: c.text },
  eyebrow: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1.6, textTransform: 'uppercase' },
  brand: { fontSize: 10, fontWeight: '800', color: c.accent, letterSpacing: 1.8, textTransform: 'uppercase' },

  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonSm: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.sm },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonText: { fontSize: font.md, fontWeight: '700' },
  buttonTextSm: { fontSize: font.sm },
  buttonDisabled: { opacity: 0.4 },

  card: {
    backgroundColor: c.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    overflow: 'hidden',
    ...(c.dark ? null : softShadow),
  },
  cardFlat: { backgroundColor: c.surface, borderColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  cardSelected: { borderColor: c.accent, borderWidth: 2, backgroundColor: c.primarySoft },

  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingVertical: 3, paddingHorizontal: 9, borderRadius: radius.pill },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    overflow: 'hidden',
  },
  chipSelected: { backgroundColor: c.dark ? c.accent : c.navy, borderColor: c.dark ? c.accent : c.navy },
  chipText: { fontSize: font.sm, fontWeight: '600' },
  chipTextSelected: { fontWeight: '700' },

  segmented: { flexDirection: 'row', gap: space.sm },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  segmentActive: { backgroundColor: c.dark ? c.accent : c.navy, borderColor: c.dark ? c.accent : c.navy },
  segmentText: { fontSize: font.sm, fontWeight: '600', color: c.textMuted },
  segmentTextActive: { color: c.dark ? c.navy : c.white, fontWeight: '800' },

  field: { marginBottom: space.lg },
  label: { fontSize: font.xs, fontWeight: '800', color: c.text, marginBottom: 8 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    backgroundColor: c.card,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  inputError: { borderColor: c.danger },
  input: { flex: 1, fontSize: font.md, color: c.text, paddingVertical: 12 },
  helperRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  helper: { fontSize: font.xs, color: c.textMuted, marginTop: 4, lineHeight: 17 },
  errorText: { fontSize: font.xs, color: c.danger, fontWeight: '600' },

  stepper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.card },
  stepBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 44, textAlign: 'center', fontSize: font.lg, fontWeight: '800', color: c.text },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  rowLabel: { fontSize: font.sm, color: c.text, fontWeight: '600' },
  rowValue: { fontSize: font.sm, color: c.text, fontWeight: '700', textAlign: 'right', flexShrink: 1, marginLeft: space.md },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14, minHeight: 60, overflow: 'hidden' },
  listRowDivider: { borderBottomWidth: 1, borderBottomColor: c.border },
  listIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  listLabel: { fontSize: font.sm, fontWeight: '800', color: c.text },
  listDetail: { fontSize: font.xs, color: c.textMuted, marginTop: 2 },
  settingsTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginBottom: space.sm },
  settingsTitleText: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1.6, textTransform: 'uppercase' },

  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xxxl, marginBottom: space.md },
  note: { flexDirection: 'row', gap: space.sm, borderRadius: radius.md, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: font.xs, lineHeight: 18 },
  divider: { height: 1, backgroundColor: c.border, marginVertical: space.sm },
});
