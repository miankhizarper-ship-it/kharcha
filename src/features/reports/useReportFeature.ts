import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import {createReportFeature, type ReportFeature} from './service';

/**
 * Connects a screen to the report feature service.
 * Same pattern as `useExpenseFeature` / `useIncomeFeature` /
 * `useTransactionsFeature` / `useBudgetFeature`.
 */
export function useReportFeature(): {
  feature: ReportFeature | null;
  loadError: string | null;
} {
  const [feature, setFeature] = useState<ReportFeature | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(db => {
        if (active) {
          setFeature(createReportFeature(db));
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
