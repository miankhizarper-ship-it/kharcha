/**
 * Public API of the database layer.
 *
 * NOTE: this barrel is safe for the app but must NOT be imported by database
 * tests — it pulls in `connection.ts` → op-sqlite (a native module). Tests
 * import concrete modules (e.g. `@/database/service`) so they can run on the
 * `node:sqlite` driver instead.
 */

// Core abstractions
export type {DatabaseDriver, SqlParam} from './driver';
export {
  DatabaseError,
  MigrationError,
  NotFoundError,
  ValidationError,
} from './errors';
export {withTransaction} from './transaction';

// Models (entities, drafts, patches, filters, enums)
export * from './models';

// Migrations
export {MIGRATIONS, runMigrations} from './migrations';
export type {Migration} from './migrations';

// Repositories
export {BudgetRepository} from './repositories/budgets';
export {MONTH_MAX, MONTH_MIN, YEAR_MAX, YEAR_MIN} from './repositories/budgets';
export {CategoryRepository} from './repositories/categories';
export {ExpenseRepository} from './repositories/expenses';
export {IncomeRepository} from './repositories/income';
export {MonthlyBudgetRepository} from './repositories/monthlyBudgets';
export {SettingsRepository} from './repositories/settings';

// Facade + app connection (op-sqlite backed)
export {DatabaseService} from './service';
export type {DatabaseServiceOptions} from './service';
export {DB_NAME, closeDatabase, openDatabase} from './connection';
