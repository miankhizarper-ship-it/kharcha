/**
 * @jest-environment node
 */
import {createExpenseFeature} from './service';
import type {ExpenseFeature} from './service';
import {DASHBOARD_RECENT_LIMIT} from './types';
import {DatabaseService} from '@/database/service';
import {createTestService} from '@/database/testing/helpers';

/**
 * Fixed local timestamps so dashboard windows are deterministic regardless
 * of the timezone the test process runs in.
 */
const NOW = new Date(2026, 8, 7, 15, 30).getTime(); // Sep 7 2026, 15:30
const TODAY_EARLIER = new Date(2026, 8, 7, 8, 0).getTime();
const YESTERDAY = new Date(2026, 8, 6, 12, 0).getTime();
const LAST_MONTH = new Date(2026, 7, 15, 12, 0).getTime();

describe('ExpenseFeature', () => {
  let service: DatabaseService;
  let feature: ExpenseFeature;

  beforeEach(async () => {
    service = await createTestService();
    feature = createExpenseFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  /* ------------------------------ categories ----------------------------- */

  it('lists expense categories for the picker', async () => {
    const categories = await feature.listCategories('expense');
    // Seeded by migration 001.
    expect(categories.length).toBeGreaterThanOrEqual(10);
    expect(categories.every(c => c.type === 'expense')).toBe(true);
    const names = categories.map(c => c.name);
    expect(names).toContain('Food & Dining');
    expect(names).not.toContain('Salary');
  });

  /* --------------------------- create/read flows -------------------------- */

  it('creates, reads and round-trips an expense', async () => {
    const [category] = await feature.listCategories('expense');
    const created = await feature.addExpense({
      amount: 25_000,
      title: 'Dinner',
      categoryId: category.id,
      date: TODAY_EARLIER,
      paymentMethod: 'card',
      note: null,
    });

    const loaded = await feature.getExpense(created.id);
    expect(loaded).toEqual(created);
  });

  it('returns null for a missing expense', async () => {
    expect(await feature.getExpense(999_999)).toBeNull();
  });

  /* ---------------------------- update + delete --------------------------- */

  it('updates an expense, preserving createdAt and bumping updatedAt', async () => {
    const [category] = await feature.listCategories('expense');
    const created = await feature.addExpense({
      amount: 10_000,
      title: 'Bus fare',
      categoryId: category.id,
      date: TODAY_EARLIER,
      paymentMethod: 'cash',
      note: null,
    });

    const updated = await feature.editExpense(created.id, {
      amount: 12_500,
      title: 'Metro fare',
      paymentMethod: 'card',
    });

    expect(updated.amount).toBe(12_500);
    expect(updated.title).toBe('Metro fare');
    expect(updated.paymentMethod).toBe('card');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('deletes an expense exactly once', async () => {
    const [category] = await feature.listCategories('expense');
    const created = await feature.addExpense({
      amount: 5_000,
      title: 'Snack',
      categoryId: category.id,
      date: TODAY_EARLIER,
      paymentMethod: 'cash',
    });

    expect(await feature.removeExpense(created.id)).toBe(true);
    expect(await feature.getExpense(created.id)).toBeNull();
    expect(await feature.removeExpense(created.id)).toBe(false);
  });

  /* --------------------------- transaction pages -------------------------- */

  describe('getTransactionPage', () => {
    it('returns pages in date-descending order with correct hasMore', async () => {
      const [category] = await feature.listCategories('expense');
      const a = await feature.addExpense({
        amount: 1_000,
        title: 'Oldest',
        categoryId: category.id,
        date: YESTERDAY,
        paymentMethod: 'cash',
      });
      const b = await feature.addExpense({
        amount: 2_000,
        title: 'Middle',
        categoryId: category.id,
        date: TODAY_EARLIER,
        paymentMethod: 'cash',
      });
      const c = await feature.addExpense({
        amount: 3_000,
        title: 'Newest',
        categoryId: category.id,
        date: NOW,
        paymentMethod: 'cash',
      });

      const page0 = await feature.getTransactionPage({pageSize: 2, page: 0});
      expect(page0.items.map(i => i.id)).toEqual([c.id, b.id]);
      expect(page0.hasMore).toBe(true);

      const page1 = await feature.getTransactionPage({pageSize: 2, page: 1});
      expect(page1.items.map(i => i.id)).toEqual([a.id]);
      expect(page1.hasMore).toBe(false);
    });

    it('joins category names so rows render without extra queries', async () => {
      const [category] = await feature.listCategories('expense');
      await feature.addExpense({
        amount: 1_000,
        title: 'Tea',
        categoryId: category.id,
        date: TODAY_EARLIER,
        paymentMethod: 'cash',
      });

      const page = await feature.getTransactionPage({pageSize: 10});
      expect(page.items).toHaveLength(1);
      expect(page.items[0].categoryName).toBe(category.name);
      expect(page.items[0].categoryIcon).toBe(category.icon);
    });

    it('filters by category', async () => {
      const categories = await feature.listCategories('expense');
      const [first, second] = categories;
      await feature.addExpense({
        amount: 1_000,
        title: 'A',
        categoryId: first.id,
        date: TODAY_EARLIER,
        paymentMethod: 'cash',
      });
      await feature.addExpense({
        amount: 2_000,
        title: 'B',
        categoryId: second.id,
        date: TODAY_EARLIER,
        paymentMethod: 'cash',
      });

      const page = await feature.getTransactionPage({
        categoryId: first.id,
        pageSize: 10,
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].title).toBe('A');
    });

    it('searches titles and notes, case-insensitively', async () => {
      const [category] = await feature.listCategories('expense');
      const base = {
        categoryId: category.id,
        date: TODAY_EARLIER,
        paymentMethod: 'cash' as const,
      };
      await feature.addExpense({
        ...base,
        amount: 100,
        title: 'Chai',
        note: 'morning',
      });
      await feature.addExpense({
        ...base,
        amount: 200,
        title: 'Bus',
        note: 'office commute',
      });
      await feature.addExpense({
        ...base,
        amount: 300,
        title: 'Groceries',
        note: null,
      });

      const byTitle = await feature.getTransactionPage({search: 'chai'});
      expect(byTitle.items.map(i => i.title)).toEqual(['Chai']);

      const byNote = await feature.getTransactionPage({search: 'OFFICE'});
      expect(byNote.items.map(i => i.title)).toEqual(['Bus']);

      const none = await feature.getTransactionPage({search: 'zzz-not-there'});
      expect(none.items).toEqual([]);
      expect(none.hasMore).toBe(false);
    });

    it('applies the this-month period window', async () => {
      const [category] = await feature.listCategories('expense');
      const base = {categoryId: category.id, paymentMethod: 'cash' as const};
      await feature.addExpense({
        ...base,
        amount: 1_000,
        title: 'In month',
        date: YESTERDAY,
      });
      await feature.addExpense({
        ...base,
        amount: 2_000,
        title: 'Last month',
        date: LAST_MONTH,
      });

      const month = await feature.getTransactionPage({
        period: 'thisMonth',
        pageSize: 10,
      });
      expect(month.items.map(i => i.title)).toEqual(['In month']);

      const all = await feature.getTransactionPage({
        period: 'all',
        pageSize: 10,
      });
      expect(all.items).toHaveLength(2);
    });

    it('rejects a negative page instead of leaking rows', async () => {
      const page = await feature.getTransactionPage({page: -5, pageSize: 10});
      expect(page.items).toEqual([]);
    });
  });

  /* ------------------------------- dashboard ------------------------------ */

  describe('getDashboardSnapshot', () => {
    let foodId: number;
    let transportId: number;

    beforeEach(async () => {
      const categories = await feature.listCategories('expense');
      const food = categories.find(c => c.name === 'Food & Dining');
      const transport = categories.find(c => c.name === 'Transport');
      if (!food || !transport) {
        throw new Error('Expected seeded expense categories to exist');
      }
      foodId = food.id;
      transportId = transport.id;

      // today (2 expenses, different categories)
      await feature.addExpense({
        amount: 50_000,
        title: 'Dinner',
        categoryId: foodId,
        date: TODAY_EARLIER,
        paymentMethod: 'cash',
      });
      await feature.addExpense({
        amount: 70_000,
        title: 'Taxi',
        categoryId: transportId,
        date: NOW,
        paymentMethod: 'card',
      });
      // this month, not today
      await feature.addExpense({
        amount: 30_000,
        title: 'Groceries',
        categoryId: foodId,
        date: YESTERDAY,
        paymentMethod: 'cash',
      });
      // outside the month window
      await feature.addExpense({
        amount: 100_000,
        title: 'Rent',
        categoryId: foodId,
        date: LAST_MONTH,
        paymentMethod: 'bank_transfer',
      });
    });

    it('computes today and month totals from SQLite', async () => {
      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.todayTotal).toBe(120_000);
      expect(snapshot.monthTotal).toBe(150_000);
    });

    it('returns an empty snapshot when nothing is recorded', async () => {
      const empty = await createTestService();
      const emptyFeature = createExpenseFeature(empty);
      const snapshot = await emptyFeature.getDashboardSnapshot(NOW);
      expect(snapshot).toEqual({
        todayTotal: 0,
        monthTotal: 0,
        categoryTotals: [],
        recent: [],
      });
      await empty.close();
    });

    it('ranks month category totals, largest first, with names/icons', async () => {
      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.categoryTotals).toEqual([
        {
          categoryId: foodId,
          name: 'Food & Dining',
          icon: 'restaurant',
          total: 80_000,
        },
        {
          categoryId: transportId,
          name: 'Transport',
          icon: 'bus',
          total: 70_000,
        },
      ]);
    });

    it('lists recent transactions newest first, capped to the limit', async () => {
      const [category] = await feature.listCategories('expense');
      // NOW's expense (Taxi) already exists from beforeEach; add more to
      // exceed the recent cap.
      for (let i = 0; i < DASHBOARD_RECENT_LIMIT + 2; i++) {
        await feature.addExpense({
          amount: 1_000 + i,
          title: `Extra ${i}`,
          categoryId: category.id,
          date: NOW + (i + 1) * 60_000,
          paymentMethod: 'cash',
        });
      }

      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.recent).toHaveLength(DASHBOARD_RECENT_LIMIT);

      // The newest rows (the "Extra" batch) come first, newest to oldest.
      const titles = snapshot.recent.map(r => r.title);
      expect(titles[0]).toBe(`Extra ${DASHBOARD_RECENT_LIMIT + 1}`);
      expect(titles[1]).toBe(`Extra ${DASHBOARD_RECENT_LIMIT}`);
    });
  });
});
