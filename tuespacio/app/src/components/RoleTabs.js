// Navegación inferior por perfil (barra del mockup: ícono + etiqueta, activo en celeste).
// Protege las rutas: sin sesión del rol, vuelve al inicio.
import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { usePreferences } from '../state/Preferences';

export function RoleTabs({ role, tabs }) {
  const { user } = useApp();
  const { colors: c, t } = usePreferences();
  const insets = useSafeAreaInsets();
  if (!user || user.role !== role) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
        tabBarStyle: {
          borderTopColor: c.border,
          borderTopWidth: 1,
          backgroundColor: c.overlay,
          elevation: 0,
          height: 68 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 6,
        },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.labelKey ? t[tab.labelKey] : tab.title,
            tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? tab.icon : tab.icon + '-outline'} size={22} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
