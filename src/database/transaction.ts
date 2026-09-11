import type {DatabaseDriver} from './driver';

/**
 * Runs `work` inside a single SQLite transaction (BEGIN IMMEDIATE).
 *
 * Implemented on top of plain `exec` so it behaves identically on every
 * driver. Intentionally NOT reentrant: never nest calls to this function on
 * the same driver.
 */
export async function withTransaction<T>(
  driver: DatabaseDriver,
  work: () => Promise<T>,
): Promise<T> {
  await driver.exec('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await driver.exec('COMMIT');
    return result;
  } catch (error) {
    // If COMMIT itself failed the transaction is already gone; the original
    // error is always more useful than a ROLLBACK failure.
    try {
      await driver.exec('ROLLBACK');
    } catch {
      // Swallow — see comment above.
    }
    throw error;
  }
}
