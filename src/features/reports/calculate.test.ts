/**
 * @jest-environment node
 */
import {
  buildDailySeries,
  computeAverageDailySpend,
  computeBalance,
  computeCategoryBreakdown,
  computePercentChange,
  computeTopCategory,
  findHighestSpendingDay,
} from './calculate';
import {startOfDay} from '@/utils/date';
import type {CategorySlice, DailySpendingPoint} from './types';

function at(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0).getTime();
}

describe('computeBalance', () => {
  it('is income minus expenses', () => {
    expect(computeBalance(3_000_000, 1_845_000)).toBe(1_155_000);
  });

  it('goes negative when spending outweighs income', () => {
    expect(computeBalance(1_000, 2_500)).toBe(-1_500);
  });
});

describe('computeAverageDailySpend', () => {
  it('divides total expenses by the calendar day count', () => {
    // 18,450.00 / 30 days = 615.00 (minor units).
    expect(computeAverageDailySpend(1_845_000, 30)).toBe(61_500);
  });

  it('rounds to whole minor units instead of producing fractions', () => {
    expect(computeAverageDailySpend(1_001, 3)).toBe(334); // 333.67 → 334
  });

  it('is 0 for a period with zero expenses (never NaN)', () => {
    expect(computeAverageDailySpend(0, 30)).toBe(0);
  });

  it('is 0 for a degenerate zero-day window (never divides by zero)', () => {
    expect(computeAverageDailySpend(5_000, 0)).toBe(0);
  });
});

describe('computeCategoryBreakdown', () => {
  const rows = [
    {categoryId: 1, name: 'Food', icon: 'restaurant', total: 820_000},
    {categoryId: 2, name: 'Hostel', icon: 'home', total: 400_000},
    {categoryId: 3, name: 'Transport', icon: 'bus', total: 215_000},
    {categoryId: 4, name: 'Study', icon: 'school', total: 0},
  ];

  it('computes each category percent of the period total', () => {
    const slices = computeCategoryBreakdown(rows, 1_435_000);
    expect(slices).toEqual([
      expect.objectContaining({name: 'Food', percent: 57.1}),
      expect.objectContaining({name: 'Hostel', percent: 27.9}),
      expect.objectContaining({name: 'Transport', percent: 15}),
    ]);
  });

  it('drops zero-spending categories', () => {
    const slices = computeCategoryBreakdown(rows, 1_435_000);
    expect(slices.map(slice => slice.name)).not.toContain('Study');
  });

  it('sorts largest first with stable id tie-breaking', () => {
    const tied = [
      {categoryId: 7, name: 'A', icon: 'tag', total: 100},
      {categoryId: 3, name: 'B', icon: 'tag', total: 100},
      {categoryId: 9, name: 'C', icon: 'tag', total: 200},
    ];
    const slices = computeCategoryBreakdown(tied, 400);
    expect(slices.map(slice => slice.categoryId)).toEqual([9, 3, 7]);
  });

  it('is empty when nothing was spent in the period', () => {
    expect(computeCategoryBreakdown(rows, 0)).toEqual([]);
  });
});

describe('computeTopCategory', () => {
  it('picks the largest slice', () => {
    const slices = computeCategoryBreakdown(
      [
        {categoryId: 1, name: 'Food', icon: 'restaurant', total: 820_000},
        {categoryId: 2, name: 'Hostel', icon: 'home', total: 400_000},
      ],
      1_220_000,
    );
    expect(computeTopCategory(slices)?.name).toBe('Food');
  });

  it('is null for an empty breakdown', () => {
    expect(computeTopCategory([])).toBeNull();
  });
});

describe('findHighestSpendingDay', () => {
  const series: DailySpendingPoint[] = [
    {date: at(2026, 9, 1), total: 45_000},
    {date: at(2026, 9, 2), total: 145_000},
    {date: at(2026, 9, 3), total: 0},
    {date: at(2026, 9, 4), total: 90_000},
  ];

  it('returns the day with the most spending', () => {
    expect(findHighestSpendingDay(series)).toEqual({
      date: at(2026, 9, 2),
      total: 145_000,
    });
  });

  it('resolves ties to the earliest day', () => {
    const tied: DailySpendingPoint[] = [
      {date: at(2026, 9, 1), total: 50_000},
      {date: at(2026, 9, 2), total: 50_000},
    ];
    expect(findHighestSpendingDay(tied)?.date).toBe(at(2026, 9, 1));
  });

  it('is null when every day is a zero-spend day', () => {
    const zeros: DailySpendingPoint[] = [
      {date: at(2026, 9, 1), total: 0},
      {date: at(2026, 9, 2), total: 0},
    ];
    expect(findHighestSpendingDay(zeros)).toBeNull();
  });

  it('is null for an empty series', () => {
    expect(findHighestSpendingDay([])).toBeNull();
  });
});

describe('computePercentChange', () => {
  it('computes the percent increase (spec example: 21.4%)', () => {
    const comparison = computePercentChange(1_845_000, 1_520_000);
    expect(comparison.direction).toBe('up');
    expect(comparison.percentChange).toBe(21.4);
    expect(comparison.difference).toBe(325_000);
  });

  it('computes the percent decrease', () => {
    const comparison = computePercentChange(1_200_000, 1_500_000);
    expect(comparison.direction).toBe('down');
    expect(comparison.percentChange).toBe(-20);
  });

  it('reports flat when totals match', () => {
    const comparison = computePercentChange(900, 900);
    expect(comparison.direction).toBe('flat');
    expect(comparison.percentChange).toBe(0);
  });

  it('returns a null percent (not Infinity) when the previous period is 0', () => {
    const comparison = computePercentChange(1_845_000, 0);
    expect(comparison.percentChange).toBeNull();
    expect(comparison.direction).toBe('up');
    expect(Number.isFinite(comparison.difference)).toBe(true);
  });

  it('reports flat when both periods are zero', () => {
    const comparison = computePercentChange(0, 0);
    expect(comparison.percentChange).toBeNull();
    expect(comparison.direction).toBe('flat');
  });

  it('reports -100% when spending stops completely', () => {
    const comparison = computePercentChange(0, 750_000);
    expect(comparison.percentChange).toBe(-100);
    expect(comparison.direction).toBe('down');
  });
});

describe('buildDailySeries', () => {
  it('fills every calendar day of the period, zero days included', () => {
    const sums = new Map<number, number>([
      [0, 45_000], // Sep 1
      [2, 25_000], // Sep 3
    ]);
    const series = buildDailySeries(at(2026, 9, 1), 5, sums);
    expect(series).toHaveLength(5);
    expect(series.map(point => point.total)).toEqual([45_000, 0, 25_000, 0, 0]);
  });

  it('produces chronologically ordered local midnights', () => {
    const series = buildDailySeries(at(2026, 9, 28), 5, new Map());
    expect(series[0].date).toBe(startOfDay(at(2026, 9, 28)));
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].date).toBeGreaterThan(series[i - 1].date);
      expect(series[i].date).toBe(startOfDay(series[i].date));
    }
    // Sep 28 + 4 days = Oct 2 (month boundary handled by the calendar).
    expect(series[4].date).toBe(startOfDay(at(2026, 10, 2)));
  });

  it('covers a leap-year February completely', () => {
    const series = buildDailySeries(at(2024, 2, 1), 29, new Map());
    expect(series).toHaveLength(29);
    expect(series[28].date).toBe(startOfDay(at(2024, 2, 29)));
  });

  it('handles a single-day period', () => {
    const series = buildDailySeries(at(2026, 9, 7), 1, new Map([[0, 12_000]]));
    expect(series).toEqual([{date: startOfDay(at(2026, 9, 7)), total: 12_000}]);
  });
});

describe('breakdown percent sanity', () => {
  it('keeps percentages finite and roughly summing to 100', () => {
    const slices: CategorySlice[] = computeCategoryBreakdown(
      [
        {categoryId: 1, name: 'Food', icon: 'restaurant', total: 1},
        {categoryId: 2, name: 'Bus', icon: 'bus', total: 2},
        {categoryId: 3, name: 'Home', icon: 'home', total: 3},
      ],
      6,
    );
    const sum = slices.reduce((acc, slice) => acc + slice.percent, 0);
    expect(sum).toBeGreaterThanOrEqual(99.9);
    expect(sum).toBeLessThanOrEqual(100.1);
    slices.forEach(slice => expect(Number.isFinite(slice.percent)).toBe(true));
  });
});
