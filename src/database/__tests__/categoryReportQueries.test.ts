/**
 * @jest-environment node
 */
import {createTestService, DAY_MS, T1} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';

/**
 * Phase 9 report-drill-down query coverage: the additive repository
 * methods that keep category reports aggregate-driven (no N+1) —
 * `sumCountByCategory`, the category-scoped `sumByDay`, the amountDesc
 * ordering (largest transaction), the income source filter, and income
 * `sumBySource` / `sumByDay`.
 */
describe('category report queries', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  /** Local noon helper — record dates commit at noon app-wide. */
  const at = (dayOffsetFromT1: number): number => T1 + dayOffsetFromT1 * DAY_MS;

  async function seedCategoryExpenses(): Promise<{
    food: number;
    transport: number;
  }> {
    const categories = await service.categories.list('expense');
    const food = categories.find(row => row.name === 'Food & Dining')!;
    const transport = categories.find(row => row.name === 'Transport')!;

    await service.expenses.create({
      amount: 40_000,
      title: 'Food A',
      categoryId: food.id,
      date: T1,
      paymentMethod: 'cash',
    });
    await service.expenses.create({
      amount: 60_000,
      title: 'Food B',
      categoryId: food.id,
      date: T1 + DAY_MS,
      paymentMethod: 'card',
    });
    await service.expenses.create({
      amount: 10_000,
      title: 'Transport A',
      categoryId: transport.id,
      date: T1,
      paymentMethod: 'cash',
    });

    return {food: food.id, transport: transport.id};
  }

  describe('expenses.sumCountByCategory', () => {
    it('returns totals AND counts in one grouped query', async () => {
      const {food, transport} = await seedCategoryExpenses();

      const rows = await service.expenses.sumCountByCategory();
      expect(rows).toEqual([
        {categoryId: food, total: 100_000, transactionCount: 2},
        {categoryId: transport, total: 10_000, transactionCount: 1},
      ]);
    });

    it('respects the date window and category filter', async () => {
      const {food, transport} = await seedCategoryExpenses();

      const rows = await service.expenses.sumCountByCategory({
        fromDate: T1,
        toDate: T1,
      });
      expect(rows).toEqual([
        {categoryId: food, total: 40_000, transactionCount: 1},
        {categoryId: transport, total: 10_000, transactionCount: 1},
      ]);

      const onlyFood = await service.expenses.sumCountByCategory({
        categoryId: food,
      });
      expect(onlyFood).toEqual([
        {categoryId: food, total: 100_000, transactionCount: 2},
      ]);
    });

    it('returns no rows when nothing matches (never fabricates a category)', async () => {
      const rows = await service.expenses.sumCountByCategory();
      expect(rows).toEqual([]);
    });
  });

  describe('expenses.sumByDay with categoryId', () => {
    it('scopes the daily buckets to one category', async () => {
      const {food, transport} = await seedCategoryExpenses();

      const foodDays = await service.expenses.sumByDay({
        fromDate: T1,
        toDate: T1 + DAY_MS,
        categoryId: food,
      });
      expect(foodDays).toEqual([
        {dayIndex: 0, total: 40_000},
        {dayIndex: 1, total: 60_000},
      ]);

      const transportDays = await service.expenses.sumByDay({
        fromDate: T1,
        toDate: T1 + DAY_MS,
        categoryId: transport,
      });
      expect(transportDays).toEqual([{dayIndex: 0, total: 10_000}]);
    });

    it('behaves exactly like the unscoped variant when no category is given', async () => {
      const {food} = await seedCategoryExpenses();

      const unscoped = await service.expenses.sumByDay({
        fromDate: T1,
        toDate: T1,
      });
      const scoped = await service.expenses.sumByDay({
        fromDate: T1,
        toDate: T1,
        categoryId: food,
      });
      // Only Food spent on T1, so both shapes coincide for that day.
      expect(unscoped).toContainEqual({dayIndex: 0, total: 50_000});
      expect(scoped).toEqual([{dayIndex: 0, total: 40_000}]);
    });
  });

  describe('amountDesc ordering (largest transaction)', () => {
    it('returns the biggest expense first with oldest-row tie-breaking', async () => {
      const {food} = await seedCategoryExpenses();
      // Same amount as "Food B" (60_000), created LATER — must NOT win.
      await service.expenses.create({
        amount: 60_000,
        title: 'Food C tie',
        categoryId: food,
        date: T1 + 3 * DAY_MS,
        paymentMethod: 'cash',
      });

      const rows = await service.expenses.listWithCategory({
        categoryId: food,
        order: 'amountDesc',
        limit: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({title: 'Food B', amount: 60_000});
    });

    it('returns the biggest income first with oldest-row tie-breaking', async () => {
      await service.income.create({amount: 50_000, source: 'Small', date: T1});
      await service.income.create({amount: 90_000, source: 'Big', date: T1});
      const tie = await service.income.create({
        amount: 90_000,
        source: 'Big tie',
        date: T1 + DAY_MS,
      });

      const rows = await service.income.list({
        order: 'amountDesc',
        limit: 2,
      });
      expect(rows.map(row => row.id)).toEqual([rows[0].id, tie.id]);
      expect(rows[0]).toMatchObject({amount: 90_000, source: 'Big'});
    });
  });

  describe('income source filter + sumBySource', () => {
    beforeEach(async () => {
      await service.income.create({
        amount: 100_000,
        source: 'Salary',
        date: T1,
      });
      await service.income.create({
        amount: 250_000,
        source: 'Salary',
        date: T1 + DAY_MS,
      });
      await service.income.create({
        amount: 30_000,
        source: 'salary', // different exact source (case-sensitive)
        date: T1,
      });
      await service.income.create({
        amount: 999_999,
        source: 'Gift',
        date: T1 + 5 * DAY_MS,
      });
    });

    it('filters income by the EXACT source string', async () => {
      const salaryRows = await service.income.list({source: 'Salary'});
      expect(salaryRows).toHaveLength(2);
      expect(salaryRows.every(row => row.source === 'Salary')).toBe(true);

      const lowercaseRows = await service.income.list({source: 'salary'});
      expect(lowercaseRows).toHaveLength(1);
      expect(lowercaseRows[0]).toMatchObject({amount: 30_000});

      const none = await service.income.list({source: 'SALARY'});
      expect(none).toEqual([]);
    });

    it('combines the source filter with a date window and counts', async () => {
      const total = await service.income.sumAmount({
        source: 'Salary',
        fromDate: T1,
        toDate: T1 + DAY_MS,
      });
      const count = await service.income.count({
        source: 'Salary',
        fromDate: T1,
        toDate: T1 + DAY_MS,
      });
      expect(total).toBe(350_000);
      expect(count).toBe(2);
    });

    it('groups income per exact source with totals and counts', async () => {
      const rows = await service.income.sumBySource({
        fromDate: T1,
        toDate: T1 + 5 * DAY_MS,
      });
      expect(rows).toEqual([
        {source: 'Gift', total: 999_999, transactionCount: 1},
        {source: 'Salary', total: 350_000, transactionCount: 2},
        {source: 'salary', total: 30_000, transactionCount: 1},
      ]);
    });

    it('respects the date window in sumBySource', async () => {
      const rows = await service.income.sumBySource({
        fromDate: T1,
        toDate: T1, // Gift (T1+5d) and second Salary (T1+1d) excluded
      });
      expect(rows).toEqual([
        {source: 'Salary', total: 100_000, transactionCount: 1},
        {source: 'salary', total: 30_000, transactionCount: 1},
      ]);
    });
  });

  describe('income.sumByDay', () => {
    it('buckets income per day with the same dayIndex anchoring', async () => {
      await service.income.create({amount: 100_000, source: 'A', date: T1});
      await service.income.create({amount: 50_000, source: 'B', date: T1});
      await service.income.create({
        amount: 70_000,
        source: 'A',
        date: T1 + 2 * DAY_MS,
      });

      const rows = await service.income.sumByDay({
        fromDate: T1,
        toDate: T1 + 2 * DAY_MS,
      });
      expect(rows).toEqual([
        {dayIndex: 0, total: 150_000},
        // day 1 absent (no income)
        {dayIndex: 2, total: 70_000},
      ]);
    });

    it('returns no rows for a window without income', async () => {
      await service.income.create({amount: 100_000, source: 'A', date: T1});
      const rows = await service.income.sumByDay({
        fromDate: T1 + 10 * DAY_MS,
        toDate: T1 + 20 * DAY_MS,
      });
      expect(rows).toEqual([]);
    });
  });

  it('aggregates every category exactly once (no duplicates for grouped queries)', async () => {
    const {food, transport} = await seedCategoryExpenses();
    const rows = await service.expenses.sumCountByCategory();
    const ids = rows.map(row => row.categoryId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([food, transport]));
  });

  it('keeps paginated expense windows aligned with offset+limit', async () => {
    const {food} = await seedCategoryExpenses();
    for (let i = 0; i < 4; i += 1) {
      await service.expenses.create({
        amount: 1_000 + i,
        title: `Extra ${i}`,
        categoryId: food,
        date: at(i + 10),
        paymentMethod: 'cash',
      });
    }

    const page0 = await service.expenses.listWithCategory({
      categoryId: food,
      fromDate: T1,
      toDate: at(20),
      limit: 3,
      offset: 0,
      order: 'dateDesc',
    });
    expect(page0.map(row => row.title)).toEqual([
      'Extra 3',
      'Extra 2',
      'Extra 1',
    ]);

    const page1 = await service.expenses.listWithCategory({
      categoryId: food,
      fromDate: T1,
      toDate: at(20),
      limit: 3,
      offset: 3,
      order: 'dateDesc',
    });
    expect(page1.map(row => row.title)).toEqual([
      'Extra 0',
      'Food B',
      'Food A',
    ]);
  });
});
