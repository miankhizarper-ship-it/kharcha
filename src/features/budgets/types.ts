/**
 * UI-facing models for the Budget feature.
 *
 * Budgets live in two SQLite tables:
 * - `monthly_budgets` — the OVERALL limit for a (year, month)
 * - `budgets` — per-CATEGORY limits for a (year, month)
 *
 * Spending always comes from the `expenses` table at read time; nothing
 * here caches or mutates expense data. All money values are minor units
 * (paisa), consistent with the rest of the app.
 */

/**
 * Spending at or above this fraction of the budget is "warning" territory
 * (80–99%); 100%+ is "exceeded". Below 80% is "ok".
 */
export const BUDGET_WARNING_RATIO = 0.8;

/**
 * Visual state of a budget:
 * - `ok`       — under 80% used
 * - `warning`  — 80–99% used ("approaching budget")
 * - `exceeded` — 100%+ used ("budget exceeded")
 * - `zero`     — defensive: budget amount is 0 (the repository rejects it,
 *                but calculations must never divide by zero)
 */
export type BudgetState = 'ok' | 'warning' | 'exceeded' | 'zero';

/** Shared progress math for the overall budget and every category budget. */
export interface BudgetProgress {
  /** Budgeted amount (minor units), always > 0 for non-zero states. */
  amount: number;
  /** Spent within the period (minor units), never negative. */
  spent: number;
  /** amount - spent. Negative means the budget is exceeded. */
  remaining: number;
  /** spent / amount * 100, rounded to 1 decimal. 0 for zero budgets. */
  percent: number;
  state: BudgetState;
}

/** The month's overall budget with its progress. */
export interface OverallBudgetProgress extends BudgetProgress {
  /** `monthly_budgets` row id. */
  id: number;
}

/** One category budget with its per-category spending progress. */
export interface CategoryBudgetProgress extends BudgetProgress {
  /** `budgets` row id. */
  id: number;
  categoryId: number;
  categoryName: string;
  /** Stable icon key — resolve via `categoryIconName`. */
  categoryIcon: string;
}

/** Everything the Budget screen renders for one selected month. */
export interface BudgetMonthSnapshot {
  year: number;
  /** 1-12. */
  month: number;
  /**
   * Total spent in the month across ALL expense categories (not just the
   * budgeted ones) — keeps the "no overall budget yet" card accurate.
   */
  spent: number;
  /** null = no overall budget set for this month. */
  overall: OverallBudgetProgress | null;
  /** Category budgets for the month, ordered by category name. */
  categories: CategoryBudgetProgress[];
}

/** Compact summary rendered on the dashboard (HomeScreen). */
export interface DashboardBudgetSummary {
  year: number;
  /** 1-12. */
  month: number;
  /** null = no budget set for the current month. */
  budget: number | null;
  /** Spent so far this month (always computed, budget or not). */
  spent: number;
  /** null when no budget is set. */
  remaining: number | null;
  /** null when no budget is set. */
  percent: number | null;
  /** `'none'` when no budget is set for the current month. */
  state: BudgetState | 'none';
}
