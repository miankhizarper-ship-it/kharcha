import {OpSqliteDriver} from './drivers/opsqlite';
import {DatabaseService} from './service';

/** File name of the single local SQLite database. */
export const DB_NAME = 'kharcha.db';

let dbServicePromise: Promise<DatabaseService> | null = null;

/**
 * Opens (once) the app-wide `DatabaseService` on top of op-sqlite.
 *
 * Safe to call from multiple bootstrap paths: the promise is memoized, and a
 * failure clears it so the next call can retry from scratch. All data stays
 * on-device — there is no sync layer, by design.
 */
export function openDatabase(): Promise<DatabaseService> {
  if (!dbServicePromise) {
    dbServicePromise = DatabaseService.open(new OpSqliteDriver(DB_NAME)).catch(
      error => {
        dbServicePromise = null;
        throw error;
      },
    );
  }
  return dbServicePromise;
}

/** Closes the connection. Mainly useful for tests or error recovery. */
export async function closeDatabase(): Promise<void> {
  if (!dbServicePromise) {
    return;
  }
  const service = await dbServicePromise;
  await service.close();
  dbServicePromise = null;
}
