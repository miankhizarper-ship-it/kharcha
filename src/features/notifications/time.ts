import type {ReminderTime} from './types';

/**
 * Pure LOCAL-timezone scheduling math for notifications.
 *
 * Convention (mirrors `src/utils/date.ts` and `src/features/recurring/date.ts`):
 * all arithmetic works on local calendar components via `Date` setters —
 * NEVER raw millisecond addition — so month lengths, leap years and DST
 * shifts stay exact. Repeating daily/monthly schedules are ultimately
 * re-resolved by the OS in the device timezone; these helpers exist for
 * one-shot triggers, tests and "is it in the future?" decisions.
 */

export interface LocalComponents {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

/** Local calendar components of the moment `ms`. */
export function localComponents(ms: number): LocalComponents {
  const date = new Date(ms);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/** Local epoch millis for (year, 1-based month, day) at the given time. */
export function atTime(
  year: number,
  month: number,
  day: number,
  time: ReminderTime,
): number {
  // JS Date normalizes out-of-range components (day 0 → last day of the
  // previous month), which keeps the "day before" math boundary-safe.
  return new Date(
    year,
    month - 1,
    day,
    time.hour,
    time.minute,
    0,
    0,
  ).getTime();
}

/** The next local moment matching `time` strictly after `fromMs`. */
export function nextDailyTriggerAt(time: ReminderTime, fromMs: number): number {
  const {year, month, day} = localComponents(fromMs);
  const todayAtTime = atTime(year, month, day, time);
  return todayAtTime > fromMs ? todayAtTime : atTime(year, month, day + 1, time);
}

/**
 * The next local occurrence of "day-of-month `day` at `time`" strictly
 * after `fromMs`. Day values beyond a month's length naturally clamp
 * through Date normalization (spec only schedules day 1, but the helper
 * stays total for future callers).
 */
export function nextMonthlyTriggerAt(
  day: number,
  time: ReminderTime,
  fromMs: number,
): number {
  const {year, month} = localComponents(fromMs);
  const candidate = atTime(year, month, day, time);
  if (candidate > fromMs) {
    return candidate;
  }
  const next =
    month === 12 ? {year: year + 1, month: 1} : {year, month: month + 1};
  return atTime(next.year, next.month, day, time);
}

/**
 * The reminder moment for a recurring rule: LOCAL `time` on the calendar
 * day BEFORE `nextOccurrenceAt` (the rule's due day). Returns null when
 * that moment is already in the past — this cycle is simply not scheduled;
 * the rule's NEXT occurrence is picked up by the next sync.
 */
export function recurringReminderAt(
  nextOccurrenceAt: number,
  time: ReminderTime,
  nowMs: number,
): number | null {
  const due = localComponents(nextOccurrenceAt);
  const reminderAt = atTime(due.year, due.month, due.day - 1, time);
  return reminderAt > nowMs ? reminderAt : null;
}

/** 'YYYY-MM' period key (local clock) — the budget-alert latch period. */
export function periodKeyFor(ms: number): string {
  const {year, month} = localComponents(ms);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "8:00 PM" / "12:45 AM" — 12-hour label for the settings UI. */
export function formatTimeLabel(time: ReminderTime): string {
  const period = time.hour >= 12 ? 'PM' : 'AM';
  const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;
  const minutes = String(time.minute).padStart(2, '0');
  return `${hour12}:${minutes} ${period}`;
}

/** Validates user-picked hour/minute coming from the time picker. */
export function isValidReminderTime(time: unknown): time is ReminderTime {
  if (typeof time !== 'object' || time === null) {
    return false;
  }
  const candidate = time as Record<string, unknown>;
  return (
    typeof candidate.hour === 'number' &&
    Number.isInteger(candidate.hour) &&
    candidate.hour >= 0 &&
    candidate.hour <= 23 &&
    typeof candidate.minute === 'number' &&
    Number.isInteger(candidate.minute) &&
    candidate.minute >= 0 &&
    candidate.minute <= 59
  );
}
