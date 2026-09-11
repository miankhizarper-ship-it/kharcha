import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createExpenseFeature, type ExpenseFeature} from './service';

/**
 * Connects a screen to the expense feature service.
 *
 * `App.tsx` only renders navigation after `openDatabase()` has resolved, so
 * the promise below completes immediately in practice; the hook still models
 * the async hand-off honestly instead of hiding it behind a module singleton.
 */
export function useExpenseFeature(): {
  feature: ExpenseFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<ExpenseFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createExpenseFeature(db));
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
