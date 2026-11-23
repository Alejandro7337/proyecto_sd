// Estados de carga, vacío y error reutilizables.
import { ActivityIndicator, Text, View } from 'react-native';
import { font, space } from '../theme';
import { Button, IconCircle } from './ui';
import { describeError } from '../api/errors';
import { useStyles, useTheme } from '../state/Preferences';

export function LoadingState({ label = 'Cargando…' }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={c.accent} />
      <Text style={styles.message}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon = 'file-tray-outline', title, message, actionLabel, onAction }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <IconCircle name={icon} tone="info" size={64} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel ? <Button title={actionLabel} onPress={onAction} style={{ marginTop: space.lg, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }) {
  const copy = describeError(error);
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <IconCircle name={error?.code === 'NETWORK' ? 'cloud-offline-outline' : 'alert-circle-outline'} tone="danger" size={64} />
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.message}>{copy.message}</Text>
      {onRetry ? <Button title="Reintentar" icon="refresh" onPress={onRetry} variant="secondary" style={{ marginTop: space.lg, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: { alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  title: { fontSize: font.lg, fontWeight: '900', color: c.heading, marginTop: space.lg, textAlign: 'center' },
  message: { fontSize: font.sm, color: c.textMuted, marginTop: space.sm, textAlign: 'center', lineHeight: 20 },
});
