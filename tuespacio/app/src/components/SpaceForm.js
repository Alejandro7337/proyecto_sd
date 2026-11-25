// Formulario de espacio: lo usan el dueño (editar su parqueadero) y el anfitrión
// (publicar o editar un garaje/lote). La validación autoritativa la hace el backend.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Note, Segmented, SectionTitle, SwitchRow, TextField, Txt } from './ui';
import { VehicleIcon } from './parking';
import { describeError } from '../api/errors';
import { HOST_SPACE_TYPES, VEHICLES } from '../domain/rules';
import { toForm, toPayload, digits } from '../domain/spaceForm';
import { space } from '../theme';
import { useTheme } from '../state/Preferences';

const DAY_OPTIONS = ['Lun – Vie', 'Lun – Sáb', 'Todos los días'];


export function SpaceForm({ initial, mode, destinations = [], onSubmit, submitLabel }) {
  const startKey = useMemo(() => JSON.stringify(toForm(initial)), [initial]);
  const [f, setF] = useState(() => JSON.parse(startKey));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(f) !== startKey;

  // Si el servidor devuelve valores nuevos (p. ej. tras guardar), el formulario los adopta.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF(JSON.parse(startKey));
  }, [startKey]);

  const set = (path, value) =>
    setF((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let o = next;
      keys.slice(0, -1).forEach((k) => {
        o = o[k];
      });
      o[keys[keys.length - 1]] = value;
      return next;
    });

  const submit = async () => {
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await onSubmit(toPayload(f, mode));
    } catch (e) {
      setErrors(e.details?.fields || {});
      setFormError(describeError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const isHost = mode === 'create' || mode === 'host-edit';
  const colors = useTheme();

  return (
    <View>
      {isHost ? (
        <>
          <TextField label="Nombre visible" value={f.name} onChangeText={(v) => set('name', v)} error={errors.name} placeholder="Ej.: Garaje cubierto cerca al metro" />
          <TextField label="Dirección" value={f.address} onChangeText={(v) => set('address', v)} error={errors.address} placeholder="Calle, carrera y número" />
        </>
      ) : null}

      <TextField label="Latitud" value={f.latitude} onChangeText={(v) => set('latitude', v)} error={errors.latitude} placeholder="4.656" helper="Coordenada exacta del acceso al parqueadero, entre -90 y 90." />
      <TextField label="Longitud" value={f.longitude} onChangeText={(v) => set('longitude', v)} error={errors.longitude} placeholder="-74.060" helper="Coordenada exacta del acceso al parqueadero, entre -180 y 180." />
      {mode === 'create' ? (
        <>
          <Txt variant="title" style={{ fontSize: 14, marginBottom: 6 }}>
            Zona
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {destinations.map((d) => (
              <Chip key={d.id} label={d.name} selected={f.destinationId === d.id} onPress={() => set('destinationId', d.id)} />
            ))}
          </View>
          {errors.destinationId ? <Txt style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.destinationId}</Txt> : null}
          <Txt variant="title" style={{ fontSize: 14, marginBottom: 6, marginTop: space.lg }}>
            Tipo de espacio
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {HOST_SPACE_TYPES.map((t) => (
              <Chip key={t} label={t} selected={f.hostType === t} onPress={() => set('hostType', t)} />
            ))}
          </View>
          {errors.hostType ? <Txt style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.hostType}</Txt> : null}
        </>
      ) : null}

      <SectionTitle title="Cupos y tarifas" />
      {errors.capacity ? (
        <Note tone="danger" icon="alert-circle-outline" style={{ marginBottom: space.md }}>
          {errors.capacity}
        </Note>
      ) : null}
      {Object.entries(VEHICLES).map(([v, meta]) => {
        const cap = Number(digits(f.capacity[v]) || 0);
        return (
          <Card key={v} style={{ marginBottom: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md }}>
              <VehicleIcon vehicle={v} size={22} color={colors.accent} />
              <Txt variant="title">{meta.label}</Txt>
            </View>
            <TextField
              label="Cupos totales"
              value={f.capacity[v]}
              onChangeText={(x) => set(`capacity.${v}`, digits(x))}
              keyboardType="number-pad"
              error={errors['capacity.' + v]}
              helper={cap === 0 ? `Con 0 cupos no recibes ${meta.label.toLowerCase()}s.` : undefined}
            />
            {cap > 0 ? (
              <>
                <Txt variant="title" style={{ fontSize: 14, marginBottom: 6 }}>
                  Cobro
                </Txt>
                <Segmented
                  options={[
                    { value: 'minute', label: 'Por minuto' },
                    { value: 'hour', label: 'Por hora' },
                  ]}
                  value={f.rates[v].unit}
                  onChange={(u) => set(`rates.${v}.unit`, u)}
                />
                <TextField
                  label={f.rates[v].unit === 'minute' ? 'Tarifa por minuto (COP)' : 'Tarifa por hora (COP)'}
                  value={f.rates[v].price}
                  onChangeText={(x) => set(`rates.${v}.price`, digits(x))}
                  keyboardType="number-pad"
                  placeholder="0"
                  error={errors['rates.' + v]}
                  style={{ marginTop: space.md, marginBottom: 0 }}
                  left={<Txt variant="muted">$</Txt>}
                />
              </>
            ) : null}
          </Card>
        );
      })}

      <SectionTitle title="Horario" />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <TextField label="Abre" value={f.schedule.open} onChangeText={(v) => set('schedule.open', v)} error={errors['schedule.open']} placeholder="07:00" style={{ flex: 1 }} maxLength={5} />
        <TextField label="Cierra" value={f.schedule.close} onChangeText={(v) => set('schedule.close', v)} error={errors['schedule.close']} placeholder="19:00" style={{ flex: 1 }} maxLength={5} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {DAY_OPTIONS.map((d) => (
          <Chip key={d} label={d} selected={f.schedule.days === d} onPress={() => set('schedule.days', d)} />
        ))}
      </View>

      <SectionTitle title="Condiciones" />
      <Card>
        <SwitchRow label="Techado" value={f.conditions.covered} onValueChange={(v) => set('conditions.covered', v)} />
        <SwitchRow label="Hay que dejar las llaves" description="Los conductores lo verán antes de reservar." value={f.conditions.keys} onValueChange={(v) => set('conditions.keys', v)} />
        <TextField
          label="Altura máxima (m)"
          value={f.conditions.maxHeight}
          onChangeText={(v) => set('conditions.maxHeight', v.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="Vacío si no hay restricción"
          error={errors['conditions.maxHeight']}
          style={{ marginTop: space.sm, marginBottom: 0 }}
        />
      </Card>

      {mode !== 'create' ? (
        <>
          <SectionTitle title="Publicación" />
          <Card>
            <SwitchRow
              label="Visible en el mapa"
              description={f.published ? 'Los conductores pueden encontrarte y reservar.' : 'Pausado: no apareces ni recibes reservas nuevas.'}
              value={f.published}
              onValueChange={(v) => set('published', v)}
            />
          </Card>
        </>
      ) : (
        <>
          <SectionTitle title="Verificación de identidad" />
          <Card>
            <SwitchRow
              label="Inicio mi verificación de identidad"
              description="Solicita la revisión de identidad y del espacio. La publicación requiere aprobación de administración."
              value={f.identityConsent}
              onValueChange={(v) => set('identityConsent', v)}
            />
            {errors.identityConsent ? <Txt style={{ color: colors.danger, fontSize: 12 }}>{errors.identityConsent}</Txt> : null}
          </Card>
          <Note style={{ marginTop: space.md }}>
            Consulta las condiciones y la comisión vigente antes de habilitar tu espacio.
          </Note>
        </>
      )}

      {formError ? (
        <Note tone="danger" icon="alert-circle-outline" style={{ marginTop: space.lg }}>
          {formError}
        </Note>
      ) : null}
      <Button title={submitLabel} onPress={submit} loading={saving} disabled={mode !== 'create' && !dirty} style={{ marginTop: space.xl }} />
      {mode !== 'create' && !dirty ? (
        <Txt variant="small" style={{ textAlign: 'center', marginTop: space.sm }}>
          Sin cambios por guardar
        </Txt>
      ) : null}
    </View>
  );
}
