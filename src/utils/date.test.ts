/**
 * @jest-environment node
 */
import {
  atNoon,
  DAY_MS,
  endOfDay,
  endOfMonth,
  formatMonthLabel,
  formatShortDate,
  greetingFor,
  monthBounds,
  nextMonth,
  previousMonth,
  startOfDay,
  startOfMonth,
  weekBounds,
} from './date';

// Local-time dates make these tests timezone-independent: both the helpers
// and the expectations use the same clock the test process runs in.
const SEP_7_2026_15_45 = new Date(2026, 8, 7, 15, 45).getTime();

describe('day boundaries', () => {
  it('startOfDay is local midnight', () => {
    expect(startOfDay(SEP_7_2026_15_45)).toBe(
      new Date(2026, 8, 7, 0, 0, 0, 0).getTime(),
    );
  });

  it('endOfDay is the last millisecond of the day', () => {
    expect(endOfDay(SEP_7_2026_15_45)).toBe(
      new Date(2026, 8, 7, 23, 59, 59, 999).getTime(),
    );
  });

  it('a whole day fits between the boundaries', () => {
    expect(endOfDay(SEP_7_2026_15_45) - startOfDay(SEP_7_2026_15_45)).toBe(
      DAY_MS - 1,
    );
  });
});

describe('month boundaries', () => {
  it('startOfMonth is local midnight on the 1st', () => {
    expect(startOfMonth(SEP_7_2026_15_45)).toBe(
      new Date(2026, 8, 1, 0, 0, 0, 0).getTime(),
    );
  });

  it('endOfMonth lands on the last day (30-day month)', () => {
    expect(endOfMonth(SEP_7_2026_15_45)).toBe(
      new Date(2026, 8, 30, 23, 59, 59, 999).getTime(),
    );
  });

  it('handles leap-year February', () => {
    const leap = new Date(2024, 1, 10).getTime();
    expect(endOfMonth(leap)).toBe(
      new Date(2024, 1, 29, 23, 59, 59, 999).getTime(),
    );
  });

  it('handles non-leap February', () => {
    const nonLeap = new Date(2025, 1, 10).getTime();
    expect(endOfMonth(nonLeap)).toBe(
      new Date(2025, 1, 28, 23, 59, 59, 999).getTime(),
    );
  });
});

describe('atNoon', () => {
  it('creates local noon, safe from DST shifts', () => {
    expect(atNoon(2026, 8, 7)).toBe(
      new Date(2026, 8, 7, 12, 0, 0, 0).getTime(),
    );
  });
});

describe('greetingFor', () => {
  it.each([
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [23, 'evening'],
  ])('classifies hour %i as %s', (hour, expected) => {
    expect(greetingFor(new Date(2026, 8, 7, hour).getTime())).toBe(expected);
  });
});

describe('formatShortDate', () => {
  it('formats a compact human date', () => {
    expect(formatShortDate(SEP_7_2026_15_45)).toBe('Sep 7, 2026');
  });
});

describe('monthBounds', () => {
  it('covers the first to the last millisecond of the month', () => {
    const {fromDate, toDate} = monthBounds(2026, 9);
    expect(fromDate).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
    expect(toDate).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).getTime());
  });

  it('handles leap-year February (29 days)', () => {
    const {fromDate, toDate} = monthBounds(2024, 2);
    expect(fromDate).toBe(new Date(2024, 1, 1, 0, 0, 0, 0).getTime());
    expect(toDate).toBe(new Date(2024, 1, 29, 23, 59, 59, 999).getTime());
  });

  it('handles non-leap February (28 days)', () => {
    const {toDate} = monthBounds(2025, 2);
    expect(toDate).toBe(new Date(2025, 1, 28, 23, 59, 59, 999).getTime());
  });

  it('matches the ms-based helpers for the same month', () => {
    const {fromDate, toDate} = monthBounds(2026, 9);
    expect(fromDate).toBe(startOfMonth(SEP_7_2026_15_45));
    expect(toDate).toBe(endOfMonth(SEP_7_2026_15_45));
  });

  it('windows do not leak across month edges', () => {
    const september = monthBounds(2026, 9);
    const october = monthBounds(2026, 10);
    expect(september.toDate).toBeLessThan(october.fromDate);
  });
});

describe('previousMonth / nextMonth', () => {
  it('steps within the same year', () => {
    expect(previousMonth(2026, 9)).toEqual({year: 2026, month: 8});
    expect(nextMonth(2026, 9)).toEqual({year: 2026, month: 10});
  });

  it('roll across the year boundary', () => {
    expect(previousMonth(2026, 1)).toEqual({year: 2025, month: 12});
    expect(nextMonth(2026, 12)).toEqual({year: 2027, month: 1});
  });
});

describe('formatMonthLabel', () => {
  it('formats a human month name with year', () => {
    expect(formatMonthLabel(2026, 9)).toBe('September 2026');
    expect(formatMonthLabel(2026, 1)).toBe('January 2026');
  });
});

describe('weekBounds', () => {
  it('returns the Monday–Sunday window containing the timestamp', () => {
    // Sep 7 2026 is a Monday; Sep 9 is the Wednesday of that week.
    const {fromDate, toDate} = weekBounds(new Date(2026, 8, 9).getTime());
    expect(fromDate).toBe(new Date(2026, 8, 7, 0, 0, 0, 0).getTime());
    expect(toDate).toBe(new Date(2026, 8, 13, 23, 59, 59, 999).getTime());
  });

  it('maps Sunday to the week that started the Monday before', () => {
    // Sep 13 2026 is a Sunday — the END of the week that began Sep 7.
    const {fromDate} = weekBounds(new Date(2026, 8, 13, 20).getTime());
    expect(fromDate).toBe(new Date(2026, 8, 7, 0, 0, 0, 0).getTime());
  });

  it('windows do not leak across week edges', () => {
    const week = weekBounds(new Date(2026, 8, 9).getTime());
    const nextWeekStart = new Date(2026, 8, 14, 0, 0, 0, 0).getTime();
    expect(week.toDate).toBeLessThan(nextWeekStart);
  });

  it('crosses year boundaries (Jan 1 lands in the previous ISO week)', () => {
    // Jan 1 2026 is a Thursday → its week is Mon Dec 29 2025 – Sun Jan 4 2026.
    const {fromDate, toDate} = weekBounds(new Date(2026, 0, 1).getTime());
    expect(fromDate).toBe(new Date(2025, 11, 29, 0, 0, 0, 0).getTime());
    expect(toDate).toBe(new Date(2026, 0, 4, 23, 59, 59, 999).getTime());
  });

  it('spans exactly 7 calendar days from any day inside the week', () => {
    for (const day of [7, 9, 13]) {
      const {fromDate, toDate} = weekBounds(new Date(2026, 8, day).getTime());
      const calendarDays =
        Math.round((startOfDay(toDate) - startOfDay(fromDate)) / DAY_MS) + 1;
      expect(calendarDays).toBe(7);
    }
  });
});
