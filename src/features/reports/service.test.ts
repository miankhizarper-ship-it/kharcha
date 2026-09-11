/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {createReportFeature} from './service';
import type {ReportFeature} from './service';
import type {ReportSelection} from './types';

/**
 * Fixed local timestamps keep every window deterministic regardless of the
 * timezone the test process runs in (mirrors budgets/service.test.ts).
 */
const NOW = new Date(2026, 8, 7, 15, 30).getTime(); // Sep 7 2026 (Monday), 15:30

/** Local noon inside a day — matches what the CalendarSheet commits. */
function at(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0).getTime();
}

const SEPTEMBER: ReportSelection = {kind: 'month', year: 2026, month: 9};

describe('ReportFeature', () => {
  let service: DatabaseService;
  let feature: ReportFeature;

  beforeEach(async () => {
    service = await createTestService();
    feature = createReportFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  /** Creates an expense in the given category at a day (local noon). */
  async function spend(
    categoryId: number,
    amountMinor: number,
    date: number,
    title = 'Report test expense',
    paymentMethod: 'cash' | 'card' = 'cash',
  ): Promise<void> {
    await service.expenses.create({
      amount: amountMinor,
      title,
      categoryId,
      date,
      paymentMethod,
    });
  }

  async function earn(
    amountMinor: number,
    date: number,
    source = 'Salary',
  ): Promise<void> {
    await service.income.create({
      amount: amountMinor,
      source,
      date,
    });
  }

  /* ------------------------------- empty data ------------------------------ */

  it('returns a complete zero snapshot for a period with no data', async () => {
    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);

    expect(snapshot.income).toBe(0);
    expect(snapshot.expenses).toBe(0);
    expect(snapshot.balance).toBe(0);
    expect(snapshot.averageDailySpend).toBe(0);
    expect(snapshot.period.dayCount).toBe(30);
    expect(snapshot.dailySpending).toHaveLength(30);
    expect(snapshot.dailySpending.every(point => point.total === 0)).toBe(true);
    expect(snapshot.categoryBreakdown).toEqual([]);
    expect(snapshot.topCategory).toBeNull();
    expect(snapshot.highestSpendingDay).toBeNull();
    expect(snapshot.incomeVsExpense).toEqual({
      income: 0,
      expenses: 0,
      balance: 0,
    });
  });

  it('reports null month extras for week and custom selections', async () => {
    const week = await feature.getReportSnapshot({kind: 'thisWeek'}, NOW);
    expect(week.previousPeriodComparison).toBeNull();
    expect(week.budgetPerformance).toBeNull();
    expect(week.period.dayCount).toBe(7);

    const custom = await feature.getReportSnapshot(
      {kind: 'custom', fromDate: at(2026, 9, 1), toDate: at(2026, 9, 7)},
      NOW,
    );
    expect(custom.previousPeriodComparison).toBeNull();
    expect(custom.budgetPerformance).toBeNull();
    expect(custom.period.dayCount).toBe(7);
  });

  /* ------------------------------ range totals ----------------------------- */

  it('sums only income inside the selected period', async () => {
    await earn(1_000_000, at(2026, 9, 5));
    await earn(500_000, at(2026, 9, 20));
    await earn(999_999, at(2026, 8, 31)); // before
    await earn(777_777, at(2026, 10, 1)); // after

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.income).toBe(1_500_000);
    expect(snapshot.expenses).toBe(0);
    expect(snapshot.balance).toBe(1_500_000);
  });

  it('sums only expenses inside the selected period', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 450_000, at(2026, 9, 1));
    await spend(food.id, 700_000, at(2026, 9, 30));
    await spend(food.id, 111_111, at(2026, 8, 31)); // last ms of August excluded
    await spend(food.id, 222_222, at(2026, 10, 1)); // first day of October excluded

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.expenses).toBe(1_150_000);
    expect(snapshot.balance).toBe(-1_150_000);
  });

  it('never counts income as expenses or vice versa', async () => {
    await earn(2_000_000, at(2026, 9, 5));
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 300_000, at(2026, 9, 6));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.income).toBe(2_000_000);
    expect(snapshot.expenses).toBe(300_000);
    expect(snapshot.balance).toBe(1_700_000);
  });

  /* ----------------------------- daily aggregation ------------------------- */

  it('builds the daily series from real rows, zero-filling empty days', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 45_000, at(2026, 9, 1));
    await spend(food.id, 25_000, at(2026, 9, 1)); // same day aggregates
    await spend(food.id, 90_000, at(2026, 9, 3));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);

    expect(snapshot.dailySpending[0]).toEqual({
      date: new Date(2026, 8, 1).getTime(),
      total: 70_000,
    });
    expect(snapshot.dailySpending[1]).toEqual({
      date: new Date(2026, 8, 2).getTime(),
      total: 0,
    });
    expect(snapshot.dailySpending[2]).toEqual({
      date: new Date(2026, 8, 3).getTime(),
      total: 90_000,
    });
    expect(snapshot.dailySpending).toHaveLength(30);
  });

  it('derives the highest spending day from the daily series', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 45_000, at(2026, 9, 2));
    await spend(food.id, 145_000, at(2026, 9, 14));
    await spend(food.id, 90_000, at(2026, 9, 20));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.highestSpendingDay).toEqual({
      date: new Date(2026, 8, 14).getTime(), // local midnight of the peak day
      total: 145_000,
    });
  });

  it('computes average daily spend over the full period length', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 1_845_000, at(2026, 9, 14));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.averageDailySpend).toBe(61_500); // 18,450.00 / 30 days

    const singleDay = await feature.getReportSnapshot(
      {kind: 'custom', fromDate: at(2026, 9, 14), toDate: at(2026, 9, 14)},
      NOW,
    );
    expect(singleDay.period.dayCount).toBe(1);
    expect(singleDay.averageDailySpend).toBe(1_845_000);
  });

  /* ----------------------------- category slices --------------------------- */

  it('ranks categories by spending with names and icons attached', async () => {
    const expenseCategories = await service.categories.list('expense');
    const food = expenseCategories.find(row => row.name === 'Food & Dining')!;
    const transport = expenseCategories.find(row => row.name === 'Transport')!;

    await spend(food.id, 820_000, at(2026, 9, 3));
    await spend(food.id, 400_000, at(2026, 9, 8));
    await spend(transport.id, 215_000, at(2026, 9, 9));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);

    expect(snapshot.categoryBreakdown).toEqual([
      expect.objectContaining({
        categoryId: food.id,
        name: food.name,
        icon: food.icon,
        total: 1_220_000,
        percent: 85,
      }),
      expect.objectContaining({
        categoryId: transport.id,
        name: transport.name,
        total: 215_000,
        percent: 15,
      }),
    ]);
    expect(snapshot.topCategory?.name).toBe(food.name);
  });

  it('keeps zero-spending categories out of the breakdown', async () => {
    const expenseCategories = await service.categories.list('expense');
    const food = expenseCategories[0];
    await spend(food.id, 10_000, at(2026, 9, 2));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.categoryBreakdown).toHaveLength(1);
  });

  /* ------------------------------ this week -------------------------------- */

  it('restricts thisWeek to Monday–Sunday of the injected now', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 9, 7)); // Monday — in
    await spend(food.id, 200_000, at(2026, 9, 13)); // Sunday — in
    await spend(food.id, 300_000, at(2026, 9, 6)); // previous Sunday — out
    await spend(food.id, 400_000, at(2026, 9, 14)); // next Monday — out

    const snapshot = await feature.getReportSnapshot({kind: 'thisWeek'}, NOW);
    expect(snapshot.period.dayCount).toBe(7);
    expect(snapshot.expenses).toBe(300_000);
    expect(snapshot.dailySpending).toHaveLength(7);
    expect(snapshot.dailySpending[0].total).toBe(100_000); // Sep 7
    expect(snapshot.dailySpending[6].total).toBe(200_000); // Sep 13
  });

  /* ------------------------------ custom range ----------------------------- */

  it('honors an explicit custom range, both ends inclusive', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 9, 1));
    await spend(food.id, 200_000, at(2026, 9, 14));
    await spend(food.id, 400_000, at(2026, 9, 15)); // just outside
    await spend(food.id, 800_000, at(2026, 8, 31)); // before

    const snapshot = await feature.getReportSnapshot(
      {kind: 'custom', fromDate: at(2026, 9, 1), toDate: at(2026, 9, 14)},
      NOW,
    );
    expect(snapshot.period.dayCount).toBe(14);
    expect(snapshot.expenses).toBe(300_000);
    expect(snapshot.dailySpending).toHaveLength(14);
  });

  it('normalizes a reversed custom range', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 9, 5));

    const snapshot = await feature.getReportSnapshot(
      {kind: 'custom', fromDate: at(2026, 9, 10), toDate: at(2026, 9, 1)},
      NOW,
    );
    expect(snapshot.period.dayCount).toBe(10);
    expect(snapshot.expenses).toBe(100_000);
  });

  it('crosses month and year boundaries inside custom ranges', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 8, 31));
    await spend(food.id, 200_000, at(2026, 9, 1));
    await spend(food.id, 400_000, at(2026, 12, 31));
    await spend(food.id, 800_000, at(2027, 1, 1));

    const monthEdge = await feature.getReportSnapshot(
      {kind: 'custom', fromDate: at(2026, 8, 31), toDate: at(2026, 9, 1)},
      NOW,
    );
    expect(monthEdge.expenses).toBe(300_000);
    expect(monthEdge.period.dayCount).toBe(2);

    const yearEdge = await feature.getReportSnapshot(
      {kind: 'custom', fromDate: at(2026, 12, 31), toDate: at(2027, 1, 1)},
      NOW,
    );
    expect(yearEdge.expenses).toBe(1_200_000);
    expect(yearEdge.period.dayCount).toBe(2);
  });

  /* -------------------------- month-over-month ----------------------------- */

  it('compares against the previous month (spec example: +21.4%)', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 1_520_000, at(2026, 8, 10));
    await spend(food.id, 1_845_000, at(2026, 9, 10));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.previousPeriodComparison).toEqual({
      currentTotal: 1_845_000,
      previousTotal: 1_520_000,
      difference: 325_000,
      percentChange: 21.4,
      direction: 'up',
    });
  });

  it('reports a decrease with a negative percent', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 1_500_000, at(2026, 8, 10));
    await spend(food.id, 1_200_000, at(2026, 9, 10));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.previousPeriodComparison?.direction).toBe('down');
    expect(snapshot.previousPeriodComparison?.percentChange).toBe(-20);
  });

  it('uses a null percent (never Infinity) when the previous month is empty', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 1_845_000, at(2026, 9, 10));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.previousPeriodComparison).toMatchObject({
      previousTotal: 0,
      percentChange: null,
      direction: 'up',
    });
  });

  it('rolls the previous month across the year boundary (Jan → Dec)', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 500_000, at(2026, 12, 15));
    await spend(food.id, 250_000, at(2027, 1, 15));

    const snapshot = await feature.getReportSnapshot(
      {kind: 'month', year: 2027, month: 1},
      NOW,
    );
    expect(snapshot.previousPeriodComparison).toEqual({
      currentTotal: 250_000,
      previousTotal: 500_000,
      difference: -250_000,
      percentChange: -50,
      direction: 'down',
    });
  });

  it('keeps neighboring months isolated (no boundary leakage)', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 100_000, at(2026, 8, 31));
    await spend(food.id, 200_000, at(2026, 9, 1));
    await spend(food.id, 300_000, at(2026, 9, 30));
    await spend(food.id, 400_000, at(2026, 10, 1));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.expenses).toBe(500_000);
    expect(snapshot.previousPeriodComparison?.previousTotal).toBe(100_000);
  });

  it('handles leap-year February with 29 series days', async () => {
    const snapshot = await feature.getReportSnapshot(
      {kind: 'month', year: 2024, month: 2},
      NOW,
    );
    expect(snapshot.period.dayCount).toBe(29);
    expect(snapshot.dailySpending).toHaveLength(29);
    expect(snapshot.dailySpending[28].date).toBe(
      new Date(2024, 1, 29).getTime(),
    );
  });

  /* --------------------------- budget performance -------------------------- */

  it('includes overall + category budget performance for month reports', async () => {
    const expenseCategories = await service.categories.list('expense');
    const food = expenseCategories.find(row => row.name === 'Food & Dining')!;
    const transport = expenseCategories.find(row => row.name === 'Transport')!;

    await service.monthlyBudgets.upsert({
      amount: 3_000_000,
      month: 9,
      year: 2026,
    });
    await service.budgets.upsert({
      categoryId: food.id,
      amount: 800_000,
      month: 9,
      year: 2026,
    });
    await service.budgets.upsert({
      categoryId: transport.id,
      amount: 400_000,
      month: 9,
      year: 2026,
    });

    await spend(food.id, 800_000, at(2026, 9, 10)); // Food budget 100% used
    await spend(transport.id, 100_000, at(2026, 9, 11)); // Transport 25%

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.budgetPerformance?.overall).toMatchObject({
      amount: 3_000_000,
      spent: 900_000,
      remaining: 2_100_000,
      percent: 30,
      state: 'ok',
    });

    // Top statuses sorted by usage: Food (100%) before Transport (25%).
    const top = snapshot.budgetPerformance?.topCategories ?? [];
    expect(top.map(row => row.categoryName)).toEqual([
      food.name,
      transport.name,
    ]);
    expect(top[0]).toMatchObject({percent: 100, state: 'exceeded'});
  });

  it('reuses the budget feature result for any reported month', async () => {
    await service.monthlyBudgets.upsert({
      amount: 1_000_000,
      month: 8,
      year: 2026,
    });
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 500_000, at(2026, 8, 15));

    const snapshot = await feature.getReportSnapshot(
      {kind: 'month', year: 2026, month: 8},
      NOW,
    );
    expect(snapshot.budgetPerformance?.overall).toMatchObject({
      amount: 1_000_000,
      spent: 500_000,
      percent: 50,
      state: 'ok',
    });
    expect(snapshot.expenses).toBe(500_000);
  });

  it('returns an overall budget of null when the month has none set', async () => {
    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.budgetPerformance).toEqual({
      overall: null,
      topCategories: [],
      categoryBudgets: [],
    });
  });

  it('reflects edits and deletes on the next load (SQLite is the source of truth)', async () => {
    const food = (await service.categories.list('expense'))[0];
    const expense = await service.expenses.create({
      amount: 250_000,
      title: 'Editable',
      categoryId: food.id,
      date: at(2026, 9, 12),
      paymentMethod: 'cash',
    });

    const before = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(before.expenses).toBe(250_000);

    await service.expenses.update(expense.id, {amount: 500_000});
    const afterEdit = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(afterEdit.expenses).toBe(500_000);

    await service.expenses.delete(expense.id);
    const afterDelete = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(afterDelete.expenses).toBe(0);
    expect(afterDelete.categoryBreakdown).toEqual([]);
  });

  /* ----------------------- Phase 9 snapshot additions ----------------------- */

  it('exposes frequency metrics (counts + average transaction) with zero-safe defaults', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 300_000, at(2026, 9, 2));
    await spend(food.id, 200_000, at(2026, 9, 8));
    await earn(1_000_000, at(2026, 9, 3));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.expenseCount).toBe(2);
    expect(snapshot.incomeCount).toBe(1);
    expect(snapshot.averageTransaction).toBe(250_000);

    const empty = await feature.getReportSnapshot(
      {kind: 'month', year: 2026, month: 8},
      NOW,
    );
    expect(empty.expenseCount).toBe(0);
    expect(empty.incomeCount).toBe(0);
    expect(empty.averageTransaction).toBe(0); // never NaN
  });

  it('picks the largest transaction across BOTH ledger sides deterministically', async () => {
    const food = (await service.categories.list('expense'))[0];
    await spend(food.id, 900_000, at(2026, 9, 5), 'Big expense');
    await earn(1_500_000, at(2026, 9, 6));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.largestTransaction).toMatchObject({
      type: 'income',
      title: 'Salary',
      amount: 1_500_000,
      categoryName: null,
    });

    // Tie at the current maximum → the expense side wins (deterministic).
    await spend(food.id, 1_500_000, at(2026, 9, 7), 'Equal expense');
    const tied = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(tied.largestTransaction).toMatchObject({
      type: 'expense',
      amount: 1_500_000,
    });
  });

  it('names the most frequent category (ties → more money → lower id)', async () => {
    const expenseCategories = await service.categories.list('expense');
    const food = expenseCategories.find(row => row.name === 'Food & Dining')!;
    const transport = expenseCategories.find(row => row.name === 'Transport')!;

    await spend(food.id, 100_000, at(2026, 9, 1));
    await spend(food.id, 100_000, at(2026, 9, 2));
    await spend(transport.id, 50_000, at(2026, 9, 3));
    await spend(transport.id, 50_000, at(2026, 9, 4));
    await spend(transport.id, 400_000, at(2026, 9, 5)); // transport: 3 rows

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.mostFrequentCategory).toMatchObject({
      categoryId: transport.id,
      transactionCount: 3,
      total: 500_000,
    });
  });

  it('groups income by source with percent, count and category icons', async () => {
    // `earn` always writes source 'Salary' — custom sources go direct.
    await earn(2_000_000, at(2026, 9, 1), 'Salary');
    await earn(500_000, at(2026, 9, 15), 'Salary');
    await service.income.create({
      amount: 250_000,
      source: 'Freelance',
      date: at(2026, 9, 3),
    });

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.incomeSources).toEqual([
      expect.objectContaining({
        source: 'Salary',
        icon: 'briefcase', // matches the seeded income category
        total: 2_500_000,
        percent: 90.9, // 2500000 / 2750000
        transactionCount: 2,
      }),
      expect.objectContaining({
        source: 'Freelance',
        total: 250_000,
        percent: 9.1,
        transactionCount: 1,
      }),
    ]);

    const empty = await feature.getReportSnapshot(
      {kind: 'month', year: 2026, month: 8},
      NOW,
    );
    expect(empty.incomeSources).toEqual([]);
  });

  it('annotates breakdown slices with transaction counts', async () => {
    const expenseCategories = await service.categories.list('expense');
    const food = expenseCategories.find(row => row.name === 'Food & Dining')!;
    await spend(food.id, 100_000, at(2026, 9, 1));
    await spend(food.id, 200_000, at(2026, 9, 2));

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    expect(snapshot.categoryBreakdown[0]).toMatchObject({
      categoryId: food.id,
      total: 300_000,
      transactionCount: 2,
    });
  });

  it('carries every category budget of the month for the breakdown + insights', async () => {
    const expenseCategories = await service.categories.list('expense');
    const food = expenseCategories.find(row => row.name === 'Food & Dining')!;
    const transport = expenseCategories.find(row => row.name === 'Transport')!;
    const utilities = expenseCategories.find(row => row.name === 'Utilities')!;

    await service.budgets.upsert({
      categoryId: food.id,
      amount: 800_000,
      month: 9,
      year: 2026,
    });
    await service.budgets.upsert({
      categoryId: transport.id,
      amount: 400_000,
      month: 9,
      year: 2026,
    });
    await service.budgets.upsert({
      categoryId: utilities.id,
      amount: 300_000,
      month: 9,
      year: 2026,
    });

    const snapshot = await feature.getReportSnapshot(SEPTEMBER, NOW);
    const budgetCategoryIds = snapshot.budgetPerformance!.categoryBudgets.map(
      row => row.categoryId,
    );
    expect(budgetCategoryIds).toEqual(
      expect.arrayContaining([food.id, transport.id, utilities.id]),
    );
    expect(budgetCategoryIds).toHaveLength(3); // ALL budgets, not just top 3
    expect(snapshot.budgetPerformance!.topCategories).toHaveLength(3); // capped
  });
});
