import type {PaymentMethod} from '@/database/models';
import {
  endOfDay,
  endOfMonth,
  monthBounds,
  previousMonth,
  startOfDay,
  startOfMonth,
  weekBounds,
} from '@/utils/date';
import {parseAmountToMinor} from '@/utils/money';
import {formatCurrency} from '@/utils/format';
import {paymentMethodLabel} from '@/features/expenses/paymentMethods';
import {
  formatDateRangeLabel,
  normalizeCustomRange,
} from '@/features/reports/period';
import type {
  TransactionCustomRange,
  TransactionDatePeriod,
  TransactionQuery,
  TransactionRecurringFilter,
  TransactionSort,
  TransactionTypeFilter,
} from './types';

/**
 * Pure filter logic for the Transactions browser (Phase 11).
 *
 * This module OWNS the screen-level filter state shape and every pure
 * decision around it: date-window resolution (through the shared date
 * utilities — one date system in the app), amount-input validation (exact
 * string parsing, no floats), active-filter chip labels and the compact
 * result summary. The screen stays a thin renderer; everything testable
 * lives here.
 */

/** The complete filter state of the Transactions screen. */
export interface TransactionFilters {
  type: TransactionTypeFilter;
  /** Committed (debounced) search term; '' = inactive. */
  search: string;
  /** `null` = every category. Expenses only — income has no category FK. */
  categoryId: number | null;
  /** `null` = every payment method. Expenses only. */
  paymentMethod: PaymentMethod | null;
  recurring: TransactionRecurringFilter;
  period: TransactionDatePeriod;
  /** Required when `period` is `'custom'`. */
  customRange: TransactionCustomRange | null;
  /** Inclusive minimum amount in minor units; `null` = unset. */
  minAmount: number | null;
  /** Inclusive maximum amount in minor units; `null` = unset. */
  maxAmount: number | null;
  sort: TransactionSort;
}

/** Fresh, mutable-copy factory — never share the default object. */
export function defaultTransactionFilters(): TransactionFilters {
  return {
    type: 'all',
    search: '',
    categoryId: null,
    paymentMethod: null,
    recurring: 'all',
    period: 'all',
    customRange: null,
    minAmount: null,
    maxAmount: null,
    sort: 'newest',
  };
}

/**
 * Resolves a date-period selection to an inclusive local epoch-millis
 * window using the shared date utilities (same system as Reports/CSV
 * export — DST-safe weeks, calendar-arithmetic months, local-noon
 * anchors). `custom` without a stored range resolves to "unbounded" so a
 * half-configured state can never narrow the ledger by accident.
 */
export function transactionPeriodToBounds(
  period: TransactionDatePeriod | undefined,
  customRange: TransactionCustomRange | null | undefined,
  now: number,
): {fromDate?: number; toDate?: number} {
  switch (period) {
    case 'today':
      return {fromDate: startOfDay(now), toDate: endOfDay(now)};
    case 'thisWeek': {
      const bounds = weekBounds(now);
      return {fromDate: bounds.fromDate, toDate: bounds.toDate};
    }
    case 'thisMonth':
      return {fromDate: startOfMonth(now), toDate: endOfMonth(now)};
    case 'lastMonth': {
      const date = new Date(now);
      const previous = previousMonth(date.getFullYear(), date.getMonth() + 1);
      const bounds = monthBounds(previous.year, previous.month);
      return {fromDate: bounds.fromDate, toDate: bounds.toDate};
    }
    case 'custom':
      return customRange
        ? normalizeCustomRange(customRange.fromDate, customRange.toDate)
        : {};
    default:
      return {};
  }
}

/** Result of validating one amount-bound input. */
export interface AmountBoundValidation {
  /** Minor units, or `null` when the field was left empty (= unset). */
  minor: number | null;
  /** Human-readable error; `null` when the input is acceptable. */
  error: string | null;
}

/**
 * Validates one min/max amount field. Empty means "not set" (valid);
 * everything else must parse as an exact positive decimal with at most two
 * fraction digits (per the currency's minor-unit rules) — `parseAmountToMinor`
 * does the strict string math, so no floating point is involved.
 */
export function validateAmountBound(
  raw: string,
  label: 'Minimum' | 'Maximum',
): AmountBoundValidation {
  const text = raw.trim();
  if (text.length === 0) {
    return {minor: null, error: null};
  }
  const minor = parseAmountToMinor(text);
  if (minor === null) {
    return {
      minor: null,
      error: `${label} amount must be a number like 500 or 500.50.`,
    };
  }
  if (minor <= 0) {
    return {
      minor: null,
      error: `${label} amount must be greater than zero.`,
    };
  }
  return {minor, error: null};
}

/** Cross-field check: a minimum above the maximum can match nothing. */
export function validateAmountRange(
  min: number | null,
  max: number | null,
): string | null {
  if (min !== null && max !== null && min > max) {
    return 'Minimum amount cannot be greater than the maximum.';
  }
  return null;
}

/**
 * Which filter kinds can appear as removable chips. Sort is included (it is
 * user-selectable state), but it does NOT count towards the Filters badge —
 * it reorders rows instead of constraining which rows match.
 */
export type ActiveFilterChipKind =
  | 'search'
  | 'type'
  | 'category'
  | 'payment'
  | 'recurring'
  | 'period'
  | 'minAmount'
  | 'maxAmount'
  | 'sort';

export interface ActiveFilterChip {
  kind: ActiveFilterChipKind;
  label: string;
  /** Accessibility label announced instead of the visual text. */
  accessibilityLabel: string;
}

/** Everything needed to render the human labels of active filters. */
export interface FilterLabelContext {
  /** Resolved name of the selected category (empty when none). */
  categoryName?: string;
  currency: string;
}

/** Truncates long values (search terms, category names) for chip labels. */
function chipText(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Compact chips for the Transactions screen (spec §10): one per active
 * filter, each individually removable. `sort` only appears when it differs
 * from the default (`newest`).
 */
export function buildActiveFilterChips(
  filters: TransactionFilters,
  context: FilterLabelContext,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (filters.search.length > 0) {
    const label = `"${chipText(filters.search)}"`;
    chips.push({
      kind: 'search',
      label,
      accessibilityLabel: `Search ${label}, remove filter`,
    });
  }
  if (filters.type !== 'all') {
    const label = filters.type === 'expense' ? 'Expenses' : 'Income';
    chips.push({
      kind: 'type',
      label,
      accessibilityLabel: `${label} filter, remove filter`,
    });
  }
  if (filters.categoryId !== null) {
    const label = chipText(context.categoryName ?? 'Category');
    chips.push({
      kind: 'category',
      label,
      accessibilityLabel: `${context.categoryName ?? 'Category'} category filter, remove filter`,
    });
  }
  if (filters.paymentMethod !== null) {
    const label = paymentMethodLabel(filters.paymentMethod);
    chips.push({
      kind: 'payment',
      label,
      accessibilityLabel: `${label} payment filter, remove filter`,
    });
  }
  if (filters.recurring !== 'all') {
    const label = filters.recurring === 'recurring' ? 'Recurring' : 'Manual';
    chips.push({
      kind: 'recurring',
      label,
      accessibilityLabel: `${label} transactions filter, remove filter`,
    });
  }
  if (filters.period !== 'all') {
    const label =
      filters.period === 'custom' && filters.customRange
        ? formatDateRangeLabel(
            filters.customRange.fromDate,
            filters.customRange.toDate,
          )
        : periodLabel(filters.period);
    chips.push({
      kind: 'period',
      label,
      accessibilityLabel: `${label} date filter, remove filter`,
    });
  }
  if (filters.minAmount !== null) {
    const label = `${formatCurrency(filters.minAmount, context.currency)}+`;
    chips.push({
      kind: 'minAmount',
      label,
      accessibilityLabel: `Minimum amount ${label}, remove filter`,
    });
  }
  if (filters.maxAmount !== null) {
    const label = `≤ ${formatCurrency(filters.maxAmount, context.currency)}`;
    chips.push({
      kind: 'maxAmount',
      label,
      accessibilityLabel: `Maximum amount ${label}, remove filter`,
    });
  }
  if (filters.sort !== 'newest') {
    const label =
      filters.sort === 'oldest'
        ? 'Oldest first'
        : filters.sort === 'highest'
          ? 'Highest amount'
          : 'Lowest amount';
    chips.push({
      kind: 'sort',
      label,
      accessibilityLabel: `Sorted by ${label.toLowerCase()}, remove filter`,
    });
  }

  return chips;
}

function periodLabel(period: TransactionDatePeriod): string {
  switch (period) {
    case 'today':
      return 'Today';
    case 'thisWeek':
      return 'This week';
    case 'thisMonth':
      return 'This month';
    case 'lastMonth':
      return 'Last month';
    default:
      return 'All time';
  }
}

/**
 * Filters that CONSTRAIN which rows match (everything except `sort`).
 * Drives the Filters badge, the filtered-empty state and the result-count
 * query — the count only needs fetching when a constraint is active.
 */
export function hasActiveFilters(filters: TransactionFilters): boolean {
  return (
    filters.search.length > 0 ||
    filters.type !== 'all' ||
    filters.categoryId !== null ||
    filters.paymentMethod !== null ||
    filters.recurring !== 'all' ||
    filters.period !== 'all' ||
    filters.minAmount !== null ||
    filters.maxAmount !== null
  );
}

/**
 * Compact context line above the list (spec §11), e.g.
 * "24 expenses · Food · This month". Never lists every active filter — the
 * chips already do that; this summarizes the strongest constraints.
 */
export function buildTransactionSummary(
  count: number,
  filters: TransactionFilters,
  context: FilterLabelContext,
): string {
  const noun =
    filters.type === 'expense'
      ? 'expenses'
      : filters.type === 'income'
        ? 'income transactions'
        : 'transactions';
  const parts: string[] = [];
  if (filters.categoryId !== null) {
    parts.push(chipText(context.categoryName ?? 'Category', 24));
  }
  if (filters.paymentMethod !== null) {
    parts.push(paymentMethodLabel(filters.paymentMethod));
  }
  if (filters.period !== 'all') {
    parts.push(periodLabel(filters.period));
  }
  return parts.length > 0
    ? `${count} ${noun} · ${parts.join(' · ')}`
    : `${count} ${noun}`;
}

/** Produces the result-count noun for accessibility announcements. */
export function summarizeCountForAccessibility(
  count: number,
  filters: TransactionFilters,
): string {
  return `${count} ${
    filters.type === 'expense'
      ? 'expenses'
      : filters.type === 'income'
        ? 'income transactions'
        : 'transactions'
  } match the current filters`;
}

/**
 * Maps the screen's filter state onto a service query. Every constraint is
 * passed through; the service applies them all inside SQL.
 */
export function filtersToQuery(
  filters: TransactionFilters,
  page: number,
  pageSize?: number,
): TransactionQuery {
  return {
    type: filters.type,
    search: filters.search.length > 0 ? filters.search : undefined,
    categoryId: filters.categoryId,
    paymentMethod: filters.paymentMethod,
    recurring: filters.recurring,
    period: filters.period,
    customRange: filters.customRange,
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
    sort: filters.sort,
    page,
    ...(pageSize !== undefined ? {pageSize} : {}),
  };
}

/**
 * Removes ONE filter (chip ✕ tap): the kind resets to its neutral value.
 * Removing the date period also drops the stored custom range so a later
 * re-selection starts fresh.
 */
export function removeFilterChip(
  filters: TransactionFilters,
  kind: ActiveFilterChipKind,
): TransactionFilters {
  switch (kind) {
    case 'search':
      return {...filters, search: ''};
    case 'type':
      return {...filters, type: 'all'};
    case 'category':
      return {...filters, categoryId: null};
    case 'payment':
      return {...filters, paymentMethod: null};
    case 'recurring':
      return {...filters, recurring: 'all'};
    case 'period':
      return {...filters, period: 'all', customRange: null};
    case 'minAmount':
      return {...filters, minAmount: null};
    case 'maxAmount':
      return {...filters, maxAmount: null};
    case 'sort':
      return {...filters, sort: 'newest'};
  }
}
