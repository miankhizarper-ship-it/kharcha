import type {
  CategoryBudgetProgress,
  OverallBudgetProgress,
} from '@/features/budgets/types';

/**
 * UI-facing models for the Reports feature.
 *
 * Everything here is DERIVED from real SQLite rows at read time — nothing is
 * cached, mocked or persisted. Money values are minor units (paisa),
 * consistent with the rest of the app; timestamps are epoch millis and day
 * points carry local midnights.
 */

/**
 * Which window a report covers.
 *
 * - `thisWeek` — the ISO week (Mon–Sun) containing the requested `now`.
 * - `month`    — a specific calendar month; presets (`This Month`,
 *   `Last Month`) and the `< >` navigator both land here.
 * - `custom`   — an explicit inclusive date range (reversed endpoints are
 *   normalized by the period layer, never rejected).
 */
export type ReportSelection =
  | {kind: 'thisWeek'}
  | {kind: 'month'; year: number; month: number}
  | {kind: 'custom'; fromDate: number; toDate: number};

/** Chip identifiers for the period selector row. */
export type ReportPreset = 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

/** Resolved window of a report, with the day count used for averages. */
export interface ReportPeriodInfo {
  /** Inclusive local window (epoch millis). */
  fromDate: number;
  toDate: number;
  /** Number of calendar days covered, >= 1 (single-day ranges allowed). */
  dayCount: number;
}

/** One day of the daily spending series. */
export interface DailySpendingPoint {
  /** Local midnight of the day. */
  date: number;
  /** Spent that day (minor units); 0 for zero-spend days. */
  total: number;
}

/** One category's share of the period's spending. */
export interface CategorySlice {
  categoryId: number;
  name: string;
  /** Stable icon key — resolve via `categoryIconName`. */
  icon: string;
  /** Spent in the period (minor units), always > 0. */
  total: number;
  /** total / period expenses * 100, rounded to 1 decimal. */
  percent: number;
  /**
   * Transactions in the category for the period (Phase 9). Present whenever
   * the snapshot was built from `sumCountByCategory`; optional so pure
   * callers without counts stay valid.
   */
  transactionCount?: number;
}

/** The income/expense comparison block. */
export interface IncomeVsExpense {
  income: number;
  expenses: number;
  /** income - expenses. */
  balance: number;
}

/** The single most expensive day of the period. */
export interface HighestSpendingDay {
  /** Local midnight of the day. */
  date: number;
  total: number;
}

/** Direction of a spending comparison. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** Current vs previous month spending. */
export interface MonthOverMonthComparison {
  currentTotal: number;
  previousTotal: number;
  /** currentTotal - previousTotal; negative means less was spent. */
  difference: number;
  /**
   * Percent change rounded to 1 decimal. `null` when the previous period had
   * zero spending — the percentage is mathematically undefined and must
   * never surface as Infinity/NaN.
   */
  percentChange: number | null;
  direction: TrendDirection;
}

/**
 * Budget block for month reports, reusing the Budget feature's computed
 * progress as-is (no duplicated budget math).
 */
export interface ReportBudgetPerformance {
  /** The month's overall budget with live progress; null when not set. */
  overall: OverallBudgetProgress | null;
  /** Highest-usage category budgets (max 3) for the compact status list. */
  topCategories: CategoryBudgetProgress[];
  /**
   * EVERY category budget of the month (Phase 9) so the category breakdown
   * can annotate rows and insights can flag exceeded/approaching budgets.
   */
  categoryBudgets: CategoryBudgetProgress[];
}

/** Everything the Reports screen renders for one selection. */
export interface ReportSnapshot {
  period: ReportPeriodInfo;
  income: number;
  expenses: number;
  /** income - expenses; negative means overspending. */
  balance: number;
  /** expenses / dayCount (minor units, rounded); 0 for empty periods. */
  averageDailySpend: number;
  /**
   * Complete chronological series — every calendar day of the period is
   * present, zero-spend days included.
   */
  dailySpending: DailySpendingPoint[];
  /** Spending per category, largest first; zero-spend categories excluded. */
  categoryBreakdown: CategorySlice[];
  incomeVsExpense: IncomeVsExpense;
  /** Highest-spending category, or null when nothing was spent. */
  topCategory: CategorySlice | null;
  /** Day with the most spending, or null when nothing was spent. */
  highestSpendingDay: HighestSpendingDay | null;
  /** Month selections only; null for week/custom. */
  previousPeriodComparison: MonthOverMonthComparison | null;
  /** Month selections only; null for week/custom. */
  budgetPerformance: ReportBudgetPerformance | null;

  /* ------------------------- Phase 9 additions ------------------------- */

  /** Expense rows in the period (frequency insight, summary card). */
  expenseCount: number;
  /** Income rows in the period. */
  incomeCount: number;
  /**
   * expenses / expenseCount (minor units, rounded); 0 when the period has
   * no expenses — never NaN (same contract as `averageDailySpend`).
   */
  averageTransaction: number;
  /** The single biggest transaction of the period, either ledger side. */
  largestTransaction: ReportLargestTransaction | null;
  /**
   * Category with the MOST transactions (ties → more money → lower id), or
   * null when nothing was spent.
   */
  mostFrequentCategory: MostFrequentCategory | null;
  /** Income grouped by source, largest first; empty when no income. */
  incomeSources: IncomeSourceSummary[];
}

/* ============================ Phase 9 additions ============================ */

/**
 * What a report drill-down is scoped to. Expenses drill into a category id;
 * income has no category FK (free-text `source` by design), so income
 * drill-downs are scoped to the exact source string `sumBySource` grouped
 * by. ONE detail screen serves both — no duplicated screens.
 */
export type CategoryReportScope =
  {kind: 'expense'; categoryId: number} | {kind: 'income'; source: string};

/**
 * One day (or bucket of days, for long custom ranges) of a category's
 * spending trend. Same shape semantics as `DailySpendingPoint`; a separate
 * name keeps the two trend contexts explicit.
 */
export type CategoryTrendPoint = DailySpendingPoint;

/** Income grouped by one source for the period. */
export interface IncomeSourceSummary {
  /** Exact free-text source stored on the income rows. */
  source: string;
  /** Stable icon key from the matching income category, if any. */
  icon: string;
  /** Received in the period (minor units), always > 0. */
  total: number;
  /** total / period income * 100, rounded to 1 decimal. */
  percent: number;
  transactionCount: number;
}

/** The biggest transaction of a report period (either ledger side). */
export interface ReportLargestTransaction {
  /** Stable key matching the combined-ledger convention. */
  key: string;
  type: 'expense' | 'income';
  id: number;
  /** Expense title or income source. */
  title: string;
  /** Minor units. */
  amount: number;
  /** Epoch millis. */
  date: number;
  /** Expense category name; null for income. */
  categoryName: string | null;
}

/** Category with the most transactions in the period. */
export interface MostFrequentCategory {
  categoryId: number;
  name: string;
  icon: string;
  transactionCount: number;
  total: number;
}

/* ------------------------------ insights model ----------------------------- */

/**
 * Kinds of deterministic report insights (Phase 9). Every value is computed
 * from real database rows — no AI, no fabricated advice (spec §11).
 */
export type ReportInsightKind =
  | 'topCategory'
  | 'highestSpendingDay'
  | 'averageDailySpend'
  | 'averageTransaction'
  | 'largestTransaction'
  | 'mostFrequentCategory'
  | 'spendingTrend'
  | 'budgetExceeded'
  | 'budgetWarning'
  | 'incomeSurplus'
  | 'incomeDeficit';

/** One rendered row of the Insights section. */
export interface ReportInsight {
  kind: ReportInsightKind;
  /** Stable key for list rendering. */
  key: string;
  /** Primary display text, e.g. "Food & Dining". */
  title: string;
  /** Secondary display text, e.g. "PKR 8,500 · 42% of expenses". */
  detail: string | null;
  /**
   * Icon glyph for the row. The string is a stable Ionicons name resolved
   * by the UI layer (kept as data so the pure builder stays UI-agnostic).
   */
  icon: string;
  /**
   * Navigation target when the insight opens a record — only set for
   * `largestTransaction` rows. Internal ids are never rendered as text.
   */
  transaction?: {type: 'expense' | 'income'; id: number};
}

/* ---------------------------- category detail ------------------------------ */

/**
 * How the drill-down's budget block should read. Budgets are monthly by
 * design, so non-month selections cannot show meaningful budget math:
 * - `set`        — a category budget exists; `budget` carries its progress
 * - `notSet`     — month selection but no budget for this category
 * - `notMonthly` — week/custom selection; budgets don't apply
 */
export type CategoryBudgetStatus = 'set' | 'notSet' | 'notMonthly';

/** Everything the Category Detail screen renders for one scope + period. */
export interface CategoryReportDetail {
  scope: CategoryReportScope;
  /** Display name: category name, or the exact income source text. */
  name: string;
  /** Stable icon key — resolve via `categoryIconName`. */
  icon: string;
  /**
   * Archived categories stay resolvable for history; the screen surfaces
   * this state. Always null for income sources (no category row).
   */
  isActive: boolean | null;
  period: ReportPeriodInfo;
  /** Spent (expense scope) or received (income scope) in the period. */
  total: number;
  /**
   * Share of the period's total expenses (expense scope) or income (income
   * scope), rounded to 1 decimal — same zero-safe contract as the
   * breakdown percentages. null when the period total is 0.
   */
  percent: number | null;
  transactionCount: number;
  /** total / transactionCount (minor units, rounded); 0 with no rows. */
  averageTransaction: number;
  /** Biggest single row in this scope for the period; null with no rows. */
  largestTransaction: ReportLargestTransaction | null;
  /**
   * Complete chronological series — every day (or bucket) of the period is
   * present, zero days included.
   */
  trend: CategoryTrendPoint[];
  /** Days per trend bar; null when the trend is daily. */
  trendBucketDays: number | null;
  budget: CategoryBudgetProgress | null;
  budgetStatus: CategoryBudgetStatus;
  /**
   * Current vs previous comparable period (previous calendar month for
   * month selections, equal-length window otherwise). `percentChange` is
   * null — never NaN/Infinity — when the previous period had zero activity.
   */
  previousComparison: MonthOverMonthComparison;
}
