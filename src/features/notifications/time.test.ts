/**
 * @jest-environment node
 */
import {
  formatTimeLabel,
  nextDailyTriggerAt,
  nextMonthlyTriggerAt,
  periodKeyFor,
  recurringReminderAt,
} from './time';

/**
 * All expectations are built with LOCAL Date constructors, so the suite is
 * timezone-independent by construction (spec §10).
 */

describe('nextDailyTriggerAt', () => {
  it('returns today when the time is still ahead', () => {
    const now = new Date(2026, 0, 15, 10, 0).getTime();
    expect(nextDailyTriggerAt({hour: 20, minute: 0}, now)).toBe(
      new Date(2026, 0, 15, 20, 0).getTime(),
    );
  });

  it('rolls to tomorrow when today\u2019s slot has passed', () => {
    const now = new Date(2026, 0, 15, 20, 1).getTime();
    expect(nextDailyTriggerAt({hour: 20, minute: 0}, now)).toBe(
      new Date(2026, 0, 16, 20, 0).getTime(),
    );
  });

  it('never fires in the past on exact equality', () => {
    const now = new Date(2026, 0, 15, 20, 0).getTime();
    expect(nextDailyTriggerAt({hour: 20, minute: 0}, now)).toBe(
      new Date(2026, 0, 16, 20, 0).getTime(),
    );
  });

  it('crosses month and year boundaries via calendar components', () => {
    const now = new Date(2026, 11, 31, 21, 0).getTime();
    expect(nextDailyTriggerAt({hour: 8, minute: 30}, now)).toBe(
      new Date(2027, 0, 1, 8, 30).getTime(),
    );
  });
});

describe('nextMonthlyTriggerAt', () => {
  it('returns this month when the slot is ahead', () => {
    const now = new Date(2026, 0, 1, 10, 0).getTime();
    expect(nextMonthlyTriggerAt(1, {hour: 19, minute: 0}, now)).toBe(
      new Date(2026, 0, 1, 19, 0).getTime(),
    );
  });

  it('advances to next month when the slot passed', () => {
    const now = new Date(2026, 0, 2, 0, 0).getTime();
    expect(nextMonthlyTriggerAt(1, {hour: 19, minute: 0}, now)).toBe(
      new Date(2026, 1, 1, 19, 0).getTime(),
    );
  });

  it('wraps December into January of the next year', () => {
    const now = new Date(2026, 11, 5, 0, 0).getTime();
    expect(nextMonthlyTriggerAt(1, {hour: 19, minute: 0}, now)).toBe(
      new Date(2027, 0, 1, 19, 0).getTime(),
    );
  });
});

describe('recurringReminderAt (day before the due date)', () => {
  const REMINDER = {hour: 18, minute: 0};

  it('fires the evening before a mid-month due date', () => {
    const due = new Date(2026, 2, 15, 12, 0).getTime();
    const now = new Date(2026, 2, 10, 9, 0).getTime();
    expect(recurringReminderAt(due, REMINDER, now)).toBe(
      new Date(2026, 2, 14, 18, 0).getTime(),
    );
  });

  it('handles the month boundary: due on the 1st reminders on the last day of the previous month', () => {
    const due = new Date(2026, 2, 1, 12, 0).getTime();
    const now = new Date(2026, 1, 20, 9, 0).getTime();
    expect(recurringReminderAt(due, REMINDER, now)).toBe(
      new Date(2026, 1, 28, 18, 0).getTime(), // 2026 is not a leap year
    );
  });

  it('handles month-end rules: due Jan 31 reminders Jan 30', () => {
    const due = new Date(2026, 0, 31, 12, 0).getTime();
    const now = new Date(2026, 0, 5, 9, 0).getTime();
    expect(recurringReminderAt(due, REMINDER, now)).toBe(
      new Date(2026, 0, 30, 18, 0).getTime(),
    );
  });

  it('handles leap years: due Feb 29 2028 reminders Feb 28', () => {
    const due = new Date(2028, 1, 29, 12, 0).getTime();
    const now = new Date(2028, 0, 10, 9, 0).getTime();
    expect(recurringReminderAt(due, REMINDER, now)).toBe(
      new Date(2028, 1, 28, 18, 0).getTime(),
    );
  });

  it('returns null when the reminder slot already passed (due is tomorrow)', () => {
    const due = new Date(2026, 2, 15, 12, 0).getTime();
    const now = new Date(2026, 2, 14, 19, 0).getTime(); // after 18:00 slot
    expect(recurringReminderAt(due, REMINDER, now)).toBeNull();
  });
});

describe('periodKeyFor', () => {
  it('formats YYYY-MM zero-padded in local time', () => {
    expect(periodKeyFor(new Date(2026, 0, 15).getTime())).toBe('2026-01');
    expect(periodKeyFor(new Date(2026, 11, 31, 23, 59).getTime())).toBe(
      '2026-12',
    );
  });
});

describe('formatTimeLabel', () => {
  it('renders the settings-UI 12-hour labels', () => {
    expect(formatTimeLabel({hour: 20, minute: 0})).toBe('8:00 PM');
    expect(formatTimeLabel({hour: 8, minute: 0})).toBe('8:00 AM');
    expect(formatTimeLabel({hour: 0, minute: 45})).toBe('12:45 AM');
    expect(formatTimeLabel({hour: 12, minute: 0})).toBe('12:00 PM');
  });
});
