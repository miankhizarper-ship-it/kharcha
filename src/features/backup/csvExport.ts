import type {DatabaseService} from '@/database/service';
import type {ExpenseWithCategory, Income} from '@/database/models';
import {
  monthBounds,
  previousMonth,
  weekBounds,
  endOfDay,
  startOfDay,
} from '@/utils/date';
import {buildTransactionCsv} from './csv';

/**
 * Smart CSV export (Phase 10) — filtered, previewable transaction export.
 *
 * The config → summary → file pipeline is ONE read pass: the same filtered
 * repository queries feed both the preview summary and the CSV text, so a
 * preview never doubles the queries and the exported file always matches
 * the numbers shown. Filtering happens in SQL (repository filters), never
 * by loading the whole database into JS and filtering there (spec §2).
 */

/** Which rows to export. */
export type CsvExportType = 'all' | 'expenses' | 'income';

/** Which window to export. Custom ranges are resolved to full local days. */
export type CsvExportPeriod =
  | {kind: 'all'}
  | {kind: 'thisWeek'}
  | {kind: 'thisMonth'}
  | {kind: 'lastMonth'}
  | {kind: 'custom'; fromDate: number; toDate: number};

export interface CsvExportConfig {
  type: CsvExportType;
  period: CsvExportPeriod;
  /**
   * Optional expense-category filter. The data model only supports
   * category filtering for EXPENSES (income has no category FK — its
   * `source` is free text), so a category filter locks the export to
   * expenses; the preview states this explicitly.
   */
  categoryId?: number;
}

/** The numbers shown in the preview before anything is shared. */
export interface CsvExportSummary {
  /** Resolved inclusive window; null for "All time". */
  fromDate: number | null;
  toDate: number | null;
  expenseCount: number;
  incomeCount: number;
  /** Minor units. */
  totalExpenses: number;
  /** Minor units. */
  totalIncome: number;
}

/** Everything the export flow needs after the single read pass. */
export interface PreparedCsvExport {
  config: CsvExportConfig;
  summary: CsvExportSummary;
  /** RFC 4180 CSV text ready to stage and share. */
  csv: string;
}

/**
 * Predictable export filenames (spec §6): date-stamped for all-time
 * exports, range-stamped for filtered ones. Internal ids/version details
 * are deliberately kept out of the filename.
 */
export function buildCsvFilename(
  nowMs: number,
  period?: CsvExportPeriod,
): string {
  const stamp = (ms: number): string => {
    const date = new Date(ms);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  };

  if (period && period.kind !== 'all') {
    const resolved = resolveExportPeriod(period, nowMs);
    return `kharcha-transactions-${stamp(resolved.fromDate)}-to-${stamp(
      resolved.toDate,
    )}.csv`;
  }
  return `kharcha-transactions-${stamp(nowMs)}.csv`;
}

/**
 * Resolves an export period to an inclusive local window using the shared
 * date utilities — one date system for the whole app (no UTC drift, DST-
 * safe week bounds, calendar-arithmetic month bounds).
 */
export function resolveExportPeriod(
  period: CsvExportPeriod,
  now: number,
): {fromDate: number; toDate: number} {
  switch (period.kind) {
    case 'all':
      // Every record: unbounded on both sides.
      return {fromDate: 0, toDate: Number.MAX_SAFE_INTEGER};
    case 'thisWeek': {
      const bounds = weekBounds(now);
      return {fromDate: bounds.fromDate, toDate: bounds.toDate};
    }
    case 'thisMonth': {
      const date = new Date(now);
      const bounds = monthBounds(date.getFullYear(), date.getMonth() + 1);
      return {fromDate: bounds.fromDate, toDate: bounds.toDate};
    }
    case 'lastMonth': {
      const date = new Date(now);
      const previous = previousMonth(date.getFullYear(), date.getMonth() + 1);
      const bounds = monthBounds(previous.year, previous.month);
      return {fromDate: bounds.fromDate, toDate: bounds.toDate};
    }
    case 'custom': {
      const from = Math.min(period.fromDate, period.toDate);
      const to = Math.max(period.fromDate, period.toDate);
      return {fromDate: startOfDay(from), toDate: endOfDay(to)};
    }
  }
}

/**
 * Single-pass export preparation: runs the filtered queries, totals the
 * rows and builds the CSV text. The category filter (when set) applies to
 * expenses only — income rows are excluded from a category-filtered export
 * because the data model cannot filter income by category.
 */
export async function prepareCsvExport(
  db: DatabaseService,
  config: CsvExportConfig,
  now: number = Date.now(),
): Promise<PreparedCsvExport> {
  const {fromDate, toDate} = resolveExportPeriod(config.period, now);
  const window = config.period.kind === 'all' ? {} : {fromDate, toDate};
  const categoryLocked = config.categoryId !== undefined;

  const expenseFilter = {
    ...window,
    ...(config.categoryId !== undefined ? {categoryId: config.categoryId} : {}),
    order: 'dateAsc' as const,
  };

  // Income participates only in non-category-filtered exports of type
  // all/income; SQL does every filter (spec §2 — no JS-side sifting).
  const incomeFilter = {...window, order: 'dateAsc' as const};

  const includeExpenses = config.type !== 'income';
  const includeIncome = config.type !== 'expenses' && !categoryLocked;

  const [expenses, income] = await Promise.all([
    includeExpenses
      ? db.expenses.listWithCategory(expenseFilter)
      : Promise.resolve<ExpenseWithCategory[]>([]),
    includeIncome
      ? db.income.list(incomeFilter)
      : Promise.resolve<Income[]>([]),
  ]);

  const summary: CsvExportSummary = {
    fromDate: config.period.kind === 'all' ? null : fromDate,
    toDate: config.period.kind === 'all' ? null : toDate,
    expenseCount: expenses.length,
    incomeCount: income.length,
    // Integer totals of already-integer rows — no float math anywhere.
    totalExpenses: expenses.reduce((sum, row) => sum + row.amount, 0),
    totalIncome: income.reduce((sum, row) => sum + row.amount, 0),
  };

  return {
    config,
    summary,
    csv: buildTransactionCsv({expenses, income}),
  };
}
