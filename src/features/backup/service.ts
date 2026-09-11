import type {DatabaseDriver} from '@/database/driver';
import type {DatabaseService} from '@/database/service';
import {withTransaction} from '@/database/transaction';
import {buildTransactionCsv} from './csv';
import {BackupRestoreError} from './errors';
import {buildBackup, type BuildBackupOptions} from './serialization';
import type {KharchaBackup, RestoreResult, ValidatedBackup} from './types';
import {parseBackup} from './validation';

/**
 * Feature-level service for backup / export / restore.
 *
 * Same contract style as the other features: the ONLY layer the Backup
 * screen talks to, injectable `DatabaseService` for `node:sqlite` tests,
 * and all business logic outside React components.
 *
 * Restore strategy (spec §12-§14): the current financial dataset is deleted
 * and the validated backup is inserted WITH ITS ORIGINAL IDS — all inside
 * ONE SQLite transaction (BEGIN IMMEDIATE). Schema, migrations and
 * `PRAGMA user_version` are never touched; only data rows are. Any failure
 * — bad insert, FK violation, count mismatch — rolls the whole transaction
 * back, leaving the previous dataset fully intact.
 */
export interface BackupFeature {
  /** Reads the database and assembles the typed, versioned backup object. */
  buildBackup(options?: BuildBackupOptions): Promise<KharchaBackup>;

  /** Full backup as JSON text — built AND re-validated before returning. */
  generateBackupJson(options?: BuildBackupOptions): Promise<string>;

  /** The transaction ledger as RFC 4180 CSV text. */
  generateTransactionsCsv(): Promise<string>;

  /** Parses + validates backup text; throws typed errors (see ./errors). */
  parseBackup(json: string): ValidatedBackup;

  /**
   * Destructive: replaces the whole dataset with the validated backup,
   * atomically. Returns the confirmed row counts on success.
   */
  restoreBackup(backup: ValidatedBackup): Promise<RestoreResult>;
}

/**
 * Dependency order follows the schema (spec §14): categories exist before
 * recurring rules and expenses/budgets can reference them; recurring rules
 * exist before the generated transactions that reference them; settings is
 * independent. Deletion runs in child-first order so FK RESTRICT never
 * fires mid-restore.
 */
const DELETE_ORDER = [
  'expenses',
  'income',
  'budgets',
  'monthly_budgets',
  'recurring_transactions',
  'categories',
  'settings',
] as const;

async function insertBackupData(
  driver: DatabaseDriver,
  backup: ValidatedBackup,
): Promise<void> {
  const {data} = backup;

  for (const category of data.categories) {
    await driver.run(
      `INSERT INTO categories (id, name, icon, type, is_default, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        category.id,
        category.name,
        category.icon,
        category.type,
        category.isDefault ? 1 : 0,
        category.isActive ? 1 : 0,
        category.createdAt,
      ],
    );
  }

  // Rules BEFORE the transactions that reference them (FK order).
  for (const rule of data.recurringTransactions) {
    await driver.run(
      `INSERT INTO recurring_transactions
        (id, type, amount, title, category_id, frequency, start_date,
         next_occurrence_at, end_date, payment_method, note, is_active,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.id,
        rule.type,
        rule.amount,
        rule.title,
        rule.categoryId,
        rule.frequency,
        rule.startDate,
        rule.nextOccurrenceAt,
        rule.endDate,
        rule.paymentMethod,
        rule.note,
        rule.isActive ? 1 : 0,
        rule.createdAt,
        rule.updatedAt,
      ],
    );
  }

  for (const expense of data.expenses) {
    await driver.run(
      `INSERT INTO expenses (id, amount, title, category_id, date, payment_method, note, created_at, updated_at, recurring_rule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense.id,
        expense.amount,
        expense.title,
        expense.categoryId,
        expense.date,
        expense.paymentMethod,
        expense.note,
        expense.createdAt,
        expense.updatedAt,
        expense.recurringRuleId,
      ],
    );
  }

  for (const income of data.income) {
    await driver.run(
      `INSERT INTO income (id, amount, source, date, note, created_at, updated_at, recurring_rule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        income.id,
        income.amount,
        income.source,
        income.date,
        income.note,
        income.createdAt,
        income.updatedAt,
        income.recurringRuleId,
      ],
    );
  }

  for (const budget of data.budgets) {
    await driver.run(
      `INSERT INTO budgets (id, category_id, amount, month, year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        budget.id,
        budget.categoryId,
        budget.amount,
        budget.month,
        budget.year,
        budget.createdAt,
        budget.updatedAt,
      ],
    );
  }

  for (const budget of data.monthlyBudgets) {
    await driver.run(
      `INSERT INTO monthly_budgets (id, amount, month, year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        budget.id,
        budget.amount,
        budget.month,
        budget.year,
        budget.createdAt,
        budget.updatedAt,
      ],
    );
  }

  for (const setting of data.settings) {
    await driver.run('INSERT INTO settings (key, value) VALUES (?, ?)', [
      setting.key,
      setting.value,
    ]);
  }
}

/**
 * Final in-transaction safety net: no FK violations, and every table holds
 * exactly the number of rows the backup declared. A mismatch throws, which
 * rolls the whole restore back.
 */
async function verifyRestoredState(
  driver: DatabaseDriver,
  backup: ValidatedBackup,
): Promise<void> {
  const violations = await driver.query('PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error('Foreign key integrity check failed');
  }

  const counts = await Promise.all([
    driver.query<{count: number}>('SELECT COUNT(*) AS count FROM categories'),
    driver.query<{count: number}>('SELECT COUNT(*) AS count FROM expenses'),
    driver.query<{count: number}>('SELECT COUNT(*) AS count FROM income'),
    driver.query<{count: number}>('SELECT COUNT(*) AS count FROM budgets'),
    driver.query<{count: number}>(
      'SELECT COUNT(*) AS count FROM monthly_budgets',
    ),
    driver.query<{count: number}>(
      'SELECT COUNT(*) AS count FROM recurring_transactions',
    ),
    driver.query<{count: number}>('SELECT COUNT(*) AS count FROM settings'),
  ]).then(results => results.map(result => result[0]?.count ?? 0));

  const expected = [
    backup.counts.categories,
    backup.counts.expenses,
    backup.counts.income,
    backup.counts.budgets,
    backup.counts.monthlyBudgets,
    backup.counts.recurringTransactions,
    backup.counts.settings,
  ];

  for (const [index, actual] of counts.entries()) {
    if (actual !== expected[index]) {
      throw new Error('Restored row count does not match the backup manifest');
    }
  }
}

export function createBackupFeature(db: DatabaseService): BackupFeature {
  return {
    buildBackup(options?: BuildBackupOptions): Promise<KharchaBackup> {
      return buildBackup(db, options);
    },

    async generateBackupJson(options?: BuildBackupOptions): Promise<string> {
      // Spec §9 step 3: validate what we built before it leaves the app —
      // guards against code regressions producing malformed backups.
      const backup = await buildBackup(db, options);
      parseBackup(JSON.stringify(backup));
      return JSON.stringify(backup, null, 2);
    },

    async generateTransactionsCsv(): Promise<string> {
      const [expenses, income] = await Promise.all([
        // Joined rows carry category NAMES; disabled categories still
        // resolve because the JOIN does not filter on is_active.
        db.expenses.listWithCategory({order: 'dateAsc'}),
        db.income.list({order: 'dateAsc'}),
      ]);
      return buildTransactionCsv({expenses, income});
    },

    parseBackup(json: string): ValidatedBackup {
      return parseBackup(json);
    },

    async restoreBackup(backup: ValidatedBackup): Promise<RestoreResult> {
      try {
        await withTransaction(db.driver, async () => {
          for (const table of DELETE_ORDER) {
            await db.driver.exec(`DELETE FROM ${table}`);
          }
          await insertBackupData(db.driver, backup);
          await verifyRestoredState(db.driver, backup);
        });
      } catch (error) {
        // The transaction has already rolled back — the previous dataset is
        // intact. Surface a calm, generic message; never raw SQL errors.
        throw new BackupRestoreError(
          'The restore failed and your current data was left unchanged.',
          {cause: error},
        );
      }
      return backup.counts;
    },
  };
}
