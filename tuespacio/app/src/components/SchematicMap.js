// Mapa ILUSTRATIVO centrado en el destino, con el estilo del mockup (calles diagonales,
// pines de color con borde blanco y "Tu destino" al centro). No usa un proveedor de mapas real:
// las posiciones vienen del backend simulado. En la versión real se reemplaza por un SDK de
// mapas (por definir) manteniendo la misma interfaz de props.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { font, radius, shadow } from '../theme';
import { RATE_UNITS } from '../domain/rules';
import { useStyles, useTheme } from '../state/Preferences';

const PIN_W = 104;
const PIN_H = 32;

// Calles diagonales: [desplazamiento vertical %, ángulo].
const STREETS = [
  [18, 30],
  [52, 30],
  [86, 30],
  [30, -60],
  [70, -60],
];

const shortPrice = (rate) => {
  const p = rate.price >= 1000 ? (rate.price / 1000).toFixed(1).replace('.0', '').replace('.', ',') + ' mil' : rate.price;
  return '$' + p + RATE_UNITS[rate.unit].short;
};

export function SchematicMap({ spaces, vehicle, selectedId, onSelect, destinationName, height = 290 }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const toPx = (pos) => ({
    left: size.w * (0.5 + pos.x * 0.4),
    top: size.h * (0.52 + pos.y * 0.34),
  });
  const pinColor = { available: c.successSolid, few: c.warningSolid, full: c.neutralSolid };

  return (
    <View
      style={[styles.map, { height }]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityLabel={`Mapa ilustrativo con ${spaces.length} espacios cerca de ${destinationName}`}
    >
      <View style={[styles.park, { left: '72%', top: '74%' }]} />
      <View style={[styles.water, { left: '-6%', top: '62%' }]} />
      {STREETS.map(([top, angle]) => (
        <View key={top + '_' + angle} style={[styles.street, { top: `${top}%`, transform: [{ rotate: `${angle}deg` }] }]} />
      ))}

      {size.w > 0 ? (
        <>
          <View style={[styles.destination, { left: size.w / 2 - 52, top: size.h * 0.52 - 15 }]} pointerEvents="none">
            <Ionicons name="navigate" size={13} color={c.white} />
            <Text style={styles.destinationText}>Tu destino</Text>
          </View>
          {spaces.map((s) => {
            const { left, top } = toPx(s.pos);
            const status = s.availability[vehicle].status;
            const selected = s.id === selectedId;
            const bg = selected ? (c.dark ? c.accent : c.navy) : pinColor[status] || c.neutralSolid;
            const fg = selected && c.dark ? c.navy : c.white;
            return (
              <Pressable
                key={s.id}
                onPress={() => onSelect(s.id)}
                accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${shortPrice(s.rates[vehicle])}${status === 'full' ? ', lleno' : status === 'few' ? ', pocos cupos' : ''}`}
                accessibilityState={{ selected }}
                hitSlop={8}
                style={[styles.pinWrap, { left: left - PIN_W / 2, top: top - PIN_H - 4, zIndex: selected ? 10 : 2 }]}
              >
                <View style={[styles.pin, { backgroundColor: bg }, selected && styles.pinSelected]}>
                  {s.kind === 'particular' ? <Ionicons name="home" size={11} color={fg} /> : null}
                  <Text style={[styles.pinText, { color: fg }]} numberOfLines={1}>
                    {shortPrice(s.rates[vehicle])}
                  </Text>
                </View>
                <View style={[styles.pinTip, { borderTopColor: c.white }]} />
              </Pressable>
            );
          })}
        </>
      ) : null}

      <View style={styles.place} pointerEvents="none">
        <Ionicons name="location" size={13} color={c.navy} />
        <Text style={styles.placeText} numberOfLines={1}>
          {destinationName}
        </Text>
      </View>

      {selectedId ? (
        <Pressable onPress={() => onSelect(null)} accessibilityRole="button" accessibilityLabel="Quitar selección del mapa" style={styles.center} hitSlop={6}>
          <Ionicons name="locate" size={20} color={c.navy} />
        </Pressable>
      ) : null}

      <View style={styles.legend} pointerEvents="none">
        <Dot color={c.successSolid} label="Libre" styles={styles} />
        <Dot color={c.warningSolid} label="Pocos" styles={styles} />
        <Dot color={c.neutralSolid} label="Lleno" styles={styles} />
        <Text style={styles.legendText}>· Ilustrativo</Text>
      </View>
    </View>
  );
}

function Dot({ color, label, styles }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const makeStyles = (c) => ({
  map: { backgroundColor: c.map, borderRadius: radius.xl, overflow: 'hidden' },
  park: { position: 'absolute', width: '24%', height: '20%', backgroundColor: c.mapPark, borderRadius: 18 },
  water: { position: 'absolute', width: '22%', height: '30%', backgroundColor: c.mapWater, borderRadius: 40 },
  street: { position: 'absolute', left: '-50%', width: '200%', height: 9, backgroundColor: c.mapStreet },
  destination: {
    position: 'absolute',
    width: 104,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: c.navy,
    borderWidth: c.dark ? 1 : 0,
    borderColor: c.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    zIndex: 0,
    opacity: 0.94,
  },
  destinationText: { color: c.white, fontSize: font.xs, fontWeight: '800' },
  pinWrap: { position: 'absolute', width: PIN_W, alignItems: 'center' },
  pin: {
    height: PIN_H,
    maxWidth: PIN_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: c.white,
    ...shadow,
  },
  pinSelected: { transform: [{ scale: 1.12 }] },
  pinText: { fontSize: 12, fontWeight: '900' },
  pinTip: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  place: {
    position: 'absolute',
    left: 12,
    top: 12,
    maxWidth: '75%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: c.white,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    zIndex: 6,
  },
  placeText: { color: c.navy, fontSize: font.xs, fontWeight: '800', flexShrink: 1 },
  center: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
    ...shadow,
  },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  legendText: { fontSize: 10, color: '#334155', fontWeight: '700' },
});
