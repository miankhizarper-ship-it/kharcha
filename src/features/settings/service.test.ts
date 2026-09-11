/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {
  SETTINGS_KEYS,
  coerceCurrency,
  coerceThemeMode,
  createSettingsFeature,
  DEFAULT_SETTINGS,
} from './service';
import type {SettingsFeature} from './service';
import {DEFAULT_CURRENCY} from '@/store/settingsStore';

/**
 * Settings persistence on the REAL SQLite engine: defaults, updates and
 * fallbacks for missing/invalid stored values.
 */
describe('SettingsFeature', () => {
  let service: DatabaseService;
  let feature: SettingsFeature;

  beforeEach(async () => {
    service = await createTestService();
    feature = createSettingsFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  it('returns defaults when nothing has been saved yet', async () => {
    await expect(feature.load()).resolves.toEqual({
      currency: DEFAULT_CURRENCY,
      themeMode: 'system',
    });
  });

  it('persists the display currency without touching amounts', async () => {
    await feature.saveCurrency('USD');
    expect((await feature.load()).currency).toBe('USD');

    await feature.saveCurrency('SAR');
    expect((await feature.load()).currency).toBe('SAR');
    // Stored exactly once under the documented key.
    expect(await service.settings.get(SETTINGS_KEYS.currency)).toBe('SAR');
  });

  it('persists the theme selection', async () => {
    await feature.saveThemeMode('dark');
    expect((await feature.load()).themeMode).toBe('dark');

    await feature.saveThemeMode('system');
    expect((await feature.load()).themeMode).toBe('system');
  });

  it('values survive a "restart" (new feature instance, same database)', async () => {
    await feature.saveCurrency('AED');
    await feature.saveThemeMode('light');

    const freshFeature = createSettingsFeature(service);
    await expect(freshFeature.load()).resolves.toEqual({
      currency: 'AED',
      themeMode: 'light',
    });
  });

  it('rejects unsupported currency codes and theme modes', async () => {
    await expect(feature.saveCurrency('XXX')).rejects.toThrow(/unsupported/i);
    await expect(feature.saveThemeMode('blue' as never)).rejects.toThrow(
      /unsupported/i,
    );
    // The failed saves left no garbage behind.
    expect(await service.settings.get(SETTINGS_KEYS.currency)).toBeNull();
    expect(await service.settings.get(SETTINGS_KEYS.themeMode)).toBeNull();
  });

  it('falls back to defaults for hand-corrupted stored values', async () => {
    await service.settings.set(SETTINGS_KEYS.currency, 'BTC');
    await service.settings.set(SETTINGS_KEYS.themeMode, 'blue');

    await expect(feature.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('coercion helpers are null-safe', () => {
    expect(coerceCurrency(null)).toBe(DEFAULT_CURRENCY);
    expect(coerceCurrency('PKR')).toBe('PKR');
    expect(coerceCurrency('INVALID')).toBe(DEFAULT_CURRENCY);
    expect(coerceThemeMode(null)).toBe('system');
    expect(coerceThemeMode('dark')).toBe('dark');
    expect(coerceThemeMode('DARK')).toBe('system');
  });
});
