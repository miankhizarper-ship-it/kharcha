import type {ReportInsight, ReportSnapshot} from './types';

/**
 * Deterministic insight rows for the Reports screen (Phase 9, spec §11).
 *
 * Every row is directly explainable from the snapshot's database-derived
 * numbers — top category, highest day, largest transaction, frequency,
 * budget states, income direction and period-over-period trend. There is
 * deliberately NO AI/LLM anywhere: the same data always produces the same
 * rows, and "no data" produces no row instead of a fabricated fact.
 *
 * Formatting is injected so this module stays pure and unit-testable; the
 * UI layer passes the shared `formatCurrency` / `formatBudgetPercent` /
 * `formatShortDate` helpers.
 */

export interface ReportInsightFormatters {
  /** Minor units → display string, e.g. "PKR 8,500.00". */
  formatCurrency: (minor: number) => string;
  /** 1-decimal percent → display string, e.g. "42" or "23.2". */
  formatPercent: (percent: number) => string;
  /** Epoch millis → short human date, e.g. "Sep 14, 2026". */
  formatShortDate: (ms: number) => string;
}

export interface ReportInsightOptions {
  /**
   * Label of the comparison period for the spending-trend row (month
   * selections only, e.g. "August 2026"). Absent → no trend row.
   */
  previousLabel?: string;
  /** How many budget-state rows (exceeded + warning) to include, max. */
  budgetRowLimit?: number;
}

const BUDGET_ROW_LIMIT_DEFAULT = 3;

export function buildReportInsights(
  snapshot: ReportSnapshot,
  format: ReportInsightFormatters,
  options: ReportInsightOptions = {},
): ReportInsight[] {
  const rows: ReportInsight[] = [];

  /* ------------------------------ core numbers ----------------------------- */

  if (snapshot.topCategory) {
    rows.push({
      kind: 'topCategory',
      key: 'top-category',
      title: 'Top Category',
      detail: `${snapshot.topCategory.name} — ${format.formatCurrency(
        snapshot.topCategory.total,
      )} · ${format.formatPercent(snapshot.topCategory.percent)}% of expenses`,
      icon: snapshot.topCategory.icon,
    });
  }

  if (snapshot.highestSpendingDay) {
    rows.push({
      kind: 'highestSpendingDay',
      key: 'highest-day',
      title: 'Highest Spending Day',
      detail: `${format.formatShortDate(
        snapshot.highestSpendingDay.date,
      )} — ${format.formatCurrency(snapshot.highestSpendingDay.total)}`,
      icon: 'calendar-outline',
    });
  }

  if (snapshot.expenses > 0) {
    rows.push({
      kind: 'averageDailySpend',
      key: 'average-daily',
      title: 'Average Daily Spend',
      detail: format.formatCurrency(snapshot.averageDailySpend),
      icon: 'speedometer-outline',
    });

    rows.push({
      kind: 'averageTransaction',
      key: 'average-transaction',
      title: 'Average Transaction',
      detail: `${format.formatCurrency(snapshot.averageTransaction)} across ${
        snapshot.expenseCount
      } ${snapshot.expenseCount === 1 ? 'expense' : 'expenses'}`,
      icon: 'receipt-outline',
    });
  }

  if (snapshot.mostFrequentCategory) {
    rows.push({
      kind: 'mostFrequentCategory',
      key: 'most-frequent',
      title: 'Most Frequent Category',
      detail: `${snapshot.mostFrequentCategory.name} · ${
        snapshot.mostFrequentCategory.transactionCount
      } transactions — ${format.formatCurrency(
        snapshot.mostFrequentCategory.total,
      )}`,
      icon: snapshot.mostFrequentCategory.icon,
    });
  }

  if (snapshot.largestTransaction) {
    const largest = snapshot.largestTransaction;
    rows.push({
      kind: 'largestTransaction',
      key: 'largest-transaction',
      title: 'Largest Transaction',
      detail: `${largest.title} — ${format.formatCurrency(largest.amount)} · ${
        largest.categoryName ?? 'Income'
      } · ${format.formatShortDate(largest.date)}`,
      icon: 'receipt-outline',
      transaction: {type: largest.type, id: largest.id},
    });
  }

  /* --------------------------- budget state rows --------------------------- */

  const budgetRows: ReportInsight[] = [];
  const budgets = snapshot.budgetPerformance?.categoryBudgets ?? [];
  for (const budget of budgets) {
    if (budget.state === 'exceeded') {
      budgetRows.push({
        kind: 'budgetExceeded',
        key: `budget-exceeded-${budget.categoryId}`,
        title: `${budget.categoryName} budget exceeded`,
        detail: `${format.formatCurrency(budget.spent)} of ${format.formatCurrency(
          budget.amount,
        )} · ${format.formatPercent(budget.percent)}% used`,
        icon: 'alert-circle',
      });
    } else if (budget.state === 'warning') {
      budgetRows.push({
        kind: 'budgetWarning',
        key: `budget-warning-${budget.categoryId}`,
        title: `${budget.categoryName} approaching budget`,
        detail: `${format.formatPercent(budget.percent)}% of ${format.formatCurrency(
          budget.amount,
        )} used`,
        icon: 'warning',
      });
    }
  }
  // Severity order is already exceeded-then-warning per the sorted budgets
  // input; re-sort defensively so the cap keeps the most severe rows.
  budgetRows.sort((a, b) => {
    const rank = (kind: ReportInsight['kind']) =>
      kind === 'budgetExceeded' ? 0 : 1;
    return rank(a.kind) - rank(b.kind);
  });
  rows.push(
    ...budgetRows.slice(0, options.budgetRowLimit ?? BUDGET_ROW_LIMIT_DEFAULT),
  );

  /* ------------------------- income direction row -------------------------- */

  const {income, expenses, balance} = snapshot.incomeVsExpense;
  if (income > 0 && expenses > 0 && balance > 0) {
    rows.push({
      kind: 'incomeSurplus',
      key: 'income-surplus',
      title: 'Income exceeded expenses',
      detail: `${format.formatCurrency(balance)} left over this period`,
      icon: 'trending-up-outline',
    });
  } else if (expenses > 0 && balance < 0) {
    rows.push({
      kind: 'incomeDeficit',
      key: 'income-deficit',
      title: 'Expenses exceeded income',
      detail: `${format.formatCurrency(Math.abs(balance))} overspent this period`,
      icon: 'trending-down-outline',
    });
  }

  /* ------------------------ period-over-period trend ----------------------- */

  const comparison = snapshot.previousPeriodComparison;
  if (
    comparison &&
    comparison.percentChange !== null &&
    comparison.direction !== 'flat' &&
    options.previousLabel
  ) {
    const verb = comparison.direction === 'up' ? 'Up' : 'Down';
    rows.push({
      kind: 'spendingTrend',
      key: 'spending-trend',
      title: 'Spending vs previous period',
      detail: `${verb} ${format.formatPercent(
        Math.abs(comparison.percentChange),
      )}% vs ${options.previousLabel}`,
      icon:
        comparison.direction === 'up'
          ? 'trending-up-outline'
          : 'trending-down-outline',
    });
  }

  return rows;
}
