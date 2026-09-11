import {create} from 'zustand';

import type {ThemeMode} from '@/theme/resolveMode';

/** Currencies Kharcha can display. Kept next to the settings feature. */
export const SUPPORTED_CURRENCIES = [
  'PKR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SAR',
  'INR',
  'BDT',
  'TRY',
  'CNY',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'MYR',
  'SGD',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'PKR';

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

interface SettingsState {
  /**
   * User-selected theme mode. 'system' follows the OS setting; the active
   * palette is resolved in `ThemeProvider`. SQLite is the persistence source
   * of truth — this store mirrors it at runtime (hydrated at launch).
   */
  themeMode: ThemeMode;
  /**
   * Currency code used when DISPLAYING amounts. Amounts are stored as
   * currency-agnostic minor units — switching currency only changes the
   * symbol/code shown, never any historical value.
   */
  currency: string;
  setThemeMode: (mode: ThemeMode) => void;
  setCurrency: (currency: string) => void;
  /**
   * Applies values loaded from SQLite at launch. Only called by the settings
   * feature's bootstrap; runtime changes go through the setters above.
   */
  hydrate: (values: {themeMode?: ThemeMode; currency?: string}) => void;
}

/**
 * Global, single-user settings mirror. Zustand fits Kharcha well: no
 * providers, no boilerplate, and selectors keep re-renders cheap.
 */
export const useSettingsStore = create<SettingsState>(set => ({
  themeMode: 'system',
  currency: DEFAULT_CURRENCY,
  setThemeMode: themeMode => set({themeMode}),
  setCurrency: currency => set({currency}),
  hydrate: values =>
    set(state => ({
      themeMode: values.themeMode ?? state.themeMode,
      currency: values.currency ?? state.currency,
    })),
}));
