/**
 * Sawaari — shared semantic design tokens.
 *
 * Clean white surfaces, light mint backgrounds, and a fresh green brand.
 * All screens import from here to stay in sync.
 */

export const colors = {
  // Backgrounds
  bg: '#F4FBF6',
  bgAlt: '#F5F7F5',
  surface: '#FFFFFF',
  surfaceSecondary: '#F5F7F5',
  surfaceMint: '#E8F8ED',

  // Brand
  primary: '#45C96B',
  primaryDark: '#36B75A',
  primaryLight: '#E8F8ED',

  // Accent
  accent: '#C2410C',
  accentLight: '#FEE9DF',

  // Text
  textPrimary: '#171A18',
  textSecondary: '#7A817C',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',
  textMuted: '#A4AAA6',
  textDisabled: '#A6ACA8',

  // Semantic
  error: '#DC2626',
  errorLight: '#FEE2E2',
  success: '#059669',
  successLight: '#D1FAE5',

  // Borders / dividers
  border: '#E8ECE9',
  divider: '#E8ECE9',
  disabled: '#E8ECE9',

  // Numpad / interactive
  keyBg: '#FFFFFF',
  keyBorder: '#E8ECE9',
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 99,
} as const;

export const layout = {
  cardRadius: 14,
  cardPaddingHorizontal: 16,
  cardPaddingVertical: 14,
  compactGap: 8,
  rowMinHeight: 56,
  screenHorizontalPadding: 16,
  sectionGap: 16,
} as const;

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1,
  },
  button: {
    shadowColor: '#45C96B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
} as const;

export const fontSize = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 24,
  '2xl': 29,
  '3xl': 36,
} as const;

export const fontFamily = 'NotoSansTelugu';
