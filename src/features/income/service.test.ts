/**
 * @jest-environment node
 */
import {createIncomeFeature} from './service';
import type {IncomeFeature} from './service';
import {DatabaseService} from '@/database/service';
import {createTestService} from '@/database/testing/helpers';

describe('IncomeFeature', () => {
  let service: DatabaseService;
  let feature: IncomeFeature;

  beforeEach(async () => {
    service = await createTestService();
    feature = createIncomeFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  /* ------------------------------ categories ----------------------------- */

  it('lists the seeded income categories for the source picker', async () => {
    const categories = await feature.listCategories();
    // Seeded by migration 001.
    expect(categories.length).toBeGreaterThanOrEqual(6);
    expect(categories.every(c => c.type === 'income')).toBe(true);
    const names = categories.map(c => c.name);
    expect(names).toContain('Salary');
    expect(names).toContain('Freelance');
    expect(names).toContain('Gift');
    // Expense categories must never leak into the income picker.
    expect(names).not.toContain('Food & Dining');
  });

  it('still allows listing other category types explicitly', async () => {
    const expenses = await feature.listCategories('expense');
    expect(expenses.every(c => c.type === 'expense')).toBe(true);
  });

  /* --------------------------- create/read flows -------------------------- */

  it('creates, reads and round-trips an income record', async () => {
    const created = await feature.addIncome({
      amount: 300_000,
      source: 'Salary',
      date: new Date(2026, 8, 1, 9, 0).getTime(),
      note: 'September pay',
    });

    const loaded = await feature.getIncome(created.id);
    expect(loaded).toEqual(created);
  });

  it('returns null for a missing income record', async () => {
    expect(await feature.getIncome(999_999)).toBeNull();
  });

  /* ---------------------------- update + delete --------------------------- */

  it('updates an income, preserving createdAt and bumping updatedAt', async () => {
    const created = await feature.addIncome({
      amount: 150_000,
      source: 'Freelance',
      date: Date.now(),
      note: null,
    });

    const updated = await feature.editIncome(created.id, {
      amount: 175_000,
      source: 'Salary',
      note: 'Adjusted',
    });

    expect(updated.amount).toBe(175_000);
    expect(updated.source).toBe('Salary');
    expect(updated.note).toBe('Adjusted');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('deletes an income exactly once', async () => {
    const created = await feature.addIncome({
      amount: 5_000,
      source: 'Gift',
      date: Date.now(),
    });

    expect(await feature.removeIncome(created.id)).toBe(true);
    expect(await feature.getIncome(created.id)).toBeNull();
    expect(await feature.removeIncome(created.id)).toBe(false);
  });
});
