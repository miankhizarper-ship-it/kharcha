import type {RecurringFrequency} from '@/database/models';
import {atNoon} from '@/utils/date';

/**
 * Pure recurrence date math.
 *
 * Occurrence timestamps are LOCAL NOON epoch millis (the same DST-safe
 * convention record dates use — see `atNoon`). All arithmetic works on
 * local calendar components (Y/M/D) via `Date` setters, never raw
 * millisecond addition, so DST transitions and month lengths stay exact.
 *
 * Documented month-end rule (spec §4): the next occurrence advances FROM
 * THE PREVIOUS OCCURRENCE and clamps to the last valid day of the target
 * month. Jan 31 -> Feb 28, then Feb 28 -> Mar 28. The anchor drifts to the
 * clamped day — deterministic, never unpredictable.
 */

export interface DayComponents {
  /** Full year (e.g. 2026). */
  year: number;
  /** 1-based month (1 = January). */
  month: number;
  /** Day of month (1-based). */
  day: number;
}

/** Local calendar components of the day containing `ms`. */
export function dayComponents(ms: number): DayComponents {
  const date = new Date(ms);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/** Local-noon epoch millis for a (year, 1-based month, day) calendar day. */
export function noonOf(year: number, month: number, day: number): number {
  // JS Date normalizes out-of-range components (day 35 -> next month), which
  // keeps +1/+7-day arithmetic exact across month and year boundaries.
  return atNoon(year, month - 1, day);
}

/** Number of days in a month (1-based month), leap-year aware. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(year, month, 0).getDate();
}

/** True when both timestamps fall on the same LOCAL calendar day. */
export function isSameDay(a: number, b: number): boolean {
  const da = dayComponents(a);
  const db = dayComponents(b);
  return da.year === db.year && da.month === db.month && da.day === db.day;
}

/**
 * Calendar-day comparison: true when `a` is on the same day as `b` or
 * earlier. Never compares raw millis, so a noon occurrence and a midnight
 * "now" on the same day compare equal.
 */
export function isSameOrBeforeDay(a: number, b: number): boolean {
  if (isSameDay(a, b)) {
    return true;
  }
  return a < b;
}

/**
 * The occurrence strictly following `fromMs`.
 *
 * - daily: next calendar day
 * - weekly: same weekday, 7 calendar days later
 * - monthly: same day-of-month in the next month, clamped to that month's
 *   last day (documented month-end rule above)
 */
export function nextOccurrence(
  fromMs: number,
  frequency: RecurringFrequency,
): number {
  const {year, month, day} = dayComponents(fromMs);

  switch (frequency) {
    case 'daily':
      return noonOf(year, month, day + 1);
    case 'weekly':
      return noonOf(year, month, day + 7);
    case 'monthly': {
      const target =
        month === 12 ? {year: year + 1, month: 1} : {year, month: month + 1};
      const clampedDay = Math.min(day, daysInMonth(target.year, target.month));
      return noonOf(target.year, target.month, clampedDay);
    }
  }
}

/**
 * The first occurrence STRICTLY AFTER today's calendar day.
 *
 * Used when RESUMING a paused rule (spec §10): resuming must not dump a
 * backlog of missed occurrences on the user, so every occurrence up to and
 * including today is skipped and generation restarts at the next one.
 *
 * A next occurrence already in the future is returned unchanged.
 */
export function firstOccurrenceAfter(
  nextOccurrenceAt: number,
  frequency: RecurringFrequency,
  nowMs: number,
): number {
  let next = nextOccurrenceAt;
  // Each step advances by at least one calendar day, so this terminates.
  while (isSameOrBeforeDay(next, nowMs)) {
    next = nextOccurrence(next, frequency);
  }
  return next;
}

/**
 * True when the rule is DUE: its next occurrence's calendar day is today or
 * earlier (spec §18 — never generate for FUTURE occurrences).
 */
export function isDue(nextOccurrenceAt: number, nowMs: number): boolean {
  return isSameOrBeforeDay(nextOccurrenceAt, nowMs);
}

/**
 * True when `occurrenceMs` is on or before the inclusive end date's
 * calendar day (spec §19 — generate up to AND INCLUDING the end date).
 * A null end date never bounds anything.
 */
export function isWithinEnd(
  occurrenceMs: number,
  endMs: number | null,
): boolean {
  return endMs === null || isSameOrBeforeDay(occurrenceMs, endMs);
}
