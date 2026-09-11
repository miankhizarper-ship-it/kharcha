import type {DatabaseService} from '@/database/service';
import {isSupportedCurrency} from '@/store/settingsStore';
import {isThemeMode, type ThemeMode} from '@/theme/resolveMode';
import {DEFAULT_CURRENCY} from './currencies';

/**
 * SQLite keys for user settings. Values are plain strings in the `settings`
 * key/value table (see SettingsRepository) — the ONLY persistence mechanism
 * for settings; there is no parallel storage.
 */
export const SETTINGS_KEYS = {
  currency: 'currency',
  themeMode: 'themeMode',
} as const;

/** The complete user-settings shape, with defaults applied. */
export interface AppSettings {
  currency: string;
  themeMode: ThemeMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  currency: DEFAULT_CURRENCY,
  themeMode: 'system',
};

/**
 * Coerces one stored setting into its typed value. Missing AND invalid
 * values fall back to the default instead of propagating garbage (spec §15:
 * "invalid values", "missing setting fallback") — a hand-edited or
 * partially-written row can never crash the app.
 */
export function coerceCurrency(value: string | null): string {
  return value !== null && isSupportedCurrency(value)
    ? value
    : DEFAULT_SETTINGS.currency;
}

export function coerceThemeMode(value: string | null): ThemeMode {
  return value !== null && isThemeMode(value)
    ? value
    : DEFAULT_SETTINGS.themeMode;
}

/**
 * Feature-level service for user settings.
 *
 * Contract style matches the other features: injectable `DatabaseService`
 * for `node:sqlite` tests, SQLite as the single source of truth, and the
 * Zustand mirror (`store/settingsStore`) updated by callers right after a
 * successful save so the UI reacts immediately.
 */
export interface SettingsFeature {
  /**
   * Loads all settings, applying defaults/coercion. Never rejects for
   * missing rows — only for database-level failures.
   */
  load(): Promise<AppSettings>;

  /** Persists the display currency (symbol/code change only). */
  saveCurrency(code: string): Promise<void>;

  /** Persists the theme selection; applies immediately via the store. */
  saveThemeMode(mode: ThemeMode): Promise<void>;
}

export function createSettingsFeature(db: DatabaseService): SettingsFeature {
  return {
    async load(): Promise<AppSettings> {
      const rows = await db.settings.getAll();
      const byKey = new Map(rows.map(row => [row.key, row.value]));
      return {
        currency: coerceCurrency(byKey.get(SETTINGS_KEYS.currency) ?? null),
        themeMode: coerceThemeMode(byKey.get(SETTINGS_KEYS.themeMode) ?? null),
      };
    },

    async saveCurrency(code: string): Promise<void> {
      if (!isSupportedCurrency(code)) {
        throw new Error(`Unsupported currency: ${code}`);
      }
      await db.settings.set(SETTINGS_KEYS.currency, code);
    },

    async saveThemeMode(mode: ThemeMode): Promise<void> {
      if (!isThemeMode(mode)) {
        throw new Error(`Unsupported theme mode: ${mode}`);
      }
      await db.settings.set(SETTINGS_KEYS.themeMode, mode);
    },
  };
}
