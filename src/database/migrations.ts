import type {DatabaseDriver} from './driver';
import {MigrationError} from './errors';
import {PAYMENT_METHODS} from './models';
import {withTransaction} from './transaction';

export interface Migration {
  /** Monotonic version number; tracked via SQLite's `PRAGMA user_version`. */
  version: number;
  /** Human-readable name, useful in logs. */
  name: string;
  /** SQL statements applied together inside a single transaction. */
  statements: string[];
}

/*
 * Rules for this registry (IMPORTANT — do not break):
 *  1. Append new migrations with the next free version number.
 *  2. NEVER edit or delete a migration that has already shipped.
 *     Published migrations are immutable; fix forward with a new migration.
 *  3. Each migration must leave the schema in a state that works on its own.
 */

/** Epoch-millis timestamp evaluated by SQLite at migration time. */
const NOW_MS = `(CAST(strftime('%s', 'now') AS INTEGER) * 1000)`;

/** Kept in sync with `PAYMENT_METHODS` in models.ts by construction. */
const PAYMENT_METHOD_CHECK = PAYMENT_METHODS.map(m => `'${m}'`).join(', ');

/**
 * v1 — initial schema.
 *
 * Creates the five core tables (categories, expenses, income, budgets,
 * settings) with referential integrity, query indexes, CHECK constraints,
 * and seeds the default expense/income categories used by the app.
 */
const MIGRATION_001_INITIAL_SCHEMA: Migration = {
  version: 1,
  name: 'initial_schema',
  statements: [
    `CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX idx_categories_name_type ON categories (name, type)`,
    `CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      title TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
      date INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN (${PAYMENT_METHOD_CHECK})),
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_expenses_date ON expenses (date)`,
    `CREATE INDEX idx_expenses_category_id ON expenses (category_id)`,
    `CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      source TEXT NOT NULL,
      date INTEGER NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_income_date ON income (date)`,
    `CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
      amount INTEGER NOT NULL CHECK (amount > 0),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX idx_budgets_category_period ON budgets (category_id, year, month)`,
    `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    // Default categories — icon is a stable icon key, mapped to glyphs by the
    // UI layer. Seeding lives in the migration so a fresh install is always
    // fully usable after the first launch, even if the process dies midway.
    `INSERT INTO categories (name, icon, type, is_default, created_at) VALUES
      ('Food & Dining', 'restaurant', 'expense', 1, ${NOW_MS}),
      ('Groceries', 'cart', 'expense', 1, ${NOW_MS}),
      ('Transport', 'bus', 'expense', 1, ${NOW_MS}),
      ('Rent & Housing', 'home', 'expense', 1, ${NOW_MS}),
      ('Utilities', 'flash', 'expense', 1, ${NOW_MS}),
      ('Health', 'medkit', 'expense', 1, ${NOW_MS}),
      ('Education', 'school', 'expense', 1, ${NOW_MS}),
      ('Shopping', 'bag', 'expense', 1, ${NOW_MS}),
      ('Entertainment', 'film', 'expense', 1, ${NOW_MS}),
      ('Other Expense', 'pricetag', 'expense', 1, ${NOW_MS}),
      ('Salary', 'briefcase', 'income', 1, ${NOW_MS}),
      ('Business', 'storefront', 'income', 1, ${NOW_MS}),
      ('Freelance', 'laptop', 'income', 1, ${NOW_MS}),
      ('Investment', 'trending-up', 'income', 1, ${NOW_MS}),
      ('Gift', 'gift', 'income', 1, ${NOW_MS}),
      ('Other Income', 'cash', 'income', 1, ${NOW_MS})`,
  ],
};

/**
 * v2 — overall monthly budgets.
 *
 * Adds the `monthly_budgets` table: one budget per (year, month), not tied
 * to any category. Category budgets continue to live in `budgets`
 * (migration 001); this table backs the month-level limit shown on the
 * Budget screen and dashboard. Fully additive — no existing table changes.
 */
const MIGRATION_002_MONTHLY_BUDGETS: Migration = {
  version: 2,
  name: 'monthly_budgets',
  statements: [
    `CREATE TABLE monthly_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX idx_monthly_budgets_period ON monthly_budgets (year, month)`,
  ],
};

/**
 * v3 — category enable/disable (archive) support.
 *
 * Adds a nullable-safe `is_active` flag to `categories` so categories can be
 * archived without deleting them: disabled categories stay visible in
 * management and keep resolving for historical records, while new-transaction
 * pickers only offer active ones. Fully additive — every existing row becomes
 * active via the DEFAULT, migration 001 data (including its UNIQUE
 * (name, type) index) is untouched.
 */
const MIGRATION_003_CATEGORY_ACTIVE: Migration = {
  version: 3,
  name: 'category_is_active',
  statements: [
    `ALTER TABLE categories
     ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))`,
  ],
};

/**
 * v4 — recurring transactions.
 *
 * Adds the `recurring_transactions` table: reusable rules (daily / weekly /
 * monthly) that the generation engine turns into NORMAL expense/income rows
 * on schedule. Fully additive:
 *
 * - the new table references `categories` with ON DELETE RESTRICT, so a
 *   category still used by a rule cannot be deleted (archive it instead);
 * - `expenses` / `income` gain a NULLABLE `recurring_rule_id` (ALTER TABLE
 *   ADD COLUMN requires a NULL default) tagging GENERATED rows; ON DELETE
 *   SET NULL keeps every historical transaction when a rule is deleted —
 *   deleting a rule never deletes generated history (spec §11/§21);
 * - partial UNIQUE indexes on (recurring_rule_id, date) make SQLite the
 *   final duplicate-prevention authority: the same occurrence of the same
 *   rule can never be generated twice (spec §14). Manual rows (NULL rule)
 *   and different rules on the same date are unaffected.
 *
 * Occurrence timestamps are stored at LOCAL NOON (`atNoon`), the same
 * DST-safe convention record dates already use.
 */
const MIGRATION_004_RECURRING: Migration = {
  version: 4,
  name: 'recurring_transactions',
  statements: [
    `CREATE TABLE recurring_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      title TEXT NOT NULL,
      category_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
      start_date INTEGER NOT NULL,
      next_occurrence_at INTEGER NOT NULL,
      end_date INTEGER,
      payment_method TEXT CHECK (
        payment_method IS NULL OR payment_method IN (${PAYMENT_METHOD_CHECK})
      ),
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (
        (type = 'expense' AND category_id IS NOT NULL AND payment_method IS NOT NULL)
        OR
        (type = 'income' AND category_id IS NULL AND payment_method IS NULL)
      ),
      CHECK (end_date IS NULL OR end_date >= start_date)
    )`,
    `CREATE INDEX idx_recurring_due ON recurring_transactions (is_active, next_occurrence_at)`,
    `CREATE INDEX idx_recurring_category_id ON recurring_transactions (category_id)`,
    `ALTER TABLE expenses
     ADD COLUMN recurring_rule_id INTEGER
       REFERENCES recurring_transactions (id) ON DELETE SET NULL`,
    `CREATE UNIQUE INDEX idx_expenses_rule_occurrence
     ON expenses (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL`,
    `ALTER TABLE income
     ADD COLUMN recurring_rule_id INTEGER
       REFERENCES recurring_transactions (id) ON DELETE SET NULL`,
    `CREATE UNIQUE INDEX idx_income_rule_occurrence
     ON income (recurring_rule_id, date) WHERE recurring_rule_id IS NOT NULL`,
  ],
};

/**
 * Registry of all schema migrations, applied in ascending version order.
 */
export const MIGRATIONS: readonly Migration[] = [
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_MONTHLY_BUDGETS,
  MIGRATION_003_CATEGORY_ACTIVE,
  MIGRATION_004_RECURRING,
];

/**
 * Applies every pending migration exactly once, in order.
 *
 * Each migration runs inside its own transaction together with the
 * `user_version` bump, so a failed migration can never leave a half-applied
 * schema behind.
 *
 * @returns the schema version after running (equal to `PRAGMA user_version`).
 */
export async function runMigrations(
  driver: DatabaseDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<number> {
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].version <= migrations[i - 1].version) {
      throw new MigrationError(
        migrations[i].version,
        migrations[i].name,
        new Error('Migration versions must be unique and strictly increasing'),
      );
    }
  }

  const versionRows = await driver.query<{user_version: number}>(
    'PRAGMA user_version',
  );
  const currentVersion =
    typeof versionRows[0]?.user_version === 'number'
      ? versionRows[0].user_version
      : 0;

  let version = currentVersion;
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }
    try {
      await withTransaction(driver, async () => {
        for (const statement of migration.statements) {
          await driver.exec(statement);
        }
        await driver.exec(`PRAGMA user_version = ${migration.version}`);
      });
    } catch (error) {
      throw new MigrationError(migration.version, migration.name, error);
    }
    version = migration.version;
    // TODO: route through a proper logger once one is introduced.
    console.log(
      `[db] applied migration ${migration.version}: ${migration.name}`,
    );
  }

  return version;
}
