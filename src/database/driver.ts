/**
 * Engine-agnostic contract for the underlying SQLite connection.
 *
 * Production uses `drivers/opsqlite.ts` (op-sqlite bound through JSI on
 * device). Tests use `drivers/node.ts` (Node's built-in `node:sqlite`),
 * which runs the exact same SQL against a real SQLite engine without any
 * native module — that is what makes this layer testable in Jest.
 *
 * Everything the repositories and the migration runner do goes through this
 * interface only. No file outside `drivers/` may import `@op-engineering/op-sqlite`.
 */
export type SqlParam = string | number | null;

export interface DatabaseDriver {
  /** Human-readable driver/database identifier, useful in logs. */
  readonly name: string;

  /** Opens the connection (idempotent) and applies connection-level PRAGMAs. */
  open(): Promise<void>;

  /** Closes the connection (idempotent). */
  close(): Promise<void>;

  /**
   * Executes raw SQL with no parameters and no result rows:
   * DDL, PRAGMAs and transaction control statements.
   */
  exec(sql: string): Promise<void>;

  /** Executes a statement and returns every result row. */
  query<Row>(sql: string, params?: readonly SqlParam[]): Promise<Row[]>;

  /** Executes a mutation and returns the number of affected rows. */
  run(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<{rowsAffected: number}>;
}
