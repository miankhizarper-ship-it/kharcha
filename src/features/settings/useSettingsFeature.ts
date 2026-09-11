import {useCallback, useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {useSettingsStore} from '@/store/settingsStore';
import type {ThemeMode} from '@/theme/resolveMode';
import {createSettingsFeature, type SettingsFeature} from './service';

/**
 * Connects the Settings screen to the settings feature service AND the
 * runtime store. Saves write through SQLite first (source of truth), then
 * update the store so every watching screen re-renders immediately — the
 * theme changes the moment a segment is tapped.
 */
export function useSettingsFeature(): {
  feature: SettingsFeature | null;
  loadError: string | null;
  currency: string;
  themeMode: ThemeMode;
  saving: boolean;
  saveError: string | null;
  changeCurrency: (code: string) => Promise<boolean>;
  changeThemeMode: (mode: ThemeMode) => Promise<boolean>;
} {
  const [feature, setFeature] = useState<SettingsFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currency = useSettingsStore(state => state.currency);
  const themeMode = useSettingsStore(state => state.themeMode);
  const setCurrency = useSettingsStore(state => state.setCurrency);
  const setThemeMode = useSettingsStore(state => state.setThemeMode);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createSettingsFeature(db));
        }
      })
      .catch(() => {
        if (active) {
          setLoadError('The local database is unavailable.');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const changeCurrency = useCallback(
    async (code: string) => {
      if (!feature || saving) {
        return false;
      }
      setSaving(true);
      setSaveError(null);
      try {
        await feature.saveCurrency(code);
        setCurrency(code);
        return true;
      } catch {
        setSaveError('Could not save the setting. Please try again.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [feature, saving, setCurrency],
  );

  const changeThemeMode = useCallback(
    async (mode: ThemeMode) => {
      if (!feature || saving) {
        return false;
      }
      setSaving(true);
      setSaveError(null);
      try {
        await feature.saveThemeMode(mode);
        setThemeMode(mode);
        return true;
      } catch {
        setSaveError('Could not save the setting. Please try again.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [feature, saving, setThemeMode],
  );

  return {
    feature,
    loadError,
    currency,
    themeMode,
    saving,
    saveError,
    changeCurrency,
    changeThemeMode,
  };
}
