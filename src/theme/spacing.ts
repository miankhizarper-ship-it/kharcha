/**
 * Spacing and corner-radius tokens.
 * Scale is deliberately small (4 / 8 / 16 / 24 / 32) — compose with multiples
 * only when a layout truly requires it.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 999,
} as const;

/**
 * Platform shadow/elevation styles. The only elevated surface in Kharcha is
 * the FAB — tokenized here so any future elevated surface matches it.
 * `shadowColor` stays black in both modes (standard for soft UI shadows).
 */
export const elevation = {
  fab: {
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
} as const;
