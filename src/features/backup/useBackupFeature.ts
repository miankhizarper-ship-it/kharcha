import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createBackupFeature, type BackupFeature} from './service';

/**
 * Connects a screen to the backup feature service.
 * Same pattern as `useExpenseFeature` / `useCategoriesFeature` /
 * `useSettingsFeature`: the database promise is memoized, the feature is
 * stateless, and failures surface as a friendly message instead of a crash.
 */
export function useBackupFeature(): {
  feature: BackupFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<BackupFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createBackupFeature(db));
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

  return {feature, loadError};
}
