/**
 * @jest-environment node
 */
import {NotFoundError, ValidationError} from '../errors';
import {processDueRecurringTransactions} from '@/features/recurring/processing';
import type {Income} from '../models';
import {DatabaseService} from '../service';
import {
  createTestIncome,
  createTestService,
  T1,
  T2,
  T3,
} from '../testing/helpers';

describe('IncomeRepository', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('create + getById', () => {
    it('round-trips every field', async () => {
      const created = await service.income.create({
        amount: 500_000,
        source: 'Monthly salary',
        date: T1,
        note: 'September pay',
      });

      expect(created).toEqual({
        id: created.id,
        amount: 500_000,
        source: 'Monthly salary',
        date: T1,
        note: 'September pay',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        // Added by migration 004; manual rows are always null.
        recurringRuleId: null,
      });
      expect(await service.income.getById(created.id)).toEqual(created);
    });

    it('trims source and collapses blank notes to null', async () => {
      const created = await createTestIncome(service, {
        source: '  Freelance  ',
        note: ' ',
      });
      expect(created.source).toBe('Freelance');
      expect(created.note).toBeNull();
    });
  });

  describe('validation', () => {
    it.each([0, -1, 10.5])('rejects amount %p', async amount => {
      await expect(
        service.income.create({amount, source: 'X', date: T1}),
      ).rejects.toThrow(/amount/);
    });

    it('rejects empty sources', async () => {
      await expect(
        service.income.create({amount: 100, source: '', date: T1}),
      ).rejects.toThrow(/source/);
    });
  });

  describe('list / count / sumAmount', () => {
    let a: Income;
    let b: Income;
    let c: Income;

    beforeEach(async () => {
      a = await createTestIncome(service, {amount: 1_000, date: T1});
      b = await createTestIncome(service, {amount: 2_000, date: T2});
      c = await createTestIncome(service, {amount: 4_000, date: T3});
    });

    it('orders by date descending by default and supports asc', async () => {
      expect((await service.income.list()).map(r => r.id)).toEqual([
        c.id,
        b.id,
        a.id,
      ]);
      expect(
        (await service.income.list({order: 'dateAsc'})).map(r => r.id),
      ).toEqual([a.id, b.id, c.id]);
    });

    it('filters by inclusive date range and paginates', async () => {
      const rows = await service.income.list({fromDate: T2, toDate: T2});
      expect(rows.map(r => r.id)).toEqual([b.id]);

      const page = await service.income.list({limit: 2, offset: 1});
      expect(page.map(r => r.id)).toEqual([b.id, a.id]);

      expect(await service.income.count({toDate: T2})).toBe(2);
    });

    it('sums amounts', async () => {
      expect(await service.income.sumAmount()).toBe(7_000);
      expect(await service.income.sumAmount({fromDate: T2})).toBe(6_000);
    });
  });

  describe('update', () => {
    it('applies partial patches and bumps updatedAt', async () => {
      const created = await createTestIncome(service, {note: 'old'});
      const updated = await service.income.update(created.id, {
        amount: 9_000,
        note: null,
        source: 'Bonus',
      });
      expect(updated.amount).toBe(9_000);
      expect(updated.source).toBe('Bonus');
      expect(updated.note).toBeNull();
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it('throws NotFoundError for missing ids', async () => {
      await expect(
        service.income.update(999_999, {amount: 1}),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes once, then reports nothing to delete', async () => {
      const created = await createTestIncome(service);
      await expect(service.income.delete(created.id)).resolves.toBe(true);
      expect(await service.income.getById(created.id)).toBeNull();
      await expect(service.income.delete(created.id)).resolves.toBe(false);
    });
  });

  describe('search filter', () => {
    let percentBonus: number;
    let underscore: number;
    let plain: number;

    beforeEach(async () => {
      percentBonus = (
        await createTestIncome(service, {
          source: '50% bonus',
          note: null,
        })
      ).id;
      underscore = (await createTestIncome(service, {source: 'a_b payout'})).id;
      // A near-miss sibling that a wildcard-blind search would wrongly match.
      await createTestIncome(service, {source: 'axb payout'});
      plain = (await createTestIncome(service, {source: 'Monthly salary'})).id;
    });

    it('matches substrings of the source, case-insensitively', async () => {
      const rows = await service.income.list({search: 'SALARY'});
      expect(rows.map(r => r.id)).toEqual([plain]);
    });

    it('matches the note as well as the source', async () => {
      await createTestIncome(service, {
        source: 'Gift',
        note: 'birthday present',
      });
      const rows = await service.income.list({search: 'PRESENT'});
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('Gift');
    });

    it('treats LIKE wildcards literally', async () => {
      // % must not act as a wildcard: searching "50%" finds only the
      // "50% bonus" row, not every row containing "50".
      const rows = await service.income.list({search: '50%'});
      expect(rows.map(r => r.id)).toEqual([percentBonus]);

      // _ must not act as a single-char wildcard.
      const underscoreRows = await service.income.list({search: 'a_b'});
      expect(underscoreRows.map(r => r.id)).toEqual([underscore]);
    });

    it('ignores blank/whitespace searches', async () => {
      const all = await service.income.list();
      const blank = await service.income.list({search: ''});
      const spaces = await service.income.list({search: '   '});
      expect(blank).toHaveLength(all.length);
      expect(spaces).toHaveLength(all.length);
    });

    it('combines with date-range filters', async () => {
      const rows = await service.income.list({
        search: 'salary',
        fromDate: T1,
        toDate: T1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(plain);
      expect(
        await service.income.list({search: 'salary', fromDate: T2}),
      ).toEqual([]);
    });

    it('applies to count() and sumAmount() too', async () => {
      expect(await service.income.count({search: 'payout'})).toBe(2);
      expect(await service.income.sumAmount({search: 'a_b'})).toBe(100_000);
      expect(await service.income.count({search: 'zzz'})).toBe(0);
    });

    it('normalizes whitespace before matching (Phase 11)', async () => {
      await createTestIncome(service, {source: 'Side Gig', note: null});
      // Double space in the query collapses to single — still matches.
      expect(
        (await service.income.list({search: 'side  gig'})).map(r => r.source),
      ).toEqual(['Side Gig']);
    });
  });

  /* -------------------- Phase 11: amount ranges + recurring ----------------- */

  describe('amount range and recurring filters', () => {
    let small: number;
    let big: number;

    beforeEach(async () => {
      small = (await createTestIncome(service, {amount: 150_00})).id; // 150.00
      big = (await createTestIncome(service, {amount: 2500_00})).id; // 2500.00
    });

    it('filters by inclusive minimum', async () => {
      expect(
        (await service.income.list({minAmount: 150_00})).map(r => r.id),
      ).toEqual([big, small]);
      // Just above the small amount: only the big row remains.
      expect(
        (await service.income.list({minAmount: 150_01})).map(r => r.id),
      ).toEqual([big]);
    });

    it('filters by inclusive maximum', async () => {
      expect(
        (await service.income.list({maxAmount: 150_00})).map(r => r.id),
      ).toEqual([small]);
    });

    it('combines minimum and maximum', async () => {
      expect(
        (
          await service.income.list({minAmount: 150_01, maxAmount: 2500_00})
        ).map(r => r.id),
      ).toEqual([big]);
    });

    it('rejects invalid bounds at the parameter boundary', async () => {
      await expect(service.income.list({minAmount: 0})).rejects.toThrow(
        ValidationError,
      );
      await expect(service.income.list({maxAmount: -1})).rejects.toThrow(
        ValidationError,
      );
    });

    it('sorts by amountAsc with a deterministic tie-break', async () => {
      const tied = await createTestIncome(service, {amount: 150_00, date: T2});
      const rows = await service.income.list({order: 'amountAsc'});
      expect(rows.map(r => r.id)).toEqual([small, tied.id, big]);
    });

    it('recurring=true/false separates rule-generated from manual rows', async () => {
      const rule = await service.recurring.create({
        type: 'income',
        amount: 90_000,
        title: 'Consulting retainer',
        frequency: 'monthly',
        startDate: T2,
        nextOccurrenceAt: T2,
      });
      const result = await processDueRecurringTransactions(service, T2);
      expect(result.generatedIncome).toBe(1);

      const recurring = await service.income.list({recurring: true});
      expect(recurring.map(r => r.recurringRuleId)).toEqual([rule.id]);

      const manual = await service.income.list({recurring: false});
      expect(manual.map(r => r.id)).toEqual([big, small]);
      expect(manual.every(r => r.recurringRuleId == null)).toBe(true);
      void rule;
    });
  });
});
