/**
 * @jest-environment node
 */
import {DatabaseService} from '../service';
import {
  createTestCategory,
  createTestExpense,
  createTestService,
  T1,
  T2,
  T3,
} from '../testing/helpers';
import {ValidationError} from '../errors';
import {processDueRecurringTransactions} from '@/features/recurring/processing';
import {atNoon} from '@/utils/date';

describe('ExpenseRepository — search, joins and aggregates', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('search filter', () => {
    let percentOff: number;
    let underscore: number;
    let plain: number;

    beforeEach(async () => {
      percentOff = (
        await createTestExpense(service, {title: '50% off sale', note: null})
      ).id;
      underscore = (await createTestExpense(service, {title: 'a_b ticket'})).id;
      // A near-miss sibling that a wildcard-blind search would wrongly match.
      await createTestExpense(service, {title: 'axb ticket'});
      plain = (await createTestExpense(service, {title: 'plain tea'})).id;
    });

    it('matches substrings of the title, case-insensitively', async () => {
      const rows = await service.expenses.list({search: 'PLAIN'});
      expect(rows.map(r => r.id)).toEqual([plain]);
    });

    it('matches the note as well as the title', async () => {
      await createTestExpense(service, {title: 'Taxi', note: 'office commute'});
      const rows = await service.expenses.list({search: 'COMMUTE'});
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Taxi');
    });

    it('treats LIKE wildcards literally', async () => {
      // % must not act as a wildcard: searching "50%" finds only the
      // "50% off sale" row, not every row containing "50".
      const rows = await service.expenses.list({search: '50%'});
      expect(rows.map(r => r.id)).toEqual([percentOff]);

      // _ must not act as a single-char wildcard.
      const underscoreRows = await service.expenses.list({search: 'a_b'});
      expect(underscoreRows.map(r => r.id)).toEqual([underscore]);
    });

    it('ignores blank/whitespace searches', async () => {
      const all = await service.expenses.list();
      const blank = await service.expenses.list({search: ''});
      const spaces = await service.expenses.list({search: '   '});
      expect(blank).toHaveLength(all.length);
      expect(spaces).toHaveLength(all.length);
    });

    it('combines with other filters', async () => {
      const category = await createTestCategory(service);
      await createTestExpense(service, {
        title: 'chai',
        categoryId: category.id,
        date: T3,
      });
      const rows = await service.expenses.list({
        search: 'chai',
        categoryId: category.id,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe(T3);
    });

    it('applies to count() too', async () => {
      expect(await service.expenses.count({search: 'plain'})).toBe(1);
      expect(await service.expenses.count({search: 'zzz'})).toBe(0);
    });
  });

  describe('listWithCategory', () => {
    it('joins category name and icon onto every row', async () => {
      const food = await createTestCategory(service, {
        name: 'Street Food',
        icon: 'restaurant',
      });
      const a = await createTestExpense(service, {
        categoryId: food.id,
        date: T1,
      });
      const b = await createTestExpense(service, {
        categoryId: food.id,
        date: T2,
      });

      const rows = await service.expenses.listWithCategory();
      expect(rows.map(r => r.id)).toEqual([b.id, a.id]); // newest first
      for (const row of rows) {
        expect(row.categoryName).toBe('Street Food');
        expect(row.categoryIcon).toBe('restaurant');
        expect(row.amount).toBeGreaterThan(0);
      }
    });

    it('supports filters, ordering and pagination', async () => {
      const food = await createTestCategory(service);
      await createTestExpense(service, {categoryId: food.id, date: T1});
      await createTestExpense(service, {categoryId: food.id, date: T3});
      await createTestExpense(service, {date: T2});

      const rows = await service.expenses.listWithCategory({
        categoryId: food.id,
        order: 'dateAsc',
        limit: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe(T1);
      expect(rows[0].categoryName).toBe(food.name);
    });
  });

  describe('sumByCategory', () => {
    it('groups totals per category, largest first', async () => {
      // Names must not collide with the categories seeded by migration 001
      // (which include 'Food & Dining' and 'Transport').
      const food = await createTestCategory(service, {name: 'Snacks'});
      const transport = await createTestCategory(service, {name: 'Metro'});

      await createTestExpense(service, {
        categoryId: food.id,
        amount: 1_000,
        date: T1,
      });
      await createTestExpense(service, {
        categoryId: food.id,
        amount: 2_500,
        date: T2,
      });
      await createTestExpense(service, {
        categoryId: transport.id,
        amount: 1_800,
        date: T1,
      });
      await createTestExpense(service, {
        categoryId: transport.id,
        amount: 200,
        date: T3,
      });

      const totals = await service.expenses.sumByCategory();
      expect(totals).toEqual([
        {categoryId: food.id, total: 3_500},
        {categoryId: transport.id, total: 2_000},
      ]);
    });

    it('respects date and category filters', async () => {
      const food = await createTestCategory(service);
      await createTestExpense(service, {
        categoryId: food.id,
        amount: 1_000,
        date: T1,
      });
      await createTestExpense(service, {
        categoryId: food.id,
        amount: 5_000,
        date: T3,
      });

      const fromDate = await service.expenses.sumByCategory({fromDate: T2});
      expect(fromDate).toEqual([{categoryId: food.id, total: 5_000}]);

      const other = await createTestCategory(service);
      expect(
        await service.expenses.sumByCategory({categoryId: other.id}),
      ).toEqual([]);
    });

    it('returns nothing when the table is empty', async () => {
      expect(await service.expenses.sumByCategory()).toEqual([]);
    });
  });

  /* ------------------------ Phase 11: amount ranges ------------------------ */

  describe('amount range filter', () => {
    let tiny: number;
    let medium: number;
    let large: number;

    beforeEach(async () => {
      tiny = (await createTestExpense(service, {amount: 100})).id; // 1.00
      medium = (await createTestExpense(service, {amount: 50_005})).id; // 500.05
      large = (await createTestExpense(service, {amount: 9_999_99})).id; // 9999.99
    });

    it('filters by inclusive minimum', async () => {
      expect(
        (await service.expenses.list({minAmount: 50_005})).map(r => r.id),
      ).toEqual([medium, large].sort((a, b) => b - a));
      // Boundary: exactly the minimum matches.
      expect(
        (await service.expenses.list({minAmount: 9_999_99})).map(r => r.id),
      ).toEqual([large]);
    });

    it('filters by inclusive maximum', async () => {
      expect(
        (await service.expenses.list({maxAmount: 50_005})).map(r => r.id),
      ).toEqual([medium, tiny].sort((a, b) => b - a));
      expect(
        (await service.expenses.list({maxAmount: 99})).map(r => r.id),
      ).toEqual([]);
    });

    it('combines minimum and maximum', async () => {
      expect(
        (
          await service.expenses.list({minAmount: 101, maxAmount: 9_999_98})
        ).map(r => r.id),
      ).toEqual([medium]);
    });

    it('rejects invalid bounds at the parameter boundary', async () => {
      await expect(service.expenses.list({minAmount: 0})).rejects.toThrow(
        ValidationError,
      );
      await expect(service.expenses.list({maxAmount: -50})).rejects.toThrow(
        ValidationError,
      );
      await expect(
        service.expenses.list({minAmount: 1.5 as unknown as number}),
      ).rejects.toThrow(ValidationError);
    });

    it('combines the amount window with date and category filters', async () => {
      const category = await createTestCategory(service);
      const kept = await createTestExpense(service, {
        amount: 500_00,
        categoryId: category.id,
        date: T1,
      });
      await createTestExpense(service, {
        amount: 500_00,
        categoryId: category.id,
        date: T3, // right category+amount, wrong day
      });
      await createTestExpense(service, {
        amount: 50_00,
        categoryId: category.id,
        date: T1, // right day+category, too small
      });
      const rows = await service.expenses.list({
        minAmount: 100_00,
        maxAmount: 1_000_00,
        categoryId: category.id,
        fromDate: T1,
        toDate: T2,
      });
      expect(rows.map(r => r.id)).toEqual([kept.id]);
    });
  });

  /* ------------------------ Phase 11: recurring flag ----------------------- */

  describe('recurring filter', () => {
    let manualId: number;
    let generatedId: number;

    beforeEach(async () => {
      manualId = (await createTestExpense(service, {title: 'Manual tea'})).id;
      // A real rule + the generation engine produce a genuinely tagged row.
      const rule = await service.recurring.create({
        type: 'expense',
        amount: 12_000,
        title: 'Generated rent',
        categoryId: (await createTestCategory(service)).id,
        frequency: 'monthly',
        startDate: atNoon(2026, 9, 1),
        nextOccurrenceAt: atNoon(2026, 9, 1),
        paymentMethod: 'cash',
      });
      const result = await processDueRecurringTransactions(
        service,
        atNoon(2026, 9, 1),
      );
      expect(result.generatedExpenses).toBe(1);
      generatedId = (
        await service.expenses.list({search: 'Generated rent'})
      )[0]!.id;
      expect(rule.id).toBeGreaterThan(0);
    });

    it('recurring=true returns only rule-generated rows', async () => {
      const rows = await service.expenses.list({recurring: true});
      expect(rows.map(r => r.id)).toEqual([generatedId]);
    });

    it('recurring=false returns only manual rows', async () => {
      const rows = await service.expenses.list({recurring: false});
      expect(rows.map(r => r.id)).toEqual([manualId]);
    });

    it('undefined returns both', async () => {
      const rows = await service.expenses.list({});
      expect(rows).toHaveLength(2);
    });

    it('composes with amount windows', async () => {
      expect(
        (
          await service.expenses.list({recurring: false, minAmount: 1_000_000})
        ).map(r => r.id),
      ).toEqual([]);
      expect(
        (await service.expenses.list({recurring: true, minAmount: 1_000})).map(
          r => r.id,
        ),
      ).toEqual([generatedId]);
    });
  });

  /* ------------------------- Phase 11: amountAsc order --------------------- */

  describe('amountAsc ordering', () => {
    it('sorts ascending with a deterministic tie-break', async () => {
      const a = await createTestExpense(service, {amount: 500, date: T1});
      const b = await createTestExpense(service, {amount: 100, date: T1});
      const c = await createTestExpense(service, {amount: 500, date: T3});
      const rows = await service.expenses.list({order: 'amountAsc'});
      expect(rows.map(r => r.id)).toEqual([b.id, a.id, c.id]);
    });
  });

  /* -------------------- Phase 11: extended search fields ------------------- */

  describe('extended search — category name and payment method', () => {
    let foodCategory: {id: number; name: string};
    let chaiId: number;
    let cashId: number;

    beforeEach(async () => {
      foodCategory = await createTestCategory(service, {
        name: 'Street Food',
      });
      chaiId = (
        await createTestExpense(service, {
          title: 'Chai',
          categoryId: foodCategory.id,
          paymentMethod: 'cash',
        })
      ).id;
      cashId = (
        await createTestExpense(service, {
          title: 'Unrelated item',
          paymentMethod: 'cash',
        })
      ).id;
      await createTestExpense(service, {
        title: 'Card night',
        paymentMethod: 'card',
      });
      await createTestExpense(service, {
        title: 'Wire fee',
        paymentMethod: 'bank_transfer',
      });
    });

    it('matches the category name via the joined table', async () => {
      const rows = await service.expenses.list({search: 'street food'});
      expect(rows.map(r => r.id)).toEqual([chaiId]);
    });

    it('matches payment method values case-insensitively', async () => {
      expect(
        (await service.expenses.list({search: 'CASH'}))
          .sort((a, b) => a.id - b.id)
          .map(r => r.id),
      ).toEqual([chaiId, cashId].sort((a, b) => a - b));
      expect(
        (await service.expenses.list({search: 'bank'})).map(r => r.title),
      ).toEqual(['Wire fee']);
    });

    it('maps spaces to underscores for payment-method matching', async () => {
      // "bank transfer" (label-style) finds the bank_transfer rows.
      expect(
        (await service.expenses.list({search: 'bank transfer'})).map(
          r => r.title,
        ),
      ).toEqual(['Wire fee']);
    });

    it('normalizes whitespace in the search term', async () => {
      await createTestExpense(service, {title: 'Chai Latte', note: null});
      // A double space in the QUERY collapses to single, so it still finds
      // the single-spaced title (accidental typos never zero out results).
      expect(
        (await service.expenses.list({search: 'chai  latte'})).map(
          r => r.title,
        ),
      ).toEqual(['Chai Latte']);
      // Leading/trailing noise is ignored.
      expect(
        (await service.expenses.list({search: '   wire   '})).map(r => r.title),
      ).toEqual(['Wire fee']);
    });

    it('keeps count() consistent with list() for category-name matches', async () => {
      const rows = await service.expenses.list({search: 'Street Food'});
      const count = await service.expenses.count({search: 'Street Food'});
      expect(count).toBe(rows.length);
      expect(count).toBe(1);
    });

    it('keeps listWithCategory consistent with list() under search', async () => {
      const joined = await service.expenses.listWithCategory({
        search: 'unrelated',
      });
      const plain = await service.expenses.list({search: 'unrelated'});
      expect(joined.map(r => r.id)).toEqual(plain.map(r => r.id));
    });

    it('still escapes LIKE wildcards in the extended clauses', async () => {
      // '%' matches nothing: no title, note, category or payment value
      // contains a literal percent sign, and the escaped term cannot act
      // as a wildcard.
      expect(await service.expenses.list({search: '%'})).toEqual([]);
      // '_' IS a literal character of the `bank_transfer` enum value, so
      // a literal-underscore search finds exactly that row — the term is
      // matched as text, never as a single-char wildcard.
      expect(
        (await service.expenses.list({search: '_'})).map(r => r.title),
      ).toEqual(['Wire fee']);
    });
  });
});
