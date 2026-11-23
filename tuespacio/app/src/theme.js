// Tokens visuales de Tu Espacio. Identidad del mockup: azul marino de marca (#0B2545),
// acento celeste (#3FA2FF), tarjetas blancas muy redondeadas y tipografía de peso alto.
// Dos paletas (clara y oscura) con la misma forma: las pantallas leen `useTheme()`.
const brand = {
  navy: '#0B2545',
  navySoft: '#1E3A64',
  accent: '#3FA2FF',
  white: '#FFFFFF',
};

const light = {
  ...brand,
  dark: false,
  // Acción principal: marino con texto blanco (botones del mockup).
  action: brand.navy,
  actionPressed: brand.navySoft,
  onAction: brand.white,
  // Enlaces y estados "info": azul con contraste ≥ 4.5:1 sobre blanco.
  primary: '#1F6FD1',
  primarySoft: '#EEF7FF',

  bg: '#FFFFFF',
  card: '#FFFFFF',
  surface: '#F4F6F9',
  surfacePressed: '#E9EDF3',
  border: '#E4E9F0',
  borderStrong: '#CBD3DE',
  heading: brand.navy,
  text: '#0F1B2D',
  textMuted: '#475569',
  textSubtle: '#64748B',
  overlay: 'rgba(255,255,255,0.95)',

  success: '#047857',
  successSolid: '#059669',
  successSoft: '#D1FAE5',
  warning: '#B45309',
  warningSolid: '#F97316',
  warningSoft: '#FFEDD5',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  neutral: '#5B6676',
  neutralSolid: '#94A3B8',
  neutralSoft: '#EFF2F6',

  map: '#DCEBEA',
  mapStreet: 'rgba(255,255,255,0.85)',
  mapPark: '#C8E3D3',
  mapWater: '#D9EDF7',
};

const dark = {
  ...brand,
  dark: true,
  // En oscuro el marino pierde contraste: la acción pasa al acento con texto marino.
  action: brand.accent,
  actionPressed: '#2C8CE6',
  onAction: brand.navy,
  primary: '#6CB8FF',
  primarySoft: 'rgba(63,162,255,0.16)',

  bg: '#07101D',
  card: '#0F1A2B',
  surface: '#14223A',
  surfacePressed: '#1C2D4A',
  border: '#22324D',
  borderStrong: '#34476A',
  heading: '#FFFFFF',
  text: '#EEF3FA',
  textMuted: '#A9B6C9',
  textSubtle: '#8597B0',
  overlay: 'rgba(7,16,29,0.95)',

  success: '#34D399',
  successSolid: '#10B981',
  successSoft: 'rgba(16,185,129,0.16)',
  warning: '#FDBA74',
  warningSolid: '#F97316',
  warningSoft: 'rgba(249,115,22,0.16)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  neutral: '#A9B6C9',
  neutralSolid: '#64748B',
  neutralSoft: 'rgba(148,163,184,0.14)',

  map: '#0F2236',
  mapStreet: 'rgba(255,255,255,0.08)',
  mapPark: '#123528',
  mapWater: '#10263E',
};

export const palettes = { light, dark };

export const makeTones = (c) => ({
  success: { fg: c.success, bg: c.successSoft, solid: c.successSolid },
  warning: { fg: c.warning, bg: c.warningSoft, solid: c.warningSolid },
  danger: { fg: c.danger, bg: c.dangerSoft, solid: c.danger },
  neutral: { fg: c.neutral, bg: c.neutralSoft, solid: c.neutralSolid },
  info: { fg: c.primary, bg: c.primarySoft, solid: c.accent },
});

// Ritmo de 4/8: 16 componente · 24 grupo · 32 sección.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

// rounded-xl · rounded-2xl · rounded-3xl · rounded-[28px] del mockup.
export const radius = { sm: 12, md: 16, lg: 24, xl: 28, pill: 999 };

export const font = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 30,
};

export const shadow = {
  shadowColor: '#0B2545',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
};

export const softShadow = {
  shadowColor: '#0B2545',
  shadowOpacity: 0.06,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
};
