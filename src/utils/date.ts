/**
 * Local-timezone date helpers.
 *
 * Record dates are stored as epoch milliseconds (see `src/database/models.ts`).
 * Day/month boundaries must follow the user's device timezone, so boundaries
 * are derived with `Date` setters instead of UTC arithmetic.
 */

/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local 23:59:59.999 of the day containing `ms`. */
export function endOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** Local midnight on the 1st of the month containing `ms`. */
export function startOfMonth(ms: number): number {
  const date = new Date(ms);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local end (last millisecond) of the month containing `ms`. */
export function endOfMonth(ms: number): number {
  const date = new Date(ms);
  // Day 0 of the next month is the last day of this month.
  date.setMonth(date.getMonth() + 1, 0);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** Local noon of the given day — safe from DST edge cases for storage. */
export function atNoon(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).getTime();
}

/** Inclusive local epoch-millis window of the 1-based calendar month. */
export interface MonthBounds {
  /** Local midnight on the 1st. */
  fromDate: number;
  /** Local 23:59:59.999 on the last day of the month. */
  toDate: number;
}

/** Inclusive local epoch-millis window of one calendar week. */
export interface WeekBounds {
  /** Local midnight on the Monday. */
  fromDate: number;
  /** Local 23:59:59.999 on the Sunday. */
  toDate: number;
}

/**
 * Local-time bounds for a (year, month) pair, 1-based month.
 *
 * Composes the existing boundary helpers (`atNoon` → `startOfMonth` /
 * `endOfMonth`) so every feature derives month windows through one code
 * path — including DST-safe construction and February/leap-year handling
 * delegated to the runtime's calendar.
 */
export function monthBounds(year: number, month: number): MonthBounds {
  // Noon on the 1st keeps the reference point away from DST shifts; the
  // boundary helpers then clamp to the actual calendar edges.
  const reference = atNoon(year, month - 1, 1);
  return {
    fromDate: startOfMonth(reference),
    toDate: endOfMonth(reference),
  };
}

/** Adjacent (year, month) pair, 1-based month, rolling across years. */
export function previousMonth(
  year: number,
  month: number,
): {
  year: number;
  month: number;
} {
  return month === 1 ? {year: year - 1, month: 12} : {year, month: month - 1};
}

/**
 * Local-time window of the ISO week (Monday–Sunday) containing `ms`.
 *
 * Steps across days with calendar arithmetic (`setDate`), never raw
 * `DAY_MS` addition, so weeks that contain a DST transition still start at
 * true local midnight on Monday and end at the real end of Sunday.
 */
export function weekBounds(ms: number): WeekBounds {
  const reference = new Date(ms);
  // getDay(): 0 = Sunday … 6 = Saturday → shift so Monday is 0.
  const daysSinceMonday = (reference.getDay() + 6) % 7;

  const monday = new Date(reference);
  monday.setDate(monday.getDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  return {
    fromDate: startOfDay(monday.getTime()),
    toDate: endOfDay(sunday.getTime()),
  };
}

/** Adjacent (year, month) pair, 1-based month, rolling across years. */
export function nextMonth(
  year: number,
  month: number,
): {
  year: number;
  month: number;
} {
  return month === 12 ? {year: year + 1, month: 1} : {year, month: month + 1};
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** Time-of-day bucket for the dashboard greeting. */
export function greetingFor(ms: number): DayPeriod {
  const hour = new Date(ms).getHours();
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

/** Compact human date, e.g. "Sep 7, 2026". */
export function formatShortDate(ms: number, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(ms);
}

/** Human month label, e.g. "September 2026". */
export function formatMonthLabel(
  year: number,
  month: number,
  locale = 'en-US',
): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(atNoon(year, month - 1, 1));
}
