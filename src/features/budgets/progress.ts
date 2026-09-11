import {
  BUDGET_WARNING_RATIO,
  type BudgetProgress,
  type BudgetState,
} from './types';

/**
 * Pure budget progress math — no database, no React, no formatting.
 *
 * Spec rules:
 * - remaining = budget - spent (negative when exceeded)
 * - percentage = spent / budget * 100
 * - never divide by zero (a 0 budget maps to the `zero` state)
 *
 * Spending comes from the caller; the feature service derives it from the
 * `expenses` table via the shared date-boundary utilities.
 */
export function computeBudgetProgress(
  amount: number,
  spent: number,
): BudgetProgress {
  const remaining = amount - spent;

  // A 0 (or negative) budget has no meaningful ratio — the repository's
  // CHECK constraint rejects it, but the calculation stays total-safe.
  if (amount <= 0) {
    return {amount, spent, remaining, percent: 0, state: 'zero'};
  }

  const ratio = spent / amount;
  const percent = Math.round(ratio * 1000) / 10;

  let state: BudgetState;
  if (ratio >= 1) {
    state = 'exceeded';
  } else if (ratio >= BUDGET_WARNING_RATIO) {
    state = 'warning';
  } else {
    state = 'ok';
  }

  return {amount, spent, remaining, percent, state};
}

/**
 * Percent display: whole numbers render without decimals ("82%"), others
 * keep one decimal ("61.5%"). The input is already rounded by
 * `computeBudgetProgress`, so no extra rounding happens here.
 */
export function formatBudgetPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

/** Short, theme-independent label for a budget's state (e.g. list rows). */
export function budgetStateLabel(state: BudgetProgress['state']): string {
  switch (state) {
    case 'exceeded':
      return 'Budget exceeded';
    case 'warning':
      return 'Approaching budget';
    case 'zero':
      return 'Budget is 0';
    default:
      return 'On track';
  }
}
