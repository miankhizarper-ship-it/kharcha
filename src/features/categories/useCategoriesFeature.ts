import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createCategoriesFeature, type CategoriesFeature} from './service';

/**
 * Connects a screen to the categories feature service.
 * Same pattern as `useExpenseFeature` / `useIncomeFeature` /
 * `useBudgetFeature` / `useReportFeature`.
 */
export function useCategoriesFeature(): {
  feature: CategoriesFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<CategoriesFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createCategoriesFeature(db));
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
