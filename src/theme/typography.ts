/**
 * Typography tokens.
 *
 * Kharcha intentionally ships with the system font (Roboto on Android) to
 * keep the bundle lean. If custom fonts are ever added, set `fontFamily`
 * here once and every `Text` component picks it up.
 */
export const typography = {
  size: {
    caption: 12,
    label: 13,
    body: 15,
    title: 20,
    display: 28,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;
