/**
 * Shared helpers for database-layer tests.
 *
 * Every test runs against a REAL SQLite engine via Node's built-in
 * `node:sqlite` (see `../drivers/node`), through the exact same driver
 * interface, migration runner and repositories used in production.
 */
import {NodeSqliteDriver} from '../drivers/node';
import type {Category, Expense, Income} from '../models';
import {DatabaseService} from '../service';

/** Opens a fresh in-memory database with all migrations applied. */
export async function createTestService(): Promise<DatabaseService> {
  return DatabaseService.open(new NodeSqliteDriver(':memory:'));
}

/** Fixed timestamps keep date-range assertions predictable. */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20Z
export const T1 = T0 + DAY_MS;
export const T2 = T0 + 2 * DAY_MS;
export const T3 = T0 + 3 * DAY_MS;

/** Creates a non-default expense category with a unique-ish name. */
export async function createTestCategory(
  service: DatabaseService,
  overrides: Partial<{
    name: string;
    icon: string;
    type: 'expense' | 'income';
  }> = {},
): Promise<Category> {
  return service.categories.create({
    name: overrides.name ?? `Cat ${Math.random().toString(36).slice(2, 8)}`,
    icon: overrides.icon ?? 'tag',
    type: overrides.type ?? 'expense',
  });
}

export type ExpenseOverrides = Partial<
  Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>
>;

/** Creates one expense, making a backing category when none is given. */
export async function createTestExpense(
  service: DatabaseService,
  overrides: ExpenseOverrides = {},
): Promise<Expense> {
  const categoryId =
    overrides.categoryId ?? (await createTestCategory(service)).id;
  return service.expenses.create({
    amount: 25_000, // 250.00 in minor units
    title: 'Test expense',
    categoryId,
    date: T1,
    paymentMethod: 'cash',
    ...overrides,
  });
}

export type IncomeOverrides = Partial<
  Omit<Income, 'id' | 'createdAt' | 'updatedAt'>
>;

/** Creates one income record with sane defaults. */
export async function createTestIncome(
  service: DatabaseService,
  overrides: IncomeOverrides = {},
): Promise<Income> {
  return service.income.create({
    amount: 100_000,
    source: 'Test source',
    date: T1,
    ...overrides,
  });
}
