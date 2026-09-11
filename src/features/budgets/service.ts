import type {
  Budget,
  BudgetDraft,
  BudgetWithCategory,
  Category,
  MonthlyBudget,
  MonthlyBudgetDraft,
} from '@/database/models';
import type {DatabaseService} from '@/database/service';
import {monthBounds} from '@/utils/date';
import {computeBudgetProgress} from './progress';
import type {
  BudgetMonthSnapshot,
  BudgetState,
  CategoryBudgetProgress,
  DashboardBudgetSummary,
  OverallBudgetProgress,
} from './types';

/**
 * Feature-level service for the Budgets vertical slice.
 *
 * This is the ONLY layer screens talk to; it funnels everything through the
 * repositories (`DatabaseService`), so SQLite stays the single source of
 * truth. Screens never build SQL and never cache budgets in Zustand.
 *
 * Spending is always derived live from the `expenses` table inside the
 * selected month's local-time window (`monthBounds`), so budget progress
 * automatically reflects created/edited/deleted expenses on the next
 * focus-triggered refetch — no invalidation store needed.
 *
 * Created via `createBudgetFeature(db)` — the injected `DatabaseService`
 * makes the whole feature testable on the `node:sqlite` driver.
 */
export interface BudgetFeature {
  /** Expense categories for the category-budget picker (never income). */
  listExpenseCategories(): Promise<Category[]>;

  /** Overall + category budgets with live spending for the given month. */
  getMonthSnapshot(year: number, month: number): Promise<BudgetMonthSnapshot>;

  /** Compact current-month summary for the dashboard card. */
  getDashboardBudgetSummary(now?: number): Promise<DashboardBudgetSummary>;

  /** Sets (or updates, via upsert) the overall budget for a month. */
  saveOverallBudget(draft: MonthlyBudgetDraft): Promise<MonthlyBudget>;

  /** Sets (or updates, via upsert) a category budget for a month. */
  saveCategoryBudget(draft: BudgetDraft): Promise<Budget>;

  /** Removes the overall budget; resolves false when the id is gone. */
  removeOverallBudget(id: number): Promise<boolean>;

  /** Removes a category budget; resolves false when the id is gone. */
  removeCategoryBudget(id: number): Promise<boolean>;
}

function toOverallProgress(
  budget: MonthlyBudget,
  spent: number,
): OverallBudgetProgress {
  return {id: budget.id, ...computeBudgetProgress(budget.amount, spent)};
}

function toCategoryProgress(
  budget: BudgetWithCategory,
  spent: number,
): CategoryBudgetProgress {
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    categoryName: budget.categoryName,
    categoryIcon: budget.categoryIcon,
    ...computeBudgetProgress(budget.amount, spent),
  };
}

function stateOrNone(progress: {state: BudgetState}): BudgetState | 'none' {
  return progress.state;
}

export function createBudgetFeature(db: DatabaseService): BudgetFeature {
  return {
    listExpenseCategories() {
      return db.categories.list('expense');
    },

    async getMonthSnapshot(
      year: number,
      month: number,
    ): Promise<BudgetMonthSnapshot> {
      const {fromDate, toDate} = monthBounds(year, month);

      const [monthlyBudget, categoryBudgets, monthSpent, categoryTotals] =
        await Promise.all([
          db.monthlyBudgets.find(month, year),
          db.budgets.listByMonth(month, year),
          db.expenses.sumAmount({fromDate, toDate}),
          db.expenses.sumByCategory({fromDate, toDate}),
        ]);

      const spentByCategory = new Map(
        categoryTotals.map(total => [total.categoryId, total.total]),
      );

      return {
        year,
        month,
        spent: monthSpent,
        overall: monthlyBudget
          ? toOverallProgress(monthlyBudget, monthSpent)
          : null,
        categories: categoryBudgets.map(budget =>
          toCategoryProgress(
            budget,
            spentByCategory.get(budget.categoryId) ?? 0,
          ),
        ),
      };
    },

    async getDashboardBudgetSummary(
      now: number = Date.now(),
    ): Promise<DashboardBudgetSummary> {
      const date = new Date(now);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const {fromDate, toDate} = monthBounds(year, month);

      const [budget, spent] = await Promise.all([
        db.monthlyBudgets.find(month, year),
        db.expenses.sumAmount({fromDate, toDate}),
      ]);

      if (!budget) {
        return {
          year,
          month,
          budget: null,
          spent,
          remaining: null,
          percent: null,
          state: 'none',
        };
      }

      const progress = computeBudgetProgress(budget.amount, spent);
      return {
        year,
        month,
        budget: budget.amount,
        spent,
        remaining: progress.remaining,
        percent: progress.percent,
        state: stateOrNone(progress),
      };
    },

    saveOverallBudget(draft: MonthlyBudgetDraft) {
      return db.monthlyBudgets.upsert(draft);
    },

    saveCategoryBudget(draft: BudgetDraft) {
      return db.budgets.upsert(draft);
    },

    removeOverallBudget(id: number) {
      return db.monthlyBudgets.delete(id);
    },

    removeCategoryBudget(id: number) {
      return db.budgets.delete(id);
    },
  };
}
