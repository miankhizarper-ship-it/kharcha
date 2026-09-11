import {useColorScheme} from 'react-native';

/**
 * Theme selection as the user chooses it in Settings. 'system' follows the
 * device setting at runtime (both palettes stay available either way).
 */
export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function isThemeMode(value: string): value is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(value);
}

/**
 * Resolves the user's selection into the active palette mode.
 *
 * Pure so the system-following behavior is unit-testable without React:
 * 'light'/'dark' pass through; 'system' maps the OS color scheme to a
 * palette, defaulting to light when the scheme is unavailable/unspecified
 * (older devices, some test environments).
 */
export function resolveThemeMode(
  mode: ThemeMode,
  systemColorScheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): 'light' | 'dark' {
  if (mode === 'system') {
    return systemColorScheme === 'dark' ? 'dark' : 'light';
  }
  return mode;
}

/** Convenience hook-side adapter used by ThemeProvider. */
export function useResolvedThemeMode(mode: ThemeMode): 'light' | 'dark' {
  const systemColorScheme = useColorScheme();
  return resolveThemeMode(mode, systemColorScheme);
}
