import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createRecurringFeature, type RecurringFeature} from './service';

/**
 * Connects a screen to the recurring feature service.
 * Same pattern as `useExpenseFeature` / `useBackupFeature`: the database
 * promise is memoized, the feature is stateless, and failures surface as a
 * friendly message instead of a crash.
 */
export function useRecurringFeature(): {
  feature: RecurringFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<RecurringFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createRecurringFeature(db));
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
