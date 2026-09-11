import type {DatabaseDriver} from './driver';
import {MIGRATIONS, runMigrations} from './migrations';
import type {Migration} from './migrations';
import {BudgetRepository} from './repositories/budgets';
import {CategoryRepository} from './repositories/categories';
import {ExpenseRepository} from './repositories/expenses';
import {IncomeRepository} from './repositories/income';
import {MonthlyBudgetRepository} from './repositories/monthlyBudgets';
import {RecurringTransactionRepository} from './repositories/recurringTransactions';
import {SettingsRepository} from './repositories/settings';

export interface DatabaseServiceOptions {
  /** Override only in tests. */
  migrations?: readonly Migration[];
}

/**
 * Facade that owns the database lifecycle (open → migrate → ready) and
 * exposes one repository per table. This is the single entry point the app
 * uses to reach the data layer.
 *
 * ```ts
 * const db = await DatabaseService.open(new OpSqliteDriver('kharcha.db'));
 * await db.expenses.create({...});
 * ```
 *
 * Repositories are cheap stateless views over the driver; the service itself
 * holds no mutable state beyond the connection.
 */
export class DatabaseService {
  readonly expenses: ExpenseRepository;
  readonly income: IncomeRepository;
  readonly categories: CategoryRepository;
  readonly budgets: BudgetRepository;
  readonly monthlyBudgets: MonthlyBudgetRepository;
  readonly settings: SettingsRepository;
  readonly recurring: RecurringTransactionRepository;

  private constructor(
    /** The underlying connection. Public for diagnostics/advanced use. */
    public readonly driver: DatabaseDriver,
  ) {
    this.expenses = new ExpenseRepository(driver);
    this.income = new IncomeRepository(driver);
    this.categories = new CategoryRepository(driver);
    this.budgets = new BudgetRepository(driver);
    this.monthlyBudgets = new MonthlyBudgetRepository(driver);
    this.settings = new SettingsRepository(driver);
    this.recurring = new RecurringTransactionRepository(driver);
  }

  /** Opens the driver and brings the schema up to the latest version. */
  static async open(
    driver: DatabaseDriver,
    options: DatabaseServiceOptions = {},
  ): Promise<DatabaseService> {
    await driver.open();
    await runMigrations(driver, options.migrations ?? MIGRATIONS);
    return new DatabaseService(driver);
  }

  /**
   * `PRAGMA integrity_check` — returns 'ok' for a healthy database.
   * Exposed for diagnostics and tests.
   */
  async integrityCheck(): Promise<string> {
    const rows = await this.driver.query<{integrity_check: string}>(
      'PRAGMA integrity_check',
    );
    return rows[0]?.integrity_check ?? 'unknown';
  }

  /**
   * `PRAGMA foreign_key_check` — an empty array means no violations.
   * Exposed for diagnostics and tests.
   */
  async foreignKeyCheck(): Promise<unknown[]> {
    return this.driver.query('PRAGMA foreign_key_check');
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
