/**
 * @jest-environment node
 */
import {NotFoundError} from '../errors';
import {DatabaseService} from '../service';
import {createTestService} from '../testing/helpers';

describe('MonthlyBudgetRepository', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates and finds the overall budget for a period', async () => {
    const created = await service.monthlyBudgets.create({
      amount: 300_000, // Rs. 3,000.00 in minor units
      month: 9,
      year: 2026,
    });

    expect(created).toEqual({
      id: created.id,
      amount: 300_000,
      month: 9,
      year: 2026,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(await service.monthlyBudgets.find(9, 2026)).toEqual(created);
    expect(await service.monthlyBudgets.getById(created.id)).toEqual(created);
  });

  it('returns null when no budget exists for the period', async () => {
    expect(await service.monthlyBudgets.find(9, 2026)).toBeNull();
    expect(await service.monthlyBudgets.getById(999_999)).toBeNull();
  });

  it('rejects a second budget for the same period', async () => {
    await service.monthlyBudgets.create({
      amount: 300_000,
      month: 9,
      year: 2026,
    });
    await expect(
      service.monthlyBudgets.create({amount: 400_000, month: 9, year: 2026}),
    ).rejects.toThrow(/UNIQUE|failed/i);
  });

  describe('upsert', () => {
    it('updates the amount in place when the period already has a budget', async () => {
      const original = await service.monthlyBudgets.create({
        amount: 300_000,
        month: 9,
        year: 2026,
      });

      const upserted = await service.monthlyBudgets.upsert({
        amount: 350_000,
        month: 9,
        year: 2026,
      });

      expect(upserted.id).toBe(original.id);
      expect(upserted.amount).toBe(350_000);
      expect(upserted.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);
      expect(await service.monthlyBudgets.find(9, 2026)).toEqual(upserted);
    });

    it('creates a new row for a different period', async () => {
      const first = await service.monthlyBudgets.upsert({
        amount: 300_000,
        month: 9,
        year: 2026,
      });
      const second = await service.monthlyBudgets.upsert({
        amount: 280_000,
        month: 10,
        year: 2026,
      });

      expect(second.id).not.toBe(first.id);
      expect((await service.monthlyBudgets.find(9, 2026))?.amount).toBe(
        300_000,
      );
      expect((await service.monthlyBudgets.find(10, 2026))?.amount).toBe(
        280_000,
      );
    });
  });

  it('lists nothing — month listings live on the category repository', async () => {
    // Sanity: separate months stay isolated.
    await service.monthlyBudgets.create({
      amount: 100_000,
      month: 1,
      year: 2026,
    });
    expect(await service.monthlyBudgets.find(2, 2026)).toBeNull();
  });

  it.each([{month: 0}, {month: 13}, {year: 1999}, {year: 2101}])(
    'rejects invalid periods %p',
    async ({month, year}) => {
      await expect(
        service.monthlyBudgets.create({
          amount: 1_000,
          month: month ?? 1,
          year: year ?? 2026,
        }),
      ).rejects.toThrow(/month|year/);
    },
  );

  it.each([0, -10, 5.5])('rejects amount %p', async amount => {
    await expect(
      service.monthlyBudgets.create({amount, month: 1, year: 2026}),
    ).rejects.toThrow(/amount/);
  });

  describe('update', () => {
    it('applies partial patches', async () => {
      const created = await service.monthlyBudgets.create({
        amount: 100_000,
        month: 3,
        year: 2026,
      });
      const updated = await service.monthlyBudgets.update(created.id, {
        amount: 150_000,
        month: 4,
      });
      expect(updated).toMatchObject({amount: 150_000, month: 4, year: 2026});
      // The old period is now free.
      expect(await service.monthlyBudgets.find(3, 2026)).toBeNull();
    });

    it('throws NotFoundError for missing ids', async () => {
      await expect(
        service.monthlyBudgets.update(999_999, {amount: 1}),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes a row and reports false for a missing id', async () => {
      const budget = await service.monthlyBudgets.create({
        amount: 100_000,
        month: 1,
        year: 2026,
      });

      await expect(service.monthlyBudgets.delete(budget.id)).resolves.toBe(
        true,
      );
      expect(await service.monthlyBudgets.find(1, 2026)).toBeNull();
      await expect(service.monthlyBudgets.delete(budget.id)).resolves.toBe(
        false,
      );
    });
  });
});
