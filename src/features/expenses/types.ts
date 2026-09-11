import type {ExpenseWithCategory, PaymentMethod} from '@/database/models';

/** Coarse time window applied to transaction lists and totals. */
export type PeriodFilter = 'all' | 'thisMonth' | 'last7Days';

export const PERIOD_FILTERS: {value: PeriodFilter; label: string}[] = [
  {value: 'all', label: 'All time'},
  {value: 'thisMonth', label: 'This month'},
  {value: 'last7Days', label: 'Last 7 days'},
];

/** What the Transactions screen asks the feature service for. */
export interface TransactionQuery {
  /** Substring matched against title or note. */
  search?: string;
  /** `null`/`undefined` means every category. */
  categoryId?: number | null;
  period?: PeriodFilter;
  /** Zero-based page index. */
  page?: number;
  /** Rows per page; defaults to `TRANSACTION_PAGE_SIZE`. */
  pageSize?: number;
}

export interface TransactionPage {
  items: ExpenseWithCategory[];
  /** Whether another page exists after this one. */
  hasMore: boolean;
}

/** Default page size for the transactions list. */
export const TRANSACTION_PAGE_SIZE = 30;

/** How many recent transactions the dashboard shows. */
export const DASHBOARD_RECENT_LIMIT = 5;

/** How many category rows the dashboard breakdown shows. */
export const DASHBOARD_CATEGORY_LIMIT = 5;

/** Category spending row on the dashboard. */
export interface CategoryTotal {
  categoryId: number;
  name: string;
  icon: string;
  /** Sum in minor units. */
  total: number;
}

/**
 * Expense-side dashboard snapshot: spending-only aggregates computed by the
 * expense feature. NOTE: this is intentionally distinct from the combined
 * `DashboardSnapshot` in `features/transactions/types.ts` (which adds income
 * + balance on top of this one) — the transactions feature consumes it as an
 * input. Likewise the `TransactionQuery`/`TransactionPage` types below back
 * the expense feature's own offset pagination API, which is separate from
 * the combined ledger's window-merge pagination.
 */
export interface DashboardSnapshot {
  /** Spent today (minor units). */
  todayTotal: number;
  /** Spent in the current calendar month (minor units). */
  monthTotal: number;
  /** Current-month totals per category, largest first. */
  categoryTotals: CategoryTotal[];
  /** Newest transactions, any date. */
  recent: ExpenseWithCategory[];
}

/** Payment method option shown in the Add/Edit form. */
export interface PaymentMethodOption {
  value: PaymentMethod;
  label: string;
}
