/**
 * @jest-environment node
 */
import {
  buildBucketedSeries,
  computeAverageTransaction,
  MAX_TREND_BARS,
  trendBucketDaysFor,
} from './calculate';
import {dayCountBetween, resolvePreviousPeriod} from './period';
import {monthBounds, weekBounds} from '@/utils/date';

/**
 * Fixed local timestamps keep every window deterministic regardless of the
 * timezone the test process runs in (mirrors service.test.ts).
 */
const SEP_1_2026 = new Date(2026, 8, 1, 12).getTime(); // local noon
const NOW = new Date(2026, 8, 7, 15, 30).getTime(); // Sep 7 2026, 15:30 local

describe('computeAverageTransaction', () => {
  it('divides the total by the transaction count and rounds to minor units', () => {
    expect(computeAverageTransaction(1_000_000, 3)).toBe(333_333);
  });

  it('is 0 when there are no transactions (never NaN)', () => {
    expect(computeAverageTransaction(0, 0)).toBe(0);
    expect(computeAverageTransaction(500, 0)).toBe(0);
  });

  it('is 0 for a zero total with rows (defensive)', () => {
    expect(computeAverageTransaction(0, 5)).toBe(0);
  });
});

describe('trendBucketDaysFor', () => {
  it('keeps short periods daily (null = daily bars)', () => {
    expect(trendBucketDaysFor(1)).toBeNull();
    expect(trendBucketDaysFor(7)).toBeNull();
    expect(trendBucketDaysFor(MAX_TREND_BARS)).toBeNull();
  });

  it('buckets long periods so at most MAX_TREND_BARS bars render', () => {
    expect(trendBucketDaysFor(MAX_TREND_BARS + 1)).toBe(2);
    expect(trendBucketDaysFor(90)).toBe(3);
    expect(trendBucketDaysFor(365)).toBe(12);
    expect(Math.ceil(365 / trendBucketDaysFor(365)!)).toBeLessThanOrEqual(
      MAX_TREND_BARS,
    );
  });
});

describe('buildBucketedSeries', () => {
  const dayTotals = (totals: number[]): Map<number, number> =>
    new Map(totals.map((total, index) => [index, total]));

  it('groups consecutive days and stamps buckets with their first day', () => {
    const series = buildBucketedSeries(
      SEP_1_2026,
      7,
      dayTotals([10, 20, 30, 0, 0, 50, 60]),
      3,
    );
    expect(series).toEqual([
      {date: new Date(2026, 8, 1).getTime(), total: 60}, // 10+20+30
      {date: new Date(2026, 8, 4).getTime(), total: 50}, // 0+0+50
      {date: new Date(2026, 8, 7).getTime(), total: 60}, // partial: 60
    ]);
  });

  it('keeps bucket sums equal to the day sums (no money lost)', () => {
    const dayCount = 40;
    const totals = dayTotals(
      Array.from({length: dayCount}, (_, i) => (i % 7) * 1_000),
    );
    const series = buildBucketedSeries(SEP_1_2026, dayCount, totals, 5);
    expect(series.reduce((sum, point) => sum + point.total, 0)).toBe(
      totals.size ? Array.from(totals.values()).reduce((a, b) => a + b, 0) : 0,
    );
  });

  it('handles empty periods and exact-multiple ranges', () => {
    expect(buildBucketedSeries(SEP_1_2026, 0, new Map(), 5)).toEqual([]);

    const exact = buildBucketedSeries(
      SEP_1_2026,
      6,
      dayTotals([1, 2, 3, 4, 5, 6]),
      3,
    );
    expect(exact).toHaveLength(2);
    expect(exact[1]).toEqual({
      date: new Date(2026, 8, 4).getTime(),
      total: 15,
    });
  });

  it('treats a bucket size below 1 as 1', () => {
    const series = buildBucketedSeries(SEP_1_2026, 3, dayTotals([5, 6, 7]), 0);
    expect(series).toHaveLength(3);
  });
});

describe('dayCountBetween', () => {
  it('counts inclusive calendar days for month windows', () => {
    const {fromDate, toDate} = monthBounds(2026, 9);
    expect(dayCountBetween(fromDate, toDate)).toBe(30); // September
  });

  it('handles leap-year February and single-day ranges', () => {
    const leap = monthBounds(2024, 2);
    expect(dayCountBetween(leap.fromDate, leap.toDate)).toBe(29);

    const single = monthBounds(2026, 9);
    expect(dayCountBetween(single.fromDate, single.fromDate)).toBe(1);
  });
});

describe('resolvePreviousPeriod', () => {
  it('uses the previous CALENDAR month for month selections', () => {
    const september = monthBounds(2026, 9);
    const previous = resolvePreviousPeriod(
      {kind: 'month', year: 2026, month: 9},
      {fromDate: september.fromDate, toDate: september.toDate, dayCount: 30},
    );

    expect(previous).toEqual({...monthBounds(2026, 8), dayCount: 31});
  });

  it('rolls across the year boundary (Jan → Dec)', () => {
    const january = monthBounds(2027, 1);
    const previous = resolvePreviousPeriod(
      {kind: 'month', year: 2027, month: 1},
      {fromDate: january.fromDate, toDate: january.toDate, dayCount: 31},
    );

    expect(previous).toEqual({...monthBounds(2026, 12), dayCount: 31});
  });

  it('gives week selections the window ending the day before', () => {
    const week = weekBounds(NOW); // Mon Sep 7 – Sun Sep 13, 2026
    const previous = resolvePreviousPeriod(
      {kind: 'thisWeek'},
      {...week, dayCount: 7},
    );

    expect(previous.dayCount).toBe(7);
    // Previous window = Mon Aug 31 – Sun Sep 6 (the 7 days before this week).
    expect(new Date(previous.fromDate).getDate()).toBe(31);
    expect(new Date(previous.fromDate).getMonth()).toBe(7); // August
    expect(new Date(previous.toDate).getDate()).toBe(6);
    expect(new Date(previous.toDate).getMonth()).toBe(8); // September
  });

  it('gives custom ranges an equal-length window immediately before', () => {
    // Custom Sep 10 – Sep 19 (10 days).
    const fromDate = new Date(2026, 8, 10).getTime();
    const toDate = new Date(2026, 8, 19, 23, 59, 59, 999).getTime();

    const previous = resolvePreviousPeriod(
      {kind: 'custom', fromDate, toDate},
      {fromDate, toDate, dayCount: 10},
    );

    expect(previous.dayCount).toBe(10);
    expect(new Date(previous.fromDate).getDate()).toBe(31); // Aug 31
    expect(new Date(previous.fromDate).getMonth()).toBe(7);
    expect(new Date(previous.toDate).getDate()).toBe(9); // Sep 9
  });

  it('keeps a one-day range mapped to the day before', () => {
    const day = new Date(2026, 2, 15, 12).getTime(); // Mar 15 2026
    const previous = resolvePreviousPeriod(
      {kind: 'custom', fromDate: day, toDate: day},
      {fromDate: day, toDate: day, dayCount: 1},
    );

    expect(previous.dayCount).toBe(1);
    expect(new Date(previous.fromDate).getDate()).toBe(14);
    expect(new Date(previous.toDate).getDate()).toBe(14);
  });
});
