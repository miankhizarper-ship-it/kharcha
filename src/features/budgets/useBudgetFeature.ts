import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createBudgetFeature, type BudgetFeature} from './service';

/**
 * Connects a screen to the budget feature service.
 * Same pattern as `useExpenseFeature` / `useIncomeFeature` /
 * `useTransactionsFeature`.
 */
export function useBudgetFeature(): {
  feature: BudgetFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<BudgetFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createBudgetFeature(db));
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
