/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {CategoryReportScopeError} from './errors';
import {monthBounds} from '@/utils/date';
import {createReportFeature} from './service';
import type {ReportFeature} from './service';
import type {ReportSelection} from './types';

/** Fixed local timestamps keep every window deterministic regardless of the
 * timezone the test process runs in (mirrors service.test.ts). */
function at(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0).getTime();
}

const SEPTEMBER: ReportSelection = {kind: 'month', year: 2026, month: 9};
const SEPTEMBER_BOUNDS = monthBounds(2026, 9);
const AUGUST_BOUNDS = monthBounds(2026, 8);

describe('ReportFeature.getCategoryReportDetail', () => {
  let service: DatabaseService;
  let feature: ReportFeature;

  beforeEach(async () => {
    service = await createTestService();
    feature = createReportFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  async function spend(
    categoryId: number,
    amountMinor: number,
    date: number,
    title = 'Detail test expense',
    paymentMethod: 'cash' | 'card' = 'cash',
  ): Promise<number> {
    const row = await service.expenses.create({
      amount: amountMinor,
      title,
      categoryId,
      date,
      paymentMethod,
    });
    return row.id;
  }

  async function earn(
    amountMinor: number,
    date: number,
    source = 'Salary',
  ): Promise<void> {
    await service.income.create({amount: amountMinor, source, date});
  }

  /* ------------------------------ expense scope ----------------------------- */

  it('computes total, count, average, largest and share for one category', async () => {
    const categories = await service.categories.list('expense');
    const food = categories.find(row => row.name === 'Food & Dining')!;
    const transport = categories.find(row => row.name === 'Transport')!;

    await spend(food.id, 300_000, at(2026, 9, 2), 'Groceries run');
    await spend(food.id, 120_000, at(2026, 9, 9), 'Snacks', 'card');
    await spend(food.id, 800_000, at(2026, 9, 14), 'Dinner party');
    await spend(transport.id, 999_999, at(2026, 9, 3), 'Taxi'); // other category
    await spend(food.id, 500_000, at(2026, 8, 20), 'August food'); // out of range
    await earn(2_000_000, at(2026, 9, 1)); // income never counts as expenses

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );

    expect(detail.name).toBe('Food & Dining');
    expect(detail.scope).toEqual({kind: 'expense', categoryId: food.id});
    expect(detail.total).toBe(1_220_000);
    expect(detail.transactionCount).toBe(3);
    expect(detail.averageTransaction).toBe(406_667); // round(1220000/3)
    expect(detail.percent).toBe(55); // 1220000 / 2219999, rounded to 1 decimal
    expect(detail.largestTransaction).toMatchObject({
      type: 'expense',
      title: 'Dinner party',
      amount: 800_000,
      categoryName: 'Food & Dining',
    });
    expect(detail.isActive).toBe(true);
    expect(detail.trend).toHaveLength(30);
  });

  it('breaks largest-transaction ties toward the OLDEST row', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 500_000, at(2026, 9, 10), 'Tie later');
    await spend(food.id, 500_000, at(2026, 9, 20), 'Tie earlier id is older');

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.largestTransaction?.title).toBe('Tie later');
  });

  it('throws a typed, user-explainable error when the category is gone', async () => {
    await expect(
      feature.getCategoryReportDetail(
        {kind: 'expense', categoryId: 987654},
        SEPTEMBER,
        SEPTEMBER_BOUNDS,
      ),
    ).rejects.toBeInstanceOf(CategoryReportScopeError);
  });

  it('keeps archived categories resolvable for history and marks them', async () => {
    const archived = await service.categories.create({
      name: 'Old Hobby',
      icon: 'game-controller',
      type: 'expense',
    });
    await service.categories.update(archived.id, {isActive: false});
    await spend(archived.id, 100_000, at(2026, 9, 5), 'Archived spend');

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: archived.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.isActive).toBe(false);
    expect(detail.total).toBe(100_000);
    expect(detail.transactionCount).toBe(1);
  });

  /* ------------------------------- income scope ----------------------------- */

  it('supports income sources with the same screen contract', async () => {
    await earn(2_000_000, at(2026, 9, 1), 'Salary');
    await earn(500_000, at(2026, 9, 15), 'Salary');
    await earn(300_000, at(2026, 9, 3), 'salary'); // different exact source
    await earn(400_000, at(2026, 8, 10), 'Salary'); // out of range

    const detail = await feature.getCategoryReportDetail(
      {kind: 'income', source: 'Salary'},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );

    expect(detail.name).toBe('Salary');
    expect(detail.scope).toEqual({kind: 'income', source: 'Salary'});
    expect(detail.total).toBe(2_500_000);
    expect(detail.transactionCount).toBe(2);
    expect(detail.averageTransaction).toBe(1_250_000);
    expect(detail.percent).toBe(89.3); // 2500000 / 2800000 period income
    expect(detail.largestTransaction).toMatchObject({
      type: 'income',
      title: 'Salary',
      amount: 2_000_000,
      categoryName: null,
    });
    // Seeded 'Salary' income category provides the icon.
    expect(detail.icon).toBe('briefcase');
    expect(detail.isActive).toBeNull();
    // Income has no budget concept at all.
    expect(detail.budgetStatus).toBe('notMonthly');
    expect(detail.budget).toBeNull();
  });

  it('falls back to the cash icon for sources without a matching category', async () => {
    await earn(100_000, at(2026, 9, 2), 'Mystery money');

    const detail = await feature.getCategoryReportDetail(
      {kind: 'income', source: 'Mystery money'},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.icon).toBe('cash');
  });

  /* --------------------------------- trend ---------------------------------- */

  it('zero-fills the daily trend across the full period', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 45_000, at(2026, 9, 1));
    await spend(food.id, 25_000, at(2026, 9, 1));
    await spend(food.id, 90_000, at(2026, 9, 3));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );

    expect(detail.trend).toHaveLength(30);
    expect(detail.trendBucketDays).toBeNull(); // daily
    expect(detail.trend[0]).toEqual({
      date: new Date(2026, 8, 1).getTime(),
      total: 70_000,
    });
    expect(detail.trend[1]).toEqual({
      date: new Date(2026, 8, 2).getTime(),
      total: 0,
    });
    expect(detail.trend[2]).toEqual({
      date: new Date(2026, 8, 3).getTime(),
      total: 90_000,
    });
    expect(detail.trend[29]).toEqual({
      date: new Date(2026, 8, 30).getTime(),
      total: 0,
    });
  });

  it('handles leap-year February with 29 trend days', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 10_000, at(2024, 2, 29));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      {kind: 'month', year: 2024, month: 2},
      monthBounds(2024, 2),
    );
    expect(detail.trend).toHaveLength(29);
    expect(detail.trend[28]).toEqual({
      date: new Date(2024, 1, 29).getTime(),
      total: 10_000,
    });
  });

  it('keeps one-day custom ranges to a single trend point', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 50_000, at(2026, 9, 14));
    await spend(food.id, 60_000, at(2026, 9, 15)); // excluded

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      {kind: 'custom', fromDate: at(2026, 9, 14), toDate: at(2026, 9, 14)},
      {
        fromDate: new Date(2026, 8, 14).getTime(),
        toDate: new Date(2026, 8, 14, 23, 59, 59, 999).getTime(),
      },
    );
    expect(detail.trend).toHaveLength(1);
    expect(detail.trend[0]).toEqual({
      date: new Date(2026, 8, 14).getTime(),
      total: 50_000,
    });
  });

  it('crosses month/year boundaries inside custom ranges', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 12, 31));
    await spend(food.id, 200_000, at(2027, 1, 1));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      {
        kind: 'custom',
        fromDate: at(2026, 12, 31),
        toDate: at(2027, 1, 1),
      },
      {
        fromDate: new Date(2026, 11, 31).getTime(),
        toDate: new Date(2027, 0, 1, 23, 59, 59, 999).getTime(),
      },
    );
    expect(detail.total).toBe(300_000);
    expect(detail.trend).toHaveLength(2);
    expect(detail.trend[0]).toEqual({
      date: new Date(2026, 11, 31).getTime(),
      total: 100_000,
    });
    expect(detail.trend[1]).toEqual({
      date: new Date(2027, 0, 1).getTime(),
      total: 200_000,
    });
  });

  it('buckets long custom ranges so at most 31 bars render', async () => {
    const food = (await service.categories.list('expense'))[0];
    // 90-day custom window Sep 1 – Nov 29 2026 with sparse spending.
    await spend(food.id, 300_000, at(2026, 9, 2));
    await spend(food.id, 400_000, at(2026, 11, 20));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      {
        kind: 'custom',
        fromDate: at(2026, 9, 1),
        toDate: at(2026, 11, 29),
      },
      {
        fromDate: new Date(2026, 8, 1).getTime(),
        toDate: new Date(2026, 10, 29, 23, 59, 59, 999).getTime(),
      },
    );

    expect(detail.period.dayCount).toBe(90);
    expect(detail.trendBucketDays).toBe(3); // ceil(90 / 31)
    expect(detail.trend.length).toBeLessThanOrEqual(31);
    // Bucket sums stay exact — nothing lost to aggregation.
    expect(detail.trend.reduce((sum, point) => sum + point.total, 0)).toBe(
      700_000,
    );
  });

  /* ------------------------------- budget block ----------------------------- */

  it('reuses the budget feature progress for month selections (exceeded)', async () => {
    const food = (await service.categories.list('expense'))[0];
    await service.budgets.upsert({
      categoryId: food.id,
      amount: 500_000,
      month: 9,
      year: 2026,
    });
    await spend(food.id, 600_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.budgetStatus).toBe('set');
    expect(detail.budget).toMatchObject({
      amount: 500_000,
      spent: 600_000,
      remaining: -100_000,
      percent: 120,
      state: 'exceeded',
    });
  });

  it('reports warning state inside the budget band (80–99%)', async () => {
    const food = (await service.categories.list('expense'))[0];
    await service.budgets.upsert({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });
    await spend(food.id, 850_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.budgetStatus).toBe('set');
    expect(detail.budget).toMatchObject({percent: 85, state: 'warning'});
  });

  it('says "not set" for a budgeted month without a category budget', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.budgetStatus).toBe('notSet');
    expect(detail.budget).toBeNull();
  });

  it('never shows budget math for non-month selections', async () => {
    const food = (await service.categories.list('expense'))[0];
    await service.budgets.upsert({
      categoryId: food.id,
      amount: 500_000,
      month: 9,
      year: 2026,
    });
    await spend(food.id, 100_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      {
        kind: 'custom',
        fromDate: at(2026, 9, 1),
        toDate: at(2026, 9, 30),
      },
      SEPTEMBER_BOUNDS,
    );
    expect(detail.budgetStatus).toBe('notMonthly');
    expect(detail.budget).toBeNull();
  });

  /* --------------------------- previous comparison -------------------------- */

  it('compares the category against the previous calendar month', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 690_000, at(2026, 8, 10));
    await spend(food.id, 850_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.previousComparison).toEqual({
      currentTotal: 850_000,
      previousTotal: 690_000,
      difference: 160_000,
      percentChange: 23.2,
      direction: 'up',
    });
  });

  it('uses a null percent (never Infinity) when the previous period is zero', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 850_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.previousComparison).toMatchObject({
      currentTotal: 850_000,
      previousTotal: 0,
      percentChange: null,
      direction: 'up',
    });
  });

  it('compares equal-length windows for custom selections', async () => {
    const food = (await service.categories.list('expense'))[0];
    // Current: Sep 10–19 (10 days). Previous window: Aug 31–Sep 9.
    await spend(food.id, 500_000, at(2026, 9, 12));
    await spend(food.id, 250_000, at(2026, 9, 2)); // inside previous window

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      {
        kind: 'custom',
        fromDate: at(2026, 9, 10),
        toDate: at(2026, 9, 19),
      },
      {
        fromDate: new Date(2026, 8, 10).getTime(),
        toDate: new Date(2026, 8, 19, 23, 59, 59, 999).getTime(),
      },
    );
    expect(detail.previousComparison).toEqual({
      currentTotal: 500_000,
      previousTotal: 250_000,
      difference: 250_000,
      percentChange: 100,
      direction: 'up',
    });
  });

  it('stays flat (never NaN) when neither period had spending', async () => {
    const food = (await service.categories.list('expense'))[0];

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.previousComparison).toEqual({
      currentTotal: 0,
      previousTotal: 0,
      difference: 0,
      percentChange: null,
      direction: 'flat',
    });
    expect(detail.percent).toBeNull();
    expect(detail.averageTransaction).toBe(0);
    expect(detail.largestTransaction).toBeNull();
    expect(detail.transactionCount).toBe(0);
  });

  it('reports a decrease for a quieter current period', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 1_500_000, at(2026, 8, 10));
    await spend(food.id, 1_200_000, at(2026, 9, 10));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.previousComparison).toMatchObject({
      percentChange: -20,
      direction: 'down',
    });
  });

  it('keeps neighboring months isolated at the boundary', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 8, 31));
    await spend(food.id, 200_000, at(2026, 9, 1));
    await spend(food.id, 300_000, at(2026, 9, 30));
    await spend(food.id, 400_000, at(2026, 10, 1));

    const detail = await feature.getCategoryReportDetail(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.total).toBe(500_000);
    expect(detail.previousComparison.previousTotal).toBe(100_000);
  });

  it('compares income sources against the previous period too', async () => {
    await earn(1_000_000, at(2026, 8, 5), 'Salary');
    await earn(800_000, at(2026, 9, 5), 'Salary');

    const detail = await feature.getCategoryReportDetail(
      {kind: 'income', source: 'Salary'},
      SEPTEMBER,
      SEPTEMBER_BOUNDS,
    );
    expect(detail.previousComparison).toMatchObject({
      currentTotal: 800_000,
      previousTotal: 1_000_000,
      percentChange: -20,
      direction: 'down',
    });
  });

  /* ------------------------------- pagination ------------------------------- */

  it('pages the transaction list without loading everything at once', async () => {
    const food = (await service.categories.list('expense'))[0];
    for (let i = 0; i < 25; i += 1) {
      await spend(food.id, 1_000 + i, at(2026, 9, (i % 28) + 1), `Row ${i}`);
    }

    const page0 = await feature.getCategoryTransactionPage(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER_BOUNDS,
      0,
      20,
    );
    expect(page0.items).toHaveLength(20);
    expect(page0.hasMore).toBe(true);

    const page1 = await feature.getCategoryTransactionPage(
      {kind: 'expense', categoryId: food.id},
      SEPTEMBER_BOUNDS,
      1,
      20,
    );
    expect(page1.items).toHaveLength(5);
    expect(page1.hasMore).toBe(false);

    // Pages never overlap and together cover every row exactly once.
    const page0Keys = new Set(page0.items.map(item => item.key));
    const page1Keys = new Set(page1.items.map(item => item.key));
    for (const key of page1Keys) {
      expect(page0Keys.has(key)).toBe(false);
    }
    expect(page0Keys.size + page1Keys.size).toBe(25);

    // Newest first within a page.
    const dates = page0.items.map(item => item.date);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('returns an empty page when the scope has no rows in the window', async () => {
    const food = (await service.categories.list('expense'))[0];
    const page = await feature.getCategoryTransactionPage(
      {kind: 'expense', categoryId: food.id},
      AUGUST_BOUNDS,
      0,
      20,
    );
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
