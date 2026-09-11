import {
  DAY_MS,
  endOfDay,
  formatMonthLabel,
  monthBounds,
  previousMonth,
  startOfDay,
  weekBounds,
} from '@/utils/date';
import type {ReportPreset, ReportSelection} from './types';

/**
 * Period semantics for the Reports feature.
 *
 * This module OWNS the mapping from a `ReportSelection` to concrete local
 * date windows, but every boundary is derived through the shared date
 * utilities (`monthBounds`, `weekBounds`, `startOfDay`, `endOfDay`) — there
 * is exactly one date system in the app.
 */

/** A resolved, inclusive report window. */
export interface ResolvedReportPeriod {
  fromDate: number;
  toDate: number;
  /** Calendar days covered, >= 1. */
  dayCount: number;
}

/** The (year, month) a timestamp falls in, 1-based month. */
export function currentMonthOf(now: number): {year: number; month: number} {
  const date = new Date(now);
  return {year: date.getFullYear(), month: date.getMonth() + 1};
}

/**
 * Normalizes a custom range: reversed endpoints are swapped (never treated
 * as an error), and both ends are widened to full local day boundaries so
 * any timestamp chosen via the calendar covers its whole day.
 */
export function normalizeCustomRange(
  fromDate: number,
  toDate: number,
): {fromDate: number; toDate: number} {
  return fromDate <= toDate
    ? {fromDate: startOfDay(fromDate), toDate: endOfDay(toDate)}
    : {fromDate: startOfDay(toDate), toDate: endOfDay(fromDate)};
}

/** Maps any selection to its concrete local window. */
export function resolveReportPeriod(
  selection: ReportSelection,
  now: number,
): ResolvedReportPeriod {
  switch (selection.kind) {
    case 'thisWeek': {
      const {fromDate, toDate} = weekBounds(now);
      return withDayCount(fromDate, toDate);
    }
    case 'month': {
      const {fromDate, toDate} = monthBounds(selection.year, selection.month);
      return withDayCount(fromDate, toDate);
    }
    case 'custom': {
      const {fromDate, toDate} = normalizeCustomRange(
        selection.fromDate,
        selection.toDate,
      );
      return withDayCount(fromDate, toDate);
    }
  }
}

function withDayCount(fromDate: number, toDate: number): ResolvedReportPeriod {
  // Calendar-day difference; Math.round absorbs the ±1h a DST shift adds.
  const dayCount =
    Math.round((startOfDay(toDate) - startOfDay(fromDate)) / DAY_MS) + 1;
  return {fromDate, toDate, dayCount: Math.max(1, dayCount)};
}

/** Calendar days covered by an inclusive local window, >= 1. */
export function dayCountBetween(fromDate: number, toDate: number): number {
  return withDayCount(fromDate, toDate).dayCount;
}

/**
 * The comparable period immediately BEFORE the resolved window:
 * - month selections compare against the previous CALENDAR month (same
 *   semantics as the existing month-over-month card);
 * - week/custom selections compare against an equal-length window ending
 *   the day before `fromDate` ("same length, immediately before"), so a
 *   14-day custom range compares against the 14 days before it.
 *
 * All math is calendar arithmetic (`setDate`), never raw DAY_MS addition,
 * keeping boundaries on true local midnights across DST transitions.
 */
export function resolvePreviousPeriod(
  selection: ReportSelection,
  period: ResolvedReportPeriod,
): ResolvedReportPeriod {
  if (selection.kind === 'month') {
    const previous = previousMonth(selection.year, selection.month);
    const bounds = monthBounds(previous.year, previous.month);
    return withDayCount(bounds.fromDate, bounds.toDate);
  }

  const dayBefore = new Date(startOfDay(period.fromDate));
  dayBefore.setDate(dayBefore.getDate() - 1);
  const previousFrom = new Date(dayBefore);
  previousFrom.setDate(previousFrom.getDate() - (period.dayCount - 1));

  return {
    fromDate: startOfDay(previousFrom.getTime()),
    toDate: endOfDay(dayBefore.getTime()),
    dayCount: period.dayCount,
  };
}

/* ------------------------------ labels & chips ----------------------------- */

const RANGE_DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});
const RANGE_FULL_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Sep 7 – Sep 13, 2026" (the year appears once when both ends share it). */
export function formatDateRangeLabel(fromDate: number, toDate: number): string {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const sameYear = from.getFullYear() === to.getFullYear();
  const fromLabel = sameYear
    ? RANGE_DAY_FORMAT.format(fromDate)
    : RANGE_FULL_FORMAT.format(fromDate);
  return `${fromLabel} – ${RANGE_FULL_FORMAT.format(toDate)}`;
}

/** Human label for the selection, used by the screen's period header. */
export function formatReportSelectionLabel(
  selection: ReportSelection,
  now: number,
): string {
  switch (selection.kind) {
    case 'thisWeek': {
      const {fromDate, toDate} = weekBounds(now);
      return formatDateRangeLabel(fromDate, toDate);
    }
    case 'month':
      return formatMonthLabel(selection.year, selection.month);
    case 'custom':
      return formatDateRangeLabel(selection.fromDate, selection.toDate);
  }
}

/**
 * Which preset chip (if any) should render active for the selection.
 * Navigating to a non-current, non-previous month highlights no chip.
 */
export function activePresetOf(
  selection: ReportSelection,
  now: number,
): ReportPreset | null {
  if (selection.kind === 'thisWeek') {
    return 'thisWeek';
  }
  if (selection.kind === 'custom') {
    return 'custom';
  }
  const current = currentMonthOf(now);
  if (selection.year === current.year && selection.month === current.month) {
    return 'thisMonth';
  }
  const previous = previousMonth(current.year, current.month);
  if (selection.year === previous.year && selection.month === previous.month) {
    return 'lastMonth';
  }
  return null;
}
