import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { font, radius, space, shadow } from '../theme';
import { useApp } from '../state/AppContext';
import { useStyles } from '../state/Preferences';

const ICONS = { success: 'checkmark-circle', danger: 'alert-circle', info: 'information-circle' };

export function Toast() {
  const { toast } = useApp();
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <View key={toast.key} style={styles.toast} accessibilityLiveRegion="polite">
        <Ionicons
          name={ICONS[toast.tone] || ICONS.info}
          size={20}
          color={toast.tone === 'danger' ? '#FF9B9B' : toast.tone === 'success' ? '#7EE0AE' : '#3FA2FF'}
        />
        <Text style={styles.text}>{toast.message}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: c.navy,
    borderRadius: radius.md,
    borderWidth: c.dark ? 1 : 0,
    borderColor: c.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    maxWidth: 480,
    ...shadow,
  },
  text: { color: c.white, fontSize: font.sm, fontWeight: '700', flexShrink: 1 },
});
