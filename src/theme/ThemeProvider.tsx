import React, {createContext, useContext, useMemo} from 'react';

import {useSettingsStore} from '@/store/settingsStore';
import type {ThemeColors} from './colors';
import {darkColors, lightColors} from './colors';
import {useResolvedThemeMode} from './resolveMode';
import {elevation, radius, spacing} from './spacing';
import {typography} from './typography';

export interface Theme {
  /**
   * ACTIVE palette mode ('light' | 'dark') — the resolved result of the
   * user's selection ('light' | 'dark' | 'system', persisted in the settings
   * store) against the OS color scheme.
   */
  mode: 'light' | 'dark';
  isDark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const selectedMode = useSettingsStore(state => state.themeMode);
  // Resolves 'system' against the OS color scheme; 'light'/'dark' pass
  // through. Switching modes updates the palette immediately.
  const mode = useResolvedThemeMode(selectedMode);

  const value = useMemo<Theme>(
    () => ({
      mode,
      isDark: mode === 'dark',
      colors: mode === 'dark' ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      elevation,
    }),
    [mode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return theme;
}
