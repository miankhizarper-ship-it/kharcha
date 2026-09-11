/**
 * @jest-environment node
 */
import {NotFoundError} from '../errors';
import type {Expense} from '../models';
import {DatabaseService} from '../service';
import {
  createTestCategory,
  createTestExpense,
  createTestService,
  T0,
  T1,
  T2,
  T3,
} from '../testing/helpers';

describe('ExpenseRepository', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('create + getById', () => {
    it('round-trips every field', async () => {
      const category = await createTestCategory(service);
      const created = await service.expenses.create({
        amount: 123_456,
        title: 'Chai and paratha',
        categoryId: category.id,
        date: T1,
        paymentMethod: 'cash',
        note: 'Breakfast',
      });

      expect(created.id).toBeGreaterThan(0);
      expect(created).toEqual({
        id: created.id,
        amount: 123_456,
        title: 'Chai and paratha',
        categoryId: category.id,
        date: T1,
        paymentMethod: 'cash',
        note: 'Breakfast',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        // Added by migration 004; manual rows are always null.
        recurringRuleId: null,
      });
      expect(created.updatedAt).toBeGreaterThanOrEqual(created.createdAt);

      expect(await service.expenses.getById(created.id)).toEqual(created);
    });

    it('defaults missing note to null and trims strings', async () => {
      const category = await createTestCategory(service);
      const created = await service.expenses.create({
        amount: 100,
        title: '  Rickshaw  ',
        categoryId: category.id,
        date: T1,
        paymentMethod: 'other',
        note: '   ',
      });

      expect(created.title).toBe('Rickshaw');
      expect(created.note).toBeNull();
    });

    it('assigns distinct ids for consecutive inserts', async () => {
      const first = await createTestExpense(service);
      const second = await createTestExpense(service);
      expect(second.id).toBeGreaterThan(first.id);
      expect(await service.expenses.count()).toBe(2);
    });
  });

  describe('validation', () => {
    it.each([0, -5, 1.5, Number.NaN])('rejects amount %p', async amount => {
      const category = await createTestCategory(service);
      await expect(
        service.expenses.create({
          amount,
          title: 'Bad amount',
          categoryId: category.id,
          date: T1,
          paymentMethod: 'cash',
        }),
      ).rejects.toThrow(/amount/);
    });

    it('rejects empty titles and unknown/income categories', async () => {
      const category = await createTestCategory(service);
      const incomeCategory = await createTestCategory(service, {
        type: 'income',
      });

      await expect(
        service.expenses.create({
          amount: 100,
          title: '   ',
          categoryId: category.id,
          date: T1,
          paymentMethod: 'cash',
        }),
      ).rejects.toThrow(/title/);

      await expect(
        service.expenses.create({
          amount: 100,
          title: 'X',
          categoryId: 999_999,
          date: T1,
          paymentMethod: 'cash',
        }),
      ).rejects.toThrow(/categoryId/);

      await expect(
        service.expenses.create({
          amount: 100,
          title: 'X',
          categoryId: incomeCategory.id,
          date: T1,
          paymentMethod: 'cash',
        }),
      ).rejects.toThrow(/not an expense category/);
    });
  });

  describe('list', () => {
    let groceries: Awaited<ReturnType<typeof createTestCategory>>;
    let transport: Awaited<ReturnType<typeof createTestCategory>>;
    let a: Expense;
    let b: Expense;
    let c: Expense;

    beforeEach(async () => {
      groceries = await createTestCategory(service, {name: 'Market'});
      transport = await createTestCategory(service, {name: 'Metro'});
      a = await createTestExpense(service, {
        amount: 1_000,
        categoryId: groceries.id,
        date: T1,
        paymentMethod: 'cash',
      });
      b = await createTestExpense(service, {
        amount: 2_000,
        categoryId: transport.id,
        date: T2,
        paymentMethod: 'card',
      });
      c = await createTestExpense(service, {
        amount: 3_000,
        categoryId: groceries.id,
        date: T3,
        paymentMethod: 'cash',
      });
    });

    it('orders by date descending by default', async () => {
      const rows = await service.expenses.list();
      expect(rows.map(r => r.id)).toEqual([c.id, b.id, a.id]);
    });

    it('supports ascending order', async () => {
      const rows = await service.expenses.list({order: 'dateAsc'});
      expect(rows.map(r => r.id)).toEqual([a.id, b.id, c.id]);
    });

    it('filters by category', async () => {
      const rows = await service.expenses.list({categoryId: groceries.id});
      expect(rows.map(r => r.id).sort()).toEqual([a.id, c.id].sort());
    });

    it('filters by payment method', async () => {
      const rows = await service.expenses.list({paymentMethod: 'card'});
      expect(rows.map(r => r.id)).toEqual([b.id]);
    });

    it('filters by inclusive date range', async () => {
      const rows = await service.expenses.list({fromDate: T1, toDate: T2});
      expect(rows.map(r => r.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('combines filters and paginates', async () => {
      const page = await service.expenses.list({
        categoryId: groceries.id,
        limit: 1,
        offset: 1,
        order: 'dateAsc',
      });
      expect(page.map(r => r.id)).toEqual([c.id]);
      expect(await service.expenses.count({categoryId: groceries.id})).toBe(2);
    });

    it('supports offset without limit', async () => {
      const rows = await service.expenses.list({offset: 1});
      expect(rows.map(r => r.id)).toEqual([b.id, a.id]);
    });

    it('sums amounts with filters', async () => {
      expect(await service.expenses.sumAmount()).toBe(6_000);
      expect(await service.expenses.sumAmount({categoryId: groceries.id})).toBe(
        4_000,
      );
      expect(await service.expenses.sumAmount({fromDate: T2})).toBe(5_000);
      expect(
        await service.expenses.sumAmount({fromDate: T0 + 10 * 86400000}),
      ).toBe(0);
    });
  });

  describe('update', () => {
    it('applies a partial patch and bumps updatedAt only', async () => {
      const created = await createTestExpense(service, {note: 'before'});
      const before = created.updatedAt;

      const updated = await service.expenses.update(created.id, {
        amount: 9_999,
        note: null,
      });

      expect(updated.amount).toBe(9_999);
      expect(updated.note).toBeNull();
      expect(updated.title).toBe(created.title);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('rejects moving an expense onto an income category', async () => {
      const created = await createTestExpense(service);
      const incomeCategory = await createTestCategory(service, {
        type: 'income',
      });
      await expect(
        service.expenses.update(created.id, {categoryId: incomeCategory.id}),
      ).rejects.toThrow(/not an expense category/);
    });

    it('throws NotFoundError for a missing id', async () => {
      await expect(
        service.expenses.update(999_999, {amount: 1}),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the row unchanged for an empty patch (still verifies existence)', async () => {
      const created = await createTestExpense(service);
      const same = await service.expenses.update(created.id, {});
      expect(same).toEqual(created);
      await expect(service.expenses.update(999_999, {})).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('delete', () => {
    it('deletes once, then reports nothing to delete', async () => {
      const created = await createTestExpense(service);
      await expect(service.expenses.delete(created.id)).resolves.toBe(true);
      expect(await service.expenses.getById(created.id)).toBeNull();
      await expect(service.expenses.delete(created.id)).resolves.toBe(false);
    });
  });
});
