import { Redirect } from 'expo-router';
import { useApp } from '../state/AppContext';
import { ROLES } from '../domain/rules';
import { configError } from '../api/transport';
import { Screen } from '../components/layout';
import { ErrorState, LoadingState } from '../components/states';

// Punto de entrada: envía a cada perfil a su inicio, o a la bienvenida sin sesión.
export default function Index() {
  const { user, ready } = useApp();
  if (configError) {
    return (
      <Screen>
        <ErrorState error={{ code: 'CONFIG', message: configError }} />
      </Screen>
    );
  }
  if (!ready) {
    return (
      <Screen>
        <LoadingState label="Abriendo Tu Espacio…" />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/welcome" />;
  return <Redirect href={ROLES[user.role].home} />;
}
