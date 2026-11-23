import { ProfileScreen, PendingNote } from '../../components/ProfileScreen';
import { Badge, Card, SectionTitle, Txt } from '../../components/ui';
import { api } from '../../api';
import { useApp } from '../../state/AppContext';
import { useQuery } from '../../state/useQuery';
import { space } from '../../theme';

const IDENTITY = {
  pending: { label: 'Pendiente', tone: 'warning', text: 'Inicia la verificación al publicar tu primer espacio.' },
  in_review: { label: 'En revisión (simulada)', tone: 'warning', text: 'Tu espacio está publicado mientras se revisa tu identidad.' },
  verified: { label: 'Verificada', tone: 'success', text: 'Tu identidad está verificada.' },
};

export default function HostProfile() {
  const { user } = useApp();
  const me = useQuery(() => api.me(), []);
  const status = IDENTITY[(me.data || user).identity] || IDENTITY.pending;
  return (
    <ProfileScreen>
      <SectionTitle title="Verificación de identidad" />
      <Card>
        <Badge label={status.label} tone={status.tone} />
        <Txt variant="muted" style={{ marginTop: space.sm }}>
          {status.text}
        </Txt>
      </Card>
      <PendingNote>
        Verificación de identidad, calificaciones mutuas y responsabilidad por daños son reglas obligatorias que se definirán con el área legal antes del lanzamiento.
      </PendingNote>
    </ProfileScreen>
  );
}
