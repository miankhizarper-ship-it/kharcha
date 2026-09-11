/**
 * Color tokens for Kharcha.
 *
 * Light and dark palettes share the exact same shape, so the ThemeProvider can
 * swap them at runtime without any component-level changes.
 * Keep every color referenced through `useTheme().colors` — no hardcoding.
 */
export const lightColors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF1F4',
  border: '#E4E7EC',
  text: '#111827',
  textMuted: '#667085',
  textInverse: '#FFFFFF',
  primary: '#16A34A',
  primaryMuted: '#DCFCE7',
  onPrimary: '#FFFFFF',
  onDanger: '#FFFFFF',
  danger: '#DC2626',
  dangerMuted: '#FEE2E2',
  warning: '#D97706',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E4E7EC',
  tabBarInactive: '#98A2B3',
  /** Scrim behind modal sheets — darker than `overlay` so sheet content pops. */
  backdrop: 'rgba(0, 0, 0, 0.45)',
  overlay: 'rgba(17, 24, 39, 0.15)',
} as const;

export const darkColors = {
  background: '#0B0F14',
  surface: '#151B23',
  surfaceMuted: '#1D2632',
  border: '#263041',
  text: '#F2F5F9',
  textMuted: '#98A2B3',
  textInverse: '#0B0F14',
  primary: '#22C55E',
  primaryMuted: '#14321F',
  onPrimary: '#052E13',
  onDanger: '#450A0A',
  danger: '#F87171',
  dangerMuted: '#3B1414',
  warning: '#FBBF24',
  tabBar: '#10161E',
  tabBarBorder: '#263041',
  tabBarInactive: '#667085',
  /** Scrim behind modal sheets — slightly darker than light mode for contrast. */
  backdrop: 'rgba(0, 0, 0, 0.55)',
  overlay: 'rgba(0, 0, 0, 0.4)',
} as const;

/**
 * Widened palette shape: both palettes must provide every key, with any
 * string value (the `as const` literals are an implementation detail).
 */
export type ThemeColors = {[K in keyof typeof lightColors]: string};
