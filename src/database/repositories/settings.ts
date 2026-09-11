import type {DatabaseDriver} from '../driver';
import {ValidationError} from '../errors';
import type {Setting} from '../models';
import {withTransaction} from '../transaction';
import {requireText} from './validate';

const KEY_MAX = 100;

function requireKey(key: unknown): string {
  return requireText(key, 'key', KEY_MAX);
}

function requireValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('value', 'must be a string');
  }
  return value;
}

/**
 * Key/value access to the `settings` table.
 *
 * Values are always strings. Structured values (numbers, objects) must be
 * serialized by the caller — JSON is the recommended encoding. This keeps
 * the table future-proof without schema churn. The settings feature
 * (features/settings) persists theme mode + currency here; the Zustand
 * store mirrors those values at runtime.
 */
export class SettingsRepository {
  constructor(private readonly db: DatabaseDriver) {}

  /** @returns the stored value or null when the key is unknown. */
  async get(key: string): Promise<string | null> {
    const normalizedKey = requireKey(key);
    const rows = await this.db.query<{value: string}>(
      'SELECT value FROM settings WHERE key = ?',
      [normalizedKey],
    );
    return rows[0]?.value ?? null;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /** Inserts or overwrites the value for `key`. */
  async set(key: string, value: string): Promise<void> {
    const normalizedKey = requireKey(key);
    if (typeof value !== 'string') {
      throw new ValidationError('value', 'must be a string');
    }
    await this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [normalizedKey, value],
    );
  }

  async delete(key: string): Promise<boolean> {
    const normalizedKey = requireKey(key);
    const {rowsAffected} = await this.db.run(
      'DELETE FROM settings WHERE key = ?',
      [normalizedKey],
    );
    return rowsAffected > 0;
  }

  /** All settings ordered by key — useful for debugging/export screens. */
  async getAll(): Promise<Setting[]> {
    return this.db.query<Setting>(
      'SELECT key, value FROM settings ORDER BY key ASC',
    );
  }

  /** Upserts many settings in one atomic transaction. */
  async setMany(entries: readonly Setting[]): Promise<void> {
    const pairs: [string, string][] = entries.map(entry => [
      requireKey(entry.key),
      requireValue(entry.value),
    ]);
    await withTransaction(this.db, async () => {
      for (const [key, value] of pairs) {
        await this.db.run(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [key, value],
        );
      }
    });
  }
}
