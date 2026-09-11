import {startOfDay} from '@/utils/date';
import type {
  CategorySlice,
  DailySpendingPoint,
  HighestSpendingDay,
  MonthOverMonthComparison,
  TrendDirection,
} from './types';

/**
 * Pure report calculations — no database, no React, no formatting.
 *
 * Every function is total (never throws) and division-safe: empty datasets
 * and zero denominators map to `0` / `null` rather than NaN or Infinity.
 */

/** Rounds to one decimal, matching the budget progress convention. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Balance = income - expenses (negative means overspending). */
export function computeBalance(income: number, expenses: number): number {
  return income - expenses;
}

/**
 * Average daily spend = total expenses / number of calendar days in the
 * period. Empty periods (no expenses, or a degenerate 0-day window) are Rs.
 * 0 — never NaN. The result is rounded to whole minor units because money
 * is stored as integers everywhere else.
 */
export function computeAverageDailySpend(
  totalExpenses: number,
  dayCount: number,
): number {
  if (dayCount <= 0 || totalExpenses <= 0) {
    return 0;
  }
  return Math.round(totalExpenses / dayCount);
}

/** Input row for the category breakdown (already joined with category data). */
export interface CategoryTotalInput {
  categoryId: number;
  name: string;
  icon: string;
  total: number;
  /** Transaction count for the period (Phase 9); optional for pure callers. */
  transactionCount?: number;
}

/**
 * Builds the category breakdown: zero-spending categories are dropped,
 * each surviving slice gets its percent of the period's total spending,
 * and slices are ordered largest first (ties break by category id for a
 * stable, deterministic order).
 */
export function computeCategoryBreakdown(
  rows: CategoryTotalInput[],
  periodExpenseTotal: number,
): CategorySlice[] {
  if (periodExpenseTotal <= 0) {
    return [];
  }
  return rows
    .filter(row => row.total > 0)
    .map(row => ({
      categoryId: row.categoryId,
      name: row.name,
      icon: row.icon,
      total: row.total,
      percent: round1((row.total / periodExpenseTotal) * 100),
      ...(row.transactionCount !== undefined
        ? {transactionCount: row.transactionCount}
        : {}),
    }))
    .sort((a, b) => b.total - a.total || a.categoryId - b.categoryId);
}

/** The largest slice of a breakdown, or null when nothing was spent. */
export function computeTopCategory(
  breakdown: CategorySlice[],
): CategorySlice | null {
  // Strict `>` keeps the first (highest-sorted) slice on ties.
  return breakdown.reduce<CategorySlice | null>(
    (top, row) => (top === null || row.total > top.total ? row : top),
    null,
  );
}

/**
 * The day with the most spending in a chronological series, or null when
 * nothing was spent. Ties resolve to the EARLIEST day.
 */
export function findHighestSpendingDay(
  points: DailySpendingPoint[],
): HighestSpendingDay | null {
  const top = points.reduce<DailySpendingPoint | null>(
    (best, point) => (best === null || point.total > best.total ? point : best),
    null,
  );
  return top && top.total > 0 ? {date: top.date, total: top.total} : null;
}

/**
 * Current vs previous spending comparison. When the previous period is
 * zero the percentage is mathematically undefined, so `percentChange` is
 * null and only the direction communicates the change — Infinity/NaN can
 * never reach the UI.
 */
export function computePercentChange(
  current: number,
  previous: number,
): MonthOverMonthComparison {
  const difference = current - previous;

  if (previous === 0) {
    return {
      currentTotal: current,
      previousTotal: previous,
      difference,
      percentChange: null,
      direction: current > 0 ? 'up' : 'flat',
    };
  }

  const percentChange = round1((difference / previous) * 100);
  const direction: TrendDirection =
    difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat';

  return {
    currentTotal: current,
    previousTotal: previous,
    difference,
    percentChange,
    direction,
  };
}

/**
 * Average transaction = total / count. Zero-count periods are Rs. 0 —
 * never NaN (Phase 9, same contract as `computeAverageDailySpend`). The
 * result is rounded to whole minor units because money is stored as
 * integers everywhere else.
 */
export function computeAverageTransaction(
  total: number,
  count: number,
): number {
  if (count <= 0 || total <= 0) {
    return 0;
  }
  return Math.round(total / count);
}

/**
 * Expands sparse per-day SQL sums into a COMPLETE chronological series —
 * every calendar day of the period appears exactly once, zero-spend days
 * included.
 *
 * `totalByDayIndex` is keyed by the 0-based offset from `fromDate` as
 * returned by `ExpenseRepository.sumByDay`. Days are generated with
 * calendar arithmetic (`setDate`), so the timestamps stay true local
 * midnights even across DST transitions.
 */
export function buildDailySeries(
  fromDate: number,
  dayCount: number,
  totalByDayIndex: Map<number, number>,
): DailySpendingPoint[] {
  const firstDay = startOfDay(fromDate);
  const series: DailySpendingPoint[] = [];
  for (let index = 0; index < dayCount; index += 1) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + index);
    series.push({date: day.getTime(), total: totalByDayIndex.get(index) ?? 0});
  }
  return series;
}

/**
 * Long ranges (a 6-month custom window, for example) must not render one
 * bar per day — hundreds of 1-2px bars are unreadable on small Android
 * screens. `buildBucketedSeries` aggregates the SAME dayIndex-anchored
 * totals into consecutive buckets of `bucketDays` calendar days, so the
 * trend stays readable while the totals remain exact.
 *
 * Buckets are counted in dayIndex space from the `fromDate` anchor (not
 * raw millisecond math), so DST shifts cannot shift a day into the wrong
 * bucket. Point timestamps are the bucket's FIRST day, computed with
 * calendar arithmetic like `buildDailySeries`. The final bucket covers the
 * remaining partial span, so `sum(buckets) === sum(days)` always holds.
 */
export function buildBucketedSeries(
  fromDate: number,
  dayCount: number,
  totalByDayIndex: Map<number, number>,
  bucketDays: number,
): DailySpendingPoint[] {
  const size = Math.max(1, Math.floor(bucketDays));
  const firstDay = startOfDay(fromDate);
  const series: DailySpendingPoint[] = [];

  for (let start = 0; start < dayCount; start += size) {
    const end = Math.min(start + size, dayCount); // exclusive
    let total = 0;
    for (let index = start; index < end; index += 1) {
      total += totalByDayIndex.get(index) ?? 0;
    }
    const day = new Date(firstDay);
    day.setDate(day.getDate() + start);
    series.push({date: day.getTime(), total});
  }

  return series;
}

/**
 * Picks the bucket size for a period so any trend renders at most
 * `MAX_TREND_BARS` bars: short periods stay daily; longer periods group
 * consecutive days. Exported so the service and the chart agree on the
 * same value for a given day count.
 */
export const MAX_TREND_BARS = 31;

export function trendBucketDaysFor(dayCount: number): number | null {
  if (dayCount <= MAX_TREND_BARS) {
    return null; // daily trend
  }
  return Math.ceil(dayCount / MAX_TREND_BARS);
}
