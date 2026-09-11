/**
 * Tokens shared with the operator console, so both surfaces read as one product.
 *
 * Sizes are tuned for a herder holding the phone one-handed in a pen: 48dp minimum targets, a
 * large numeric keypad, and contrast that survives direct sunlight (scope NFR-04, NFR-05).
 */
export const colors = {
  paper: '#F3F4F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EAECF1',
  ink: '#16233B',
  inkSoft: '#3A4761',
  muted: '#68738C',
  line: '#D8DCE5',
  accent: '#A96613',
  accentSoft: '#F0E3D0',
  sage: '#4A7358',
  sageSoft: '#DFE9E1',
  rust: '#9E3B2C',
  rustSoft: '#F2DFDB',
  onAccent: '#FFFFFF',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const type = {
  display: 30,
  title: 22,
  heading: 18,
  body: 16,
  label: 14,
  caption: 12,
} as const;

/** Nothing interactive is smaller than this. Gloves and dust are the operating conditions. */
export const MIN_TOUCH = 48;
