/**
 * @jest-environment node
 */
import {NotFoundError} from '../errors';
import {DatabaseService} from '../service';
import {createTestCategory, createTestService} from '../testing/helpers';

describe('BudgetRepository', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates and finds a budget by category + period', async () => {
    const category = await createTestCategory(service);
    const created = await service.budgets.create({
      categoryId: category.id,
      amount: 20_000,
      month: 9,
      year: 2026,
    });

    expect(created).toEqual({
      id: created.id,
      categoryId: category.id,
      amount: 20_000,
      month: 9,
      year: 2026,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(await service.budgets.find(category.id, 9, 2026)).toEqual(created);
    expect(await service.budgets.getById(created.id)).toEqual(created);
  });

  it('rejects a second budget for the same category + period', async () => {
    const category = await createTestCategory(service);
    await service.budgets.create({
      categoryId: category.id,
      amount: 20_000,
      month: 9,
      year: 2026,
    });
    await expect(
      service.budgets.create({
        categoryId: category.id,
        amount: 30_000,
        month: 9,
        year: 2026,
      }),
    ).rejects.toThrow(/UNIQUE|failed/i);
  });

  describe('upsert', () => {
    it('updates the amount in place when the period already has a budget', async () => {
      const category = await createTestCategory(service);
      const original = await service.budgets.create({
        categoryId: category.id,
        amount: 20_000,
        month: 9,
        year: 2026,
      });

      const upserted = await service.budgets.upsert({
        categoryId: category.id,
        amount: 35_000,
        month: 9,
        year: 2026,
      });

      expect(upserted.id).toBe(original.id);
      expect(upserted.amount).toBe(35_000);
      expect(upserted.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);
      expect(await service.budgets.listByMonth(9, 2026)).toHaveLength(1);
    });

    it('creates a new row for a different period', async () => {
      const category = await createTestCategory(service);
      const first = await service.budgets.upsert({
        categoryId: category.id,
        amount: 20_000,
        month: 9,
        year: 2026,
      });
      const second = await service.budgets.upsert({
        categoryId: category.id,
        amount: 25_000,
        month: 10,
        year: 2026,
      });
      expect(second.id).not.toBe(first.id);
      expect(await service.budgets.listByMonth(10, 2026)).toHaveLength(1);
    });
  });

  it('lists a month joined with category info, ordered by category name', async () => {
    const zCategory = await createTestCategory(service, {name: 'Zebra'});
    const aCategory = await createTestCategory(service, {name: 'Apple'});
    await service.budgets.create({
      categoryId: zCategory.id,
      amount: 1_000,
      month: 1,
      year: 2026,
    });
    await service.budgets.create({
      categoryId: aCategory.id,
      amount: 2_000,
      month: 1,
      year: 2026,
    });

    const rows = await service.budgets.listByMonth(1, 2026);
    expect(rows.map(r => r.categoryName)).toEqual(['Apple', 'Zebra']);
    expect(rows[0]).toMatchObject({
      categoryId: aCategory.id,
      amount: 2_000,
      month: 1,
      year: 2026,
      categoryName: 'Apple',
      categoryIcon: aCategory.icon,
    });
    // Other months are excluded.
    expect(await service.budgets.listByMonth(2, 2026)).toEqual([]);
  });

  it('only accepts expense categories', async () => {
    const incomeCategory = await createTestCategory(service, {type: 'income'});
    await expect(
      service.budgets.create({
        categoryId: incomeCategory.id,
        amount: 1_000,
        month: 1,
        year: 2026,
      }),
    ).rejects.toThrow(/not an expense category/);
  });

  it.each([{month: 0}, {month: 13}, {year: 1999}, {year: 2101}])(
    'rejects invalid periods %p',
    async ({month, year}) => {
      const category = await createTestCategory(service);
      await expect(
        service.budgets.create({
          categoryId: category.id,
          amount: 1_000,
          month: month ?? 1,
          year: year ?? 2026,
        }),
      ).rejects.toThrow(/month|year/);
    },
  );

  it.each([0, -10, 5.5])('rejects amount %p', async amount => {
    const category = await createTestCategory(service);
    await expect(
      service.budgets.create({
        categoryId: category.id,
        amount,
        month: 1,
        year: 2026,
      }),
    ).rejects.toThrow(/amount/);
  });

  describe('update', () => {
    it('applies partial patches', async () => {
      const category = await createTestCategory(service);
      const created = await service.budgets.create({
        categoryId: category.id,
        amount: 10_000,
        month: 3,
        year: 2026,
      });
      const updated = await service.budgets.update(created.id, {
        amount: 15_000,
        month: 4,
      });
      expect(updated).toMatchObject({amount: 15_000, month: 4, year: 2026});
    });

    it('throws NotFoundError for missing ids', async () => {
      await expect(
        service.budgets.update(999_999, {amount: 1}),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes a single row and reports the count for category sweeps', async () => {
      const category = await createTestCategory(service);
      const budget = await service.budgets.create({
        categoryId: category.id,
        amount: 1_000,
        month: 1,
        year: 2026,
      });
      await service.budgets.create({
        categoryId: category.id,
        amount: 2_000,
        month: 2,
        year: 2026,
      });

      await expect(service.budgets.delete(budget.id)).resolves.toBe(true);
      expect(await service.budgets.deleteByCategory(category.id)).toBe(1);
      await expect(service.budgets.delete(budget.id)).resolves.toBe(false);
    });
  });
});
