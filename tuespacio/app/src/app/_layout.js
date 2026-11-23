import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../state/AppContext';
import { PreferencesProvider, usePreferences } from '../state/Preferences';
import { Toast } from '../components/Toast';

function ThemedStack() {
  const { colors: c, dark } = usePreferences();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="demo" options={{ presentation: 'modal' }} />
      </Stack>
      <Toast />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <AppProvider>
          <ThemedStack />
        </AppProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
