/**
 * @jest-environment node
 */
import {
  activePresetOf,
  currentMonthOf,
  formatDateRangeLabel,
  formatReportSelectionLabel,
  normalizeCustomRange,
  resolveReportPeriod,
} from './period';
import {monthBounds, startOfDay, endOfDay} from '@/utils/date';

// Fixed "now": Wednesday, September 9 2026, 15:30 local — timezone-safe
// because both the input and the expectations use the process clock.
const NOW = new Date(2026, 8, 9, 15, 30).getTime();

function at(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0).getTime();
}

describe('resolveReportPeriod: thisWeek', () => {
  it('covers Monday through Sunday of the current week', () => {
    const period = resolveReportPeriod({kind: 'thisWeek'}, NOW);
    expect(period.fromDate).toBe(
      new Date(2026, 8, 7, 0, 0, 0, 0).getTime(), // Monday Sep 7
    );
    expect(period.toDate).toBe(
      new Date(2026, 8, 13, 23, 59, 59, 999).getTime(), // Sunday Sep 13
    );
    expect(period.dayCount).toBe(7);
  });
});

describe('resolveReportPeriod: month', () => {
  it('covers the whole month for any day inside it', () => {
    const period = resolveReportPeriod(
      {kind: 'month', year: 2026, month: 9},
      NOW,
    );
    expect(period.fromDate).toBe(monthBounds(2026, 9).fromDate);
    expect(period.toDate).toBe(monthBounds(2026, 9).toDate);
    expect(period.dayCount).toBe(30);
  });

  it('handles leap-year February (29 days)', () => {
    const period = resolveReportPeriod(
      {kind: 'month', year: 2024, month: 2},
      NOW,
    );
    expect(period.dayCount).toBe(29);
    expect(period.toDate).toBe(
      new Date(2024, 1, 29, 23, 59, 59, 999).getTime(),
    );
  });

  it('handles non-leap February (28 days)', () => {
    const period = resolveReportPeriod(
      {kind: 'month', year: 2025, month: 2},
      NOW,
    );
    expect(period.dayCount).toBe(28);
  });

  it('handles 31-day months', () => {
    const period = resolveReportPeriod(
      {kind: 'month', year: 2026, month: 1},
      NOW,
    );
    expect(period.dayCount).toBe(31);
  });
});

describe('resolveReportPeriod: custom', () => {
  it('covers both endpoint days inclusively', () => {
    const period = resolveReportPeriod(
      {kind: 'custom', fromDate: at(2026, 9, 1), toDate: at(2026, 9, 14)},
      NOW,
    );
    expect(period.fromDate).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
    expect(period.toDate).toBe(
      new Date(2026, 8, 14, 23, 59, 59, 999).getTime(),
    );
    expect(period.dayCount).toBe(14);
  });

  it('allows a single-day range (same start and end)', () => {
    const period = resolveReportPeriod(
      {kind: 'custom', fromDate: at(2026, 9, 14), toDate: at(2026, 9, 14)},
      NOW,
    );
    expect(period.dayCount).toBe(1);
    expect(period.fromDate).toBe(new Date(2026, 8, 14, 0, 0, 0, 0).getTime());
    expect(period.toDate).toBe(
      new Date(2026, 8, 14, 23, 59, 59, 999).getTime(),
    );
  });

  it('normalizes reversed ranges by swapping the endpoints', () => {
    const period = resolveReportPeriod(
      {kind: 'custom', fromDate: at(2026, 9, 14), toDate: at(2026, 9, 1)},
      NOW,
    );
    expect(period.fromDate).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
    expect(period.toDate).toBe(
      new Date(2026, 8, 14, 23, 59, 59, 999).getTime(),
    );
    expect(period.dayCount).toBe(14);
  });

  it('crosses month boundaries without leaking days', () => {
    const period = resolveReportPeriod(
      {kind: 'custom', fromDate: at(2026, 8, 30), toDate: at(2026, 9, 2)},
      NOW,
    );
    expect(period.dayCount).toBe(4);
  });

  it('crosses year boundaries', () => {
    const period = resolveReportPeriod(
      {kind: 'custom', fromDate: at(2026, 12, 30), toDate: at(2027, 1, 2)},
      NOW,
    );
    expect(period.dayCount).toBe(4);
    expect(period.toDate).toBe(new Date(2027, 0, 2, 23, 59, 59, 999).getTime());
  });

  it('handles leap-day inside a custom range', () => {
    const period = resolveReportPeriod(
      {kind: 'custom', fromDate: at(2024, 2, 28), toDate: at(2024, 3, 1)},
      NOW,
    );
    // Feb 28, Feb 29 (leap), Mar 1.
    expect(period.dayCount).toBe(3);
  });
});

describe('normalizeCustomRange', () => {
  it('widens timestamps to full local days', () => {
    const normalized = normalizeCustomRange(
      new Date(2026, 8, 7, 9, 15).getTime(),
      new Date(2026, 8, 9, 18, 45).getTime(),
    );
    expect(normalized.fromDate).toBe(
      startOfDay(new Date(2026, 8, 7).getTime()),
    );
    expect(normalized.toDate).toBe(endOfDay(new Date(2026, 8, 9).getTime()));
  });

  it('swaps reversed inputs', () => {
    const normalized = normalizeCustomRange(at(2026, 9, 10), at(2026, 9, 1));
    expect(normalized.fromDate).toBe(
      new Date(2026, 8, 1, 0, 0, 0, 0).getTime(),
    );
    expect(normalized.toDate).toBe(
      new Date(2026, 8, 10, 23, 59, 59, 999).getTime(),
    );
  });
});

describe('currentMonthOf', () => {
  it('extracts 1-based (year, month)', () => {
    expect(currentMonthOf(NOW)).toEqual({year: 2026, month: 9});
    expect(currentMonthOf(new Date(2026, 11, 31, 23).getTime())).toEqual({
      year: 2026,
      month: 12,
    });
  });
});

describe('activePresetOf', () => {
  it('matches the current month to thisMonth', () => {
    expect(activePresetOf({kind: 'month', year: 2026, month: 9}, NOW)).toBe(
      'thisMonth',
    );
  });

  it('matches the previous month to lastMonth', () => {
    expect(activePresetOf({kind: 'month', year: 2026, month: 8}, NOW)).toBe(
      'lastMonth',
    );
  });

  it('matches lastMonth across a year boundary', () => {
    const january = new Date(2027, 0, 15).getTime();
    expect(
      activePresetOf({kind: 'month', year: 2026, month: 12}, january),
    ).toBe('lastMonth');
  });

  it('highlights no chip for a navigated non-preset month', () => {
    expect(
      activePresetOf({kind: 'month', year: 2025, month: 3}, NOW),
    ).toBeNull();
  });

  it('passes through week and custom selections', () => {
    expect(activePresetOf({kind: 'thisWeek'}, NOW)).toBe('thisWeek');
    expect(
      activePresetOf(
        {kind: 'custom', fromDate: at(2026, 9, 1), toDate: at(2026, 9, 9)},
        NOW,
      ),
    ).toBe('custom');
  });
});

describe('labels', () => {
  it('formats month selections through the shared month label', () => {
    expect(
      formatReportSelectionLabel({kind: 'month', year: 2026, month: 9}, NOW),
    ).toBe('September 2026');
  });

  it('formats week selections as a day range', () => {
    expect(formatReportSelectionLabel({kind: 'thisWeek'}, NOW)).toBe(
      'Sep 7 – Sep 13, 2026',
    );
  });

  it('formats custom ranges within one year with a single year', () => {
    expect(formatReportSelectionLabel({kind: 'thisWeek'}, NOW)).toBe(
      'Sep 7 – Sep 13, 2026',
    );
    expect(formatDateRangeLabel(at(2026, 9, 1), at(2026, 9, 14))).toBe(
      'Sep 1 – Sep 14, 2026',
    );
  });

  it('repeats the year when a custom range crosses years', () => {
    expect(formatDateRangeLabel(at(2026, 12, 28), at(2027, 1, 3))).toBe(
      'Dec 28, 2026 – Jan 3, 2027',
    );
  });
});
