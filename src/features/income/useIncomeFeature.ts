import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createIncomeFeature, type IncomeFeature} from './service';

/**
 * Connects a screen to the income feature service.
 *
 * Same pattern as `useExpenseFeature`: `App.tsx` only renders navigation
 * after `openDatabase()` has resolved, so the promise completes immediately
 * in practice; the hook still models the async hand-off honestly instead of
 * hiding it behind a module singleton.
 */
export function useIncomeFeature(): {
  feature: IncomeFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<IncomeFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createIncomeFeature(db));
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
