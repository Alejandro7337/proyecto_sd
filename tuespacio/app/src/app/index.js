import { Redirect } from 'expo-router';
import { useApp } from '../state/AppContext';
import { ROLES } from '../domain/rules';

// Punto de entrada: envía a cada perfil a su inicio, o a la bienvenida sin sesión.
export default function Index() {
  const { user } = useApp();
  if (!user) return <Redirect href="/welcome" />;
  return <Redirect href={ROLES[user.role].home} />;
}
