import {open, type DB, type Scalar} from '@op-engineering/op-sqlite';

import type {DatabaseDriver, SqlParam} from '../driver';
import {DatabaseError} from '../errors';

function toSqliteParams(params?: readonly SqlParam[]): Scalar[] | undefined {
  return params ? [...params] : undefined;
}

/**
 * Production driver backed by op-sqlite (JSI bindings, database file lives in
 * the app sandbox). All data stays on-device — there is no sync layer.
 */
export class OpSqliteDriver implements DatabaseDriver {
  readonly name: string;
  private db: DB | null = null;

  constructor(dbName: string) {
    this.name = dbName;
  }

  async open(): Promise<void> {
    if (!this.db) {
      try {
        this.db = open({name: this.name});
        // Enforce referential integrity for the whole schema. SQLite defaults
        // to OFF per connection, so this must be set explicitly.
        await this.db.execute('PRAGMA foreign_keys = ON');
      } catch (error) {
        this.db = null;
        throw new DatabaseError(`Failed to open database "${this.name}"`, {
          cause: error,
        });
      }
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
      await this.requireDb().execute(sql);
    } catch (error) {
      throw new DatabaseError(`SQLite statement failed: ${sql}`, {
        cause: error,
      });
    }
  }

  async query<Row>(sql: string, params?: readonly SqlParam[]): Promise<Row[]> {
    try {
      const result = await this.requireDb().execute(
        sql,
        toSqliteParams(params),
      );
      return result.rows as unknown as Row[];
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
      const result = await this.requireDb().execute(
        sql,
        toSqliteParams(params),
      );
      return {rowsAffected: result.rowsAffected};
    } catch (error) {
      throw new DatabaseError(`SQLite statement failed: ${sql}`, {
        cause: error,
      });
    }
  }

  private requireDb(): DB {
    if (!this.db) {
      throw new DatabaseError(
        `Database "${this.name}" is not open. Call open() first.`,
      );
    }
    return this.db;
  }
}
