import {DatabaseSync} from 'node:sqlite';

import type {DatabaseDriver, SqlParam} from '../driver';
import {DatabaseError} from '../errors';

/**
 * TEST-ONLY driver backed by Node's built-in `node:sqlite` module.
 *
 * Lets the whole database layer (migrations, repositories, service) run
 * against a REAL SQLite engine inside Jest with zero native dependencies.
 * This file must never be imported from app code — it is only referenced by
 * `src/database/__tests__/`. Metro never sees it because nothing in the app
 * import graph reaches it.
 */
export class NodeSqliteDriver implements DatabaseDriver {
  readonly name: string;
  private db: DatabaseSync | null = null;

  /** Defaults to an in-memory database; pass a path for a file-backed one. */
  constructor(filename: string = ':memory:') {
    this.name = filename;
  }

  async open(): Promise<void> {
    if (!this.db) {
      this.db = new DatabaseSync(this.name);
      // Same connection-level PRAGMA the production driver applies, so FK
      // behavior is identical between tests and the real app.
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      this.requireDb().exec(sql);
    } catch (error) {
      throw new DatabaseError(`SQLite statement failed: ${sql}`, {
        cause: error,
      });
    }
  }

  async query<Row>(sql: string, params?: readonly SqlParam[]): Promise<Row[]> {
    try {
      const stmt = this.requireDb().prepare(sql);
      const rows = stmt.all(...(params ?? []));
      return rows as unknown as Row[];
    } catch (error) {
      throw new DatabaseError(`SQLite statement failed: ${sql}`, {
        cause: error,
      });
    }
  }

  async run(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<{rowsAffected: number}> {
    try {
      const stmt = this.requireDb().prepare(sql);
      const info = stmt.run(...(params ?? []));
      return {rowsAffected: Number(info.changes)};
    } catch (error) {
      throw new DatabaseError(`SQLite statement failed: ${sql}`, {
        cause: error,
      });
    }
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new DatabaseError(
        `Database "${this.name}" is not open. Call open() first.`,
      );
    }
    return this.db;
  }
}
