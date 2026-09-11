/**
 * @jest-environment node
 */
import {DatabaseService} from '@/database/service';
import {createTestService} from '@/database/testing/helpers';
import {createBudgetFeature} from './service';
import type {BudgetFeature} from './service';

/**
 * Fixed local timestamps so month windows are deterministic regardless of
 * the timezone the test process runs in (mirrors expenses/service.test.ts).
 */
const NOW = new Date(2026, 8, 7, 15, 30).getTime(); // Sep 7 2026, 15:30 local

/** Local timestamp inside a month — noon avoids DST edge cases. */
function at(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0).getTime();
}

describe('BudgetFeature', () => {
  let service: DatabaseService;
  let feature: BudgetFeature;

  /** Creates an expense in a category, reusing one shared category by id. */
  async function spend(
    categoryId: number,
    amountMinor: number,
    date: number,
  ): Promise<void> {
    await service.expenses.create({
      amount: amountMinor,
      title: 'Budget test expense',
      categoryId,
      date,
      paymentMethod: 'cash',
    });
  }

  beforeEach(async () => {
    service = await createTestService();
    feature = createBudgetFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  /* --------------------------- categories picker -------------------------- */

  it('lists only expense categories for the picker', async () => {
    const categories = await feature.listExpenseCategories();
    expect(categories.length).toBeGreaterThanOrEqual(10);
    expect(categories.every(category => category.type === 'expense')).toBe(
      true,
    );
    expect(categories.map(category => category.name)).not.toContain('Salary');
  });

  /* --------------------------- overall budget CRUD ------------------------ */

  it('creates an overall monthly budget (spec example: Rs. 30,000)', async () => {
    const saved = await feature.saveOverallBudget({
      amount: 3_000_000,
      month: 9,
      year: 2026,
    });
    expect(saved.amount).toBe(3_000_000);
    expect(saved.month).toBe(9);
    expect(saved.year).toBe(2026);

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall?.amount).toBe(3_000_000);
    expect(snapshot.overall?.spent).toBe(0);
    expect(snapshot.overall?.remaining).toBe(3_000_000);
    expect(snapshot.overall?.percent).toBe(0);
    expect(snapshot.overall?.state).toBe('ok');
  });

  it('updates the overall budget in place via upsert (same row id)', async () => {
    const original = await feature.saveOverallBudget({
      amount: 3_000_000,
      month: 9,
      year: 2026,
    });
    const updated = await feature.saveOverallBudget({
      amount: 35_000_000,
      month: 9,
      year: 2026,
    });

    expect(updated.id).toBe(original.id);
    expect(updated.amount).toBe(35_000_000);
    expect(await service.monthlyBudgets.find(9, 2026)).toEqual(updated);
  });

  it('deletes the overall budget', async () => {
    const saved = await feature.saveOverallBudget({
      amount: 3_000_000,
      month: 9,
      year: 2026,
    });
    await expect(feature.removeOverallBudget(saved.id)).resolves.toBe(true);

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall).toBeNull();
  });

  it('rejects a zero budget (never reaches the database as valid)', async () => {
    await expect(
      feature.saveOverallBudget({amount: 0, month: 9, year: 2026}),
    ).rejects.toThrow(/amount/i);
    expect(await service.monthlyBudgets.find(9, 2026)).toBeNull();
  });

  /* -------------------------- category budget CRUD ------------------------ */

  it('creates, updates and deletes a category budget', async () => {
    const [food] = await feature.listExpenseCategories();

    const created = await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });
    expect(created).toMatchObject({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });

    const updated = await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 1_200_000,
      month: 9,
      year: 2026,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.amount).toBe(1_200_000);

    await expect(feature.removeCategoryBudget(created.id)).resolves.toBe(true);
    expect(await feature.getMonthSnapshot(2026, 9)).toMatchObject({
      categories: [],
    });
  });

  it('prevents duplicate category budgets by updating via upsert', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });

    // Creating again for the same category + month must NOT add a row.
    await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 900_000,
      month: 9,
      year: 2026,
    });

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.categories).toHaveLength(1);
    expect(snapshot.categories[0].amount).toBe(900_000);
  });

  it('never accepts income categories for category budgets', async () => {
    const [salary] = await service.categories.list('income');
    await expect(
      feature.saveCategoryBudget({
        categoryId: salary.id,
        amount: 100_000,
        month: 9,
        year: 2026,
      }),
    ).rejects.toThrow(/not an expense category/i);
  });

  /* ---------------------- spending calculations + progress ---------------- */

  it('computes overall progress from real expenses (spec example)', async () => {
    const [food, transport] = await feature.listExpenseCategories();

    await feature.saveOverallBudget({amount: 3_000_000, month: 9, year: 2026});
    // Rs. 18,450 total: 8,200 food + 2,150 transport + 8,100 food again.
    await spend(food.id, 820_000, at(2026, 9, 10));
    await spend(transport.id, 215_000, at(2026, 9, 11));
    await spend(food.id, 810_000, at(2026, 9, 12));

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall).toEqual({
      id: expect.any(Number),
      amount: 3_000_000,
      spent: 1_845_000,
      remaining: 1_155_000,
      percent: 61.5,
      state: 'ok',
    });
  });

  it('computes per-category spending only for that category', async () => {
    const [food, transport, hostel] = await feature.listExpenseCategories();

    await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });
    await feature.saveCategoryBudget({
      categoryId: transport.id,
      amount: 400_000,
      month: 9,
      year: 2026,
    });
    await feature.saveCategoryBudget({
      categoryId: hostel.id,
      amount: 800_000,
      month: 9,
      year: 2026,
    });

    await spend(food.id, 820_000, at(2026, 9, 3));
    await spend(transport.id, 215_000, at(2026, 9, 4));
    await spend(hostel.id, 400_000, at(2026, 9, 5));

    const byName = new Map(
      (await feature.getMonthSnapshot(2026, 9)).categories.map(row => [
        row.categoryName,
        row,
      ]),
    );

    expect(byName.get(food.name)).toMatchObject({
      spent: 820_000,
      remaining: 180_000,
      percent: 82,
      state: 'warning',
    });
    expect(byName.get(transport.name)).toMatchObject({
      spent: 215_000,
      remaining: 185_000,
      percent: 53.8,
      state: 'ok',
    });
    expect(byName.get(hostel.name)).toMatchObject({
      spent: 400_000,
      remaining: 400_000,
      percent: 50,
      state: 'ok',
    });
  });

  it('reports exceeded state with negative remaining (125%)', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });
    await spend(food.id, 1_250_000, at(2026, 9, 15));

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.categories[0]).toMatchObject({
      spent: 1_250_000,
      remaining: -250_000,
      percent: 125,
      state: 'exceeded',
    });
  });

  it('handles a month with budgets but no expenses', async () => {
    await feature.saveOverallBudget({amount: 3_000_000, month: 9, year: 2026});
    const [food] = await feature.listExpenseCategories();
    await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 1_000_000,
      month: 9,
      year: 2026,
    });

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall).toMatchObject({spent: 0, percent: 0, state: 'ok'});
    expect(snapshot.categories[0]).toMatchObject({
      spent: 0,
      percent: 0,
      state: 'ok',
    });
  });

  it('handles a month with expenses but no budgets', async () => {
    const [food, transport] = await feature.listExpenseCategories();
    await spend(food.id, 500_000, at(2026, 9, 2));
    await spend(transport.id, 120_000, at(2026, 9, 3));

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall).toBeNull();
    expect(snapshot.categories).toEqual([]);
    // The month total covers ALL categories, budgeted or not.
    expect(snapshot.spent).toBe(620_000);
  });

  it('snapshot month total includes spending outside budgeted categories', async () => {
    const [food, transport] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 1_000_000, month: 9, year: 2026});
    await feature.saveCategoryBudget({
      categoryId: food.id,
      amount: 400_000,
      month: 9,
      year: 2026,
    });

    await spend(food.id, 100_000, at(2026, 9, 2)); // budgeted category
    await spend(transport.id, 90_000, at(2026, 9, 3)); // NOT budgeted

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.spent).toBe(190_000);
    expect(snapshot.overall?.spent).toBe(190_000);
    expect(snapshot.categories[0].spent).toBe(100_000);
  });

  it('expenses outside the month never count toward it', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 1_000_000, month: 9, year: 2026});
    await spend(food.id, 400_000, at(2026, 8, 31)); // August
    await spend(food.id, 300_000, at(2026, 10, 1)); // October

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall?.spent).toBe(0);
  });

  it('income never counts as budget spending', async () => {
    await feature.saveOverallBudget({amount: 1_000_000, month: 9, year: 2026});
    await service.income.create({
      amount: 5_000_000,
      source: 'Salary',
      date: at(2026, 9, 5),
    });

    const snapshot = await feature.getMonthSnapshot(2026, 9);
    expect(snapshot.overall?.spent).toBe(0);
  });

  it('reflects expense edits and deletes on the next snapshot', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 1_000_000, month: 9, year: 2026});

    const expense = await service.expenses.create({
      amount: 400_000,
      title: 'Groceries',
      categoryId: food.id,
      date: at(2026, 9, 6),
      paymentMethod: 'cash',
    });
    expect((await feature.getMonthSnapshot(2026, 9)).overall?.spent).toBe(
      400_000,
    );

    await service.expenses.update(expense.id, {amount: 600_000});
    expect((await feature.getMonthSnapshot(2026, 9)).overall?.spent).toBe(
      600_000,
    );

    await service.expenses.delete(expense.id);
    expect((await feature.getMonthSnapshot(2026, 9)).overall?.spent).toBe(0);
  });

  /* ------------------------- month boundary edges ------------------------- */

  it('counts expenses on the first and last millisecond of the month', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 1_000_000, month: 9, year: 2026});

    const firstMs = new Date(2026, 8, 1, 0, 0, 0, 0).getTime();
    const lastMs = new Date(2026, 8, 30, 23, 59, 59, 999).getTime();
    await spend(food.id, 100_000, firstMs);
    await spend(food.id, 200_000, lastMs);

    expect((await feature.getMonthSnapshot(2026, 9)).overall?.spent).toBe(
      300_000,
    );
  });

  it('supports previous months independently of the current one', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 2_000_000, month: 8, year: 2026});
    await spend(food.id, 500_000, at(2026, 8, 15));
    await spend(food.id, 700_000, at(2026, 9, 15)); // this month, not August

    const august = await feature.getMonthSnapshot(2026, 8);
    expect(august.overall).toMatchObject({spent: 500_000, percent: 25});
    // September has no budget of its own — August's must not leak.
    expect((await feature.getMonthSnapshot(2026, 9)).overall).toBeNull();
  });

  it('supports future months without creating anything automatically', async () => {
    const empty = await feature.getMonthSnapshot(2027, 3);
    expect(empty.overall).toBeNull();
    expect(empty.categories).toEqual([]);

    // Viewing a future month does not auto-create a budget...
    const snapshot = await feature.getMonthSnapshot(2027, 3);
    expect(snapshot.overall).toBeNull();

    // ...but the user may explicitly set one for it.
    await feature.saveOverallBudget({amount: 900_000, month: 3, year: 2027});
    expect((await feature.getMonthSnapshot(2027, 3)).overall?.amount).toBe(
      900_000,
    );
    // ...and the current month stays untouched.
    expect((await feature.getMonthSnapshot(2026, 9)).overall).toBeNull();
  });

  it('handles leap-year February (Feb 29 exists in 2024)', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 1_000_000, month: 2, year: 2024});
    await spend(food.id, 250_000, at(2024, 2, 29));

    const snapshot = await feature.getMonthSnapshot(2024, 2);
    expect(snapshot.overall).toMatchObject({spent: 250_000, percent: 25});

    // Feb 29 2024 must not leak into March.
    await spend(food.id, 100_000, at(2024, 3, 1));
    expect((await feature.getMonthSnapshot(2024, 2)).overall?.spent).toBe(
      250_000,
    );
  });

  it('handles non-leap February (no Feb 29 in 2025)', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 1_000_000, month: 2, year: 2025});
    await spend(food.id, 100_000, at(2025, 2, 28));
    await spend(food.id, 100_000, at(2025, 3, 1)); // next month

    const snapshot = await feature.getMonthSnapshot(2025, 2);
    expect(snapshot.overall?.spent).toBe(100_000);
  });

  it('keeps December and January of adjacent years separate', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 500_000, month: 12, year: 2025});
    await spend(food.id, 100_000, at(2025, 12, 31));
    await spend(food.id, 100_000, at(2026, 1, 1));

    expect((await feature.getMonthSnapshot(2025, 12)).overall?.spent).toBe(
      100_000,
    );
    expect((await feature.getMonthSnapshot(2026, 1)).overall).toBeNull();
  });

  /* ------------------------- dashboard budget summary --------------------- */

  it('summarizes the current month for the dashboard', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 3_000_000, month: 9, year: 2026});
    await spend(food.id, 1_845_000, at(2026, 9, 7));

    const summary = await feature.getDashboardBudgetSummary(NOW);
    expect(summary).toEqual({
      year: 2026,
      month: 9,
      budget: 3_000_000,
      spent: 1_845_000,
      remaining: 1_155_000,
      percent: 61.5,
      state: 'ok',
    });
  });

  it('reports state none when the dashboard month has no budget', async () => {
    const [food] = await feature.listExpenseCategories();
    await spend(food.id, 100_000, at(2026, 9, 2));

    const summary = await feature.getDashboardBudgetSummary(NOW);
    expect(summary).toEqual({
      year: 2026,
      month: 9,
      budget: null,
      spent: 100_000,
      remaining: null,
      percent: null,
      state: 'none',
    });
  });

  it('dashboard summary flags exceeded budgets', async () => {
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 100_000, month: 9, year: 2026});
    await spend(food.id, 125_000, at(2026, 9, 7));

    const summary = await feature.getDashboardBudgetSummary(NOW);
    expect(summary).toMatchObject({
      spent: 125_000,
      remaining: -25_000,
      percent: 125,
      state: 'exceeded',
    });
  });

  it('dashboard summary works for months without expenses', async () => {
    await feature.saveOverallBudget({amount: 300_000, month: 9, year: 2026});
    const summary = await feature.getDashboardBudgetSummary(NOW);
    expect(summary).toMatchObject({
      budget: 300_000,
      spent: 0,
      remaining: 300_000,
      percent: 0,
      state: 'ok',
    });
  });

  it('dashboard summary derives the month from the injected now', async () => {
    // August 2026 has its own budget and spending.
    const [food] = await feature.listExpenseCategories();
    await feature.saveOverallBudget({amount: 200_000, month: 8, year: 2026});
    await spend(food.id, 170_000, at(2026, 8, 20)); // 85% -> warning

    const augustNow = new Date(2026, 7, 25, 10).getTime();
    const summary = await feature.getDashboardBudgetSummary(augustNow);
    expect(summary).toMatchObject({
      year: 2026,
      month: 8,
      budget: 200_000,
      spent: 170_000,
      state: 'warning',
    });
  });
});
