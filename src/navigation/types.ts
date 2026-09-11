import type {
  CategoryReportScope,
  ReportSelection,
} from '@/features/reports/types';

/**
 * The four primary tabs. "Add Expense" is intentionally NOT a tab — it is
 * the central floating action button, opening the AddExpense modal.
 */
export type MainTabParamList = {
  Home: undefined;
  Transactions: undefined;
  Reports: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  /**
   * Add/Edit expense modal. Without params it creates a new expense;
   * with `expenseId` it edits that record (same screen, same form).
   */
  AddExpense: {expenseId: number} | undefined;
  /**
   * Add/Edit income modal. Without params it creates a new income record;
   * with `incomeId` it edits that record (same screen, same form).
   */
  AddIncome: {incomeId: number} | undefined;
  /**
   * Budget overview screen (pushed, not a tab). Without params it opens on
   * the current month; with `year`/`month` it opens on that month — used by
   * the dashboard's budget card ("View budget" / "Set budget").
   */
  Budgets: {year: number; month: number} | undefined;
  /** Category management (expense + income), pushed from More. */
  Categories: undefined;
  /**
   * Recurring rule list (pushed from More). Shows [Expenses] [Income]
   * segments over the stored rules; rules generate normal transactions.
   */
  Recurring: undefined;
  /**
   * Add/Edit recurring rule. Without `ruleId` it creates a rule of the
   * given type; with `ruleId` it edits that rule (type is re-read from
   * the rule itself).
   */
  RecurringForm: {type: 'expense' | 'income'; ruleId?: number};
  /** App settings (currency, theme, about), pushed from More. */
  Settings: undefined;
  /** Backup & export (CSV export, JSON backup, restore), pushed from More. */
  Backup: undefined;
  /**
   * CSV export configuration → preview → share (Phase 10). Stateless —
   * the config lives on the screen and dies with it.
   */
  ExportCsv: undefined;
  /**
   * CSV import: select → parse → validate → preview → confirm → atomic
   * import → summary (Phase 10). Intercepts Android back while the
   * transaction is running.
   */
  ImportCsv: undefined;
  /**
   * Report drill-down (Phase 9): one expense category or income source
   * over the Reports screen's current window. The scope is an id/exact
   * source — data is RELOADED from the database here, never passed through
   * navigation. `selection` + `period` preserve the overview's filter so
   * the drill-down shows exactly the period the user came from, and the
   * overview keeps it when navigating back.
   */
  CategoryDetail: {
    scope: CategoryReportScope;
    selection: ReportSelection;
    period: {fromDate: number; toDate: number};
  };
};
