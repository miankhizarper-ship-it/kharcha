import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createTransactionsFeature, type TransactionsFeature} from './service';

/**
 * Connects a screen to the combined transactions feature service.
 * Same pattern as `useExpenseFeature` / `useIncomeFeature`.
 */
export function useTransactionsFeature(): {
  feature: TransactionsFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<TransactionsFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createTransactionsFeature(db));
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
