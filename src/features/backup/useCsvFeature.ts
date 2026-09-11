import {useEffect, useState} from 'react';

import {openDatabase} from '@/database/connection';
import type {DatabaseService} from '@/database/service';
import {
  createCsvImportFeature,
  type CsvImportFeature,
} from './csvImportService';

/**
 * Connects the CSV export/import screens to the local database.
 *
 * Export is a pure function of the database (`prepareCsvExport`), while
 * import runs through the stateless `CsvImportFeature` — both need only a
 * memoized connection, so one hook serves the whole data-lifecycle flow
 * (same pattern as `useBackupFeature`).
 */
export function useCsvFeature(): {
  db: DatabaseService | null;
  importFeature: CsvImportFeature | null;
  loadError: string | null;
} {
  const [db, setDb] = useState<DatabaseService | null>(null);
  const [importFeature, setImportFeature] = useState<CsvImportFeature | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    openDatabase()
      .then(database => {
        if (active) {
          setDb(database);
          setImportFeature(createCsvImportFeature(database));
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

  return {db, importFeature, loadError};
}
