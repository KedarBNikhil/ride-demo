/**
 * Nandyal Ride — Design Tokens ("Hometown Pride" theme)
 *
 * Warm cream + deep teal + terracotta accent.
 * All screens import from here to stay in sync.
 */

export const colors = {
  // Backgrounds
  bg: '#FBF7F0',
  bgAlt: '#FEF3C7',
  surface: '#FFFFFF',
  surfaceMint: '#CCFBEF',

  // Brand
  primary: '#0D7A6B',
  primaryDark: '#064E45',
  primaryLight: '#E0F7F3',

  // Accent
  accent: '#C2410C',
  accentLight: '#FEE9DF',

  // Text
  textPrimary: '#1A1A2E',
  textSecondary: '#5A5A72',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',
  textMuted: '#8A8AAA',

  // Semantic
  error: '#DC2626',
  errorLight: '#FEE2E2',
  success: '#059669',
  successLight: '#D1FAE5',

  // Borders / dividers
  border: '#E8DECA',
  divider: '#EDE7DC',

  // Numpad / interactive
  keyBg: '#FFFFFF',
  keyBorder: '#DDD6C8',
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 99,
} as const;

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  button: {
    shadowColor: '#0D7A6B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
