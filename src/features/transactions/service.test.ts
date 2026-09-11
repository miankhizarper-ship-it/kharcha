/**
 * @jest-environment node
 */
import {createTransactionsFeature} from './service';
import type {TransactionsFeature} from './service';
import type {TransactionItem} from './types';
import {DASHBOARD_RECENT_LIMIT} from '@/features/expenses/types';
import {
  PAYMENT_METHODS,
  type Expense,
  type Income,
  type PaymentMethod,
} from '@/database/models';
import {DatabaseService} from '@/database/service';
import {createTestService} from '@/database/testing/helpers';
import {
  atNoon,
  DAY_MS,
  endOfMonth,
  monthBounds,
  previousMonth,
  startOfDay,
  startOfMonth,
  weekBounds,
} from '@/utils/date';
import {processDueRecurringTransactions} from '@/features/recurring/processing';

/**
 * Fixed local timestamps so period windows are deterministic regardless of
 * the timezone the test process runs in.
 */
const NOW = new Date(2026, 8, 7, 15, 30).getTime(); // Sep 7 2026, 15:30
const TODAY_EARLIER = new Date(2026, 8, 7, 8, 0).getTime();
const YESTERDAY = new Date(2026, 8, 6, 12, 0).getTime();
const LAST_MONTH = new Date(2026, 7, 15, 12, 0).getTime();

describe('TransactionsFeature (combined expense + income)', () => {
  let service: DatabaseService;
  let feature: TransactionsFeature;
  let foodId: number;

  beforeEach(async () => {
    service = await createTestService();
    feature = createTransactionsFeature(service);

    const categories = await service.categories.list('expense');
    const food = categories.find(c => c.name === 'Food & Dining');
    if (!food) {
      throw new Error('Expected seeded expense categories to exist');
    }
    foodId = food.id;
  });

  afterEach(async () => {
    await service.close();
  });

  async function addExpense(
    input: {
      amount?: number;
      title?: string;
      date?: number;
      note?: string | null;
    } = {},
  ): Promise<Expense> {
    return service.expenses.create({
      amount: input.amount ?? 1_000,
      title: input.title ?? 'Test expense',
      categoryId: foodId,
      date: input.date ?? TODAY_EARLIER,
      paymentMethod: 'cash',
      note: input.note ?? null,
    });
  }

  async function addIncome(
    input: {
      amount?: number;
      source?: string;
      date?: number;
      note?: string | null;
    } = {},
  ): Promise<Income> {
    return service.income.create({
      amount: input.amount ?? 1_000,
      source: input.source ?? 'Salary',
      date: input.date ?? TODAY_EARLIER,
      note: input.note ?? null,
    });
  }

  /* ------------------------------ mixed listing ---------------------------- */

  describe('getTransactionPage', () => {
    it('merges expenses and income into one date-descending stream', async () => {
      const newest = await addIncome({source: 'Salary', date: NOW});
      const middle = await addExpense({title: 'Dinner', date: TODAY_EARLIER});
      const older = await addIncome({source: 'Gift', date: YESTERDAY});
      const oldest = await addExpense({title: 'Rent', date: LAST_MONTH});

      const page = await feature.getTransactionPage({
        pageSize: 10,
        page: 0,
      });

      expect(page.items.map(i => i.key)).toEqual([
        `income-${newest.id}`,
        `expense-${middle.id}`,
        `income-${older.id}`,
        `expense-${oldest.id}`,
      ]);
    });

    it('normalizes both sides into the shared view model', async () => {
      await addExpense({title: 'Dinner', amount: 5_000, note: 'with friends'});
      await addIncome({source: 'Salary', amount: 300_000, note: 'pay day'});

      const page = await feature.getTransactionPage({pageSize: 10});
      const [expenseRow, incomeRow] = page.items;

      expect(expenseRow).toMatchObject({
        type: 'expense',
        title: 'Dinner',
        category: 'Food & Dining',
        icon: 'restaurant',
        paymentMethod: 'cash',
        note: 'with friends',
        amount: 5_000,
      });
      // 'Salary' resolves to the seeded income category's icon.
      expect(incomeRow).toMatchObject({
        type: 'income',
        title: 'Salary',
        category: null,
        icon: 'briefcase',
        note: 'pay day',
        amount: 300_000,
      });
      expect(expenseRow?.key).toMatch(/^expense-\d+$/);
      expect(incomeRow?.key).toMatch(/^income-\d+$/);
    });

    it('falls back to a default icon for unknown income sources', async () => {
      await addIncome({source: 'Mystery windfall'});
      const page = await feature.getTransactionPage({pageSize: 10});
      expect(page.items[0].icon).toBe('cash');
    });

    it('filters by transaction type', async () => {
      await addExpense({title: 'Tea'});
      await addIncome({source: 'Freelance'});

      const expensesOnly = await feature.getTransactionPage({
        type: 'expense',
        pageSize: 10,
      });
      expect(expensesOnly.items.map(i => i.type)).toEqual(['expense']);
      expect(expensesOnly.items[0].title).toBe('Tea');

      const incomeOnly = await feature.getTransactionPage({
        type: 'income',
        pageSize: 10,
      });
      expect(incomeOnly.items.map(i => i.type)).toEqual(['income']);
      expect(incomeOnly.items[0].title).toBe('Freelance');
    });

    it('searches expense title/note and income source/note', async () => {
      await addExpense({title: 'Chai', note: null});
      await addExpense({title: 'Bus', note: 'office commute'});
      await addIncome({source: 'Monthly salary'});
      await addIncome({source: 'Gift', note: 'birthday present'});

      expect(
        (await feature.getTransactionPage({search: 'chai'})).items.map(
          i => i.title,
        ),
      ).toEqual(['Chai']);
      expect(
        (await feature.getTransactionPage({search: 'OFFICE'})).items.map(
          i => i.title,
        ),
      ).toEqual(['Bus']);
      expect(
        (await feature.getTransactionPage({search: 'salary'})).items.map(
          i => i.title,
        ),
      ).toEqual(['Monthly salary']);
      expect(
        (await feature.getTransactionPage({search: 'birthday'})).items.map(
          i => i.title,
        ),
      ).toEqual(['Gift']);
      expect(
        (await feature.getTransactionPage({search: 'zzz-not-there'})).items,
      ).toEqual([]);
    });

    it('excludes income rows while a category filter is active', async () => {
      await addExpense({title: 'Dinner'});
      await addIncome({source: 'Salary'});

      const page = await feature.getTransactionPage({
        categoryId: foodId,
        pageSize: 10,
      });
      expect(page.items.map(i => i.type)).toEqual(['expense']);
      expect(page.items[0].category).toBe('Food & Dining');
    });

    it('applies period windows to both types', async () => {
      await addExpense({title: 'In month', date: YESTERDAY});
      await addIncome({source: 'In month', date: YESTERDAY});
      await addExpense({title: 'Old expense', date: LAST_MONTH});
      await addIncome({source: 'Old income', date: LAST_MONTH});

      const month = await feature.getTransactionPage({
        period: 'thisMonth',
        pageSize: 10,
      });
      expect(month.items.map(i => i.title)).toEqual(['In month', 'In month']);

      const all = await feature.getTransactionPage({pageSize: 10});
      expect(all.items).toHaveLength(4);
    });

    /* ------------------------------ pagination ----------------------------- */

    it('pages the merged stream even when one table vastly outnumbers the other', async () => {
      // Five expenses interleaved in time plus ONE income older than all of
      // them. Naive per-source page offsets would never surface the income.
      const income = await addIncome({source: 'Old gift', date: YESTERDAY});
      const expenses: Expense[] = [];
      for (let i = 0; i < 5; i++) {
        expenses.push(
          await addExpense({
            title: `Expense ${i}`,
            date: YESTERDAY + (i + 1) * 60_000,
          }),
        );
      }

      const page0 = await feature.getTransactionPage({pageSize: 2, page: 0});
      expect(page0.items.map(i => i.key)).toEqual([
        `expense-${expenses[4].id}`,
        `expense-${expenses[3].id}`,
      ]);
      expect(page0.hasMore).toBe(true);

      const page1 = await feature.getTransactionPage({pageSize: 2, page: 1});
      expect(page1.items.map(i => i.key)).toEqual([
        `expense-${expenses[2].id}`,
        `expense-${expenses[1].id}`,
      ]);
      expect(page1.hasMore).toBe(true);

      const page2 = await feature.getTransactionPage({pageSize: 2, page: 2});
      expect(page2.items.map(i => i.key)).toEqual([
        `expense-${expenses[0].id}`,
        `income-${income.id}`,
      ]);
      expect(page2.hasMore).toBe(false);
    });

    it('reports hasMore correctly at exact page boundaries', async () => {
      await addExpense({title: 'E1'});
      await addExpense({title: 'E2'});
      await addIncome({source: 'I1'});
      await addIncome({source: 'I2'});

      const page0 = await feature.getTransactionPage({pageSize: 2, page: 0});
      expect(page0.items).toHaveLength(2);
      expect(page0.hasMore).toBe(true);

      const page1 = await feature.getTransactionPage({pageSize: 2, page: 1});
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(false);
    });

    it('keeps paging deterministic while loading more', async () => {
      for (let i = 0; i < 7; i++) {
        await addExpense({title: `E${i}`, date: YESTERDAY + i * 60_000});
        if (i % 2 === 0) {
          await addIncome({source: `I${i}`, date: YESTERDAY + i * 60_000 + 1});
        }
      }

      const collected: string[] = [];
      let page = 0;
      for (;;) {
        const result = await feature.getTransactionPage({
          pageSize: 3,
          page,
        });
        collected.push(...result.items.map(i => i.key));
        if (!result.hasMore) {
          break;
        }
        page++;
      }

      expect(collected).toHaveLength(11); // 7 expenses + 4 incomes
      expect(new Set(collected).size).toBe(11); // no duplicates, no skips
    });

    it('clamps a negative page to the first page', async () => {
      await addExpense({});
      const page = await feature.getTransactionPage({page: -5, pageSize: 10});
      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(false);
    });
  });

  /* ------------------------------- dashboard ------------------------------- */

  describe('getDashboardSnapshot', () => {
    it('computes income, spending and balance for today and the month', async () => {
      await addIncome({amount: 300_000, source: 'Salary', date: TODAY_EARLIER});
      await addExpense({amount: 50_000, title: 'Lunch', date: TODAY_EARLIER});
      await addExpense({amount: 70_000, title: 'Taxi', date: NOW});
      await addExpense({amount: 30_000, title: 'Groceries', date: YESTERDAY});
      // Outside the month window on both sides.
      await addIncome({amount: 100_000, source: 'Bonus', date: LAST_MONTH});
      await addExpense({amount: 100_000, title: 'Old rent', date: LAST_MONTH});

      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.todayIncome).toBe(300_000);
      expect(snapshot.todayExpense).toBe(120_000);
      expect(snapshot.todayBalance).toBe(180_000);
      expect(snapshot.monthIncome).toBe(300_000);
      expect(snapshot.monthExpense).toBe(150_000);
      expect(snapshot.monthBalance).toBe(150_000);
    });

    it('goes negative when spending exceeds income', async () => {
      await addExpense({amount: 500_000, title: 'Big purchase'});
      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.todayIncome).toBe(0);
      expect(snapshot.todayExpense).toBe(500_000);
      expect(snapshot.todayBalance).toBe(-500_000);
      expect(snapshot.monthBalance).toBe(-500_000);
    });

    it('ranks month category totals from expenses only', async () => {
      await addExpense({amount: 50_000, title: 'Lunch'});
      await addIncome({amount: 900_000, source: 'Salary'});

      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.categoryTotals).toEqual([
        {
          categoryId: foodId,
          name: 'Food & Dining',
          icon: 'restaurant',
          total: 50_000,
        },
      ]);
    });

    it('lists recent transactions of both types, newest first, capped', async () => {
      for (let i = 0; i < DASHBOARD_RECENT_LIMIT + 1; i++) {
        await addExpense({title: `E${i}`, date: NOW - i * 60_000});
      }
      await addIncome({source: 'Salary', date: NOW - 30_000});

      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot.recent).toHaveLength(DASHBOARD_RECENT_LIMIT);
      expect(snapshot.recent[0].type).toBe('expense');
      expect(snapshot.recent[1].type).toBe('income'); // newest-1 minute slot
      expect(snapshot.recent[2].type).toBe('expense');
    });

    it('returns an all-zero snapshot on a fresh database', async () => {
      const snapshot = await feature.getDashboardSnapshot(NOW);
      expect(snapshot).toEqual({
        todayIncome: 0,
        todayExpense: 0,
        todayBalance: 0,
        monthIncome: 0,
        monthExpense: 0,
        monthBalance: 0,
        categoryTotals: [],
        recent: [],
      });
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Phase 11 — search & filter browser: sorting, date windows, payment method,
 * recurring, amount bounds, combined filters, counts, pagination races and
 * realistic dataset sizes.
 * ---------------------------------------------------------------------------
 */
describe('TransactionsFeature — Phase 11 filters', () => {
  let service: DatabaseService;
  let feature: TransactionsFeature;
  let foodId: number;
  let transportId: number;

  beforeEach(async () => {
    service = await createTestService();
    feature = createTransactionsFeature(service);
    const categories = await service.categories.list('expense');
    const food = categories.find(c => c.name === 'Food & Dining');
    const transport = categories.find(c => c.name === 'Transport');
    if (!food || !transport) {
      throw new Error('Expected seeded expense categories to exist');
    }
    foodId = food.id;
    transportId = transport.id;
  });

  afterEach(async () => {
    await service.close();
  });

  const expense = (input: {
    amount?: number;
    title?: string;
    date?: number;
    note?: string | null;
    categoryId?: number;
    paymentMethod?: PaymentMethod;
  }) =>
    service.expenses.create({
      amount: input.amount ?? 1_000,
      title: input.title ?? 'Test expense',
      categoryId: input.categoryId ?? foodId,
      date: input.date ?? TODAY_EARLIER,
      paymentMethod: input.paymentMethod ?? 'cash',
      note: input.note ?? null,
    });

  const income = (input: {
    amount?: number;
    source?: string;
    date?: number;
    note?: string | null;
  }) =>
    service.income.create({
      amount: input.amount ?? 1_000,
      source: input.source ?? 'Salary',
      date: input.date ?? TODAY_EARLIER,
      note: input.note ?? null,
    });

  /* --------------------------------- sorting ------------------------------- */

  describe('sorting', () => {
    it('sorts newest first by default and deterministically on date ties', async () => {
      const older = await expense({title: 'Older', date: YESTERDAY});
      const e1 = await expense({title: 'Same ms 1', date: NOW});
      const e2 = await expense({title: 'Same ms 2', date: NOW});
      const i1 = await income({source: 'Same ms income', date: NOW});

      const page = await feature.getTransactionPage({});
      // Equal-date ties keep a stable expense-then-income order, each
      // id-ordered from SQL — deterministic across runs.
      expect(page.items.map(i => i.key)).toEqual([
        `expense-${e2.id}`,
        `expense-${e1.id}`,
        `income-${i1.id}`,
        `expense-${older.id}`,
      ]);
    });

    it('sorts oldest first', async () => {
      const older = await expense({date: YESTERDAY});
      const newer = await income({date: NOW});
      const page = await feature.getTransactionPage({sort: 'oldest'});
      expect(page.items.map(i => i.key)).toEqual([
        `expense-${older.id}`,
        `income-${newer.id}`,
      ]);
    });

    it('sorts by highest amount across both types', async () => {
      const small = await expense({amount: 500, date: NOW});
      const big = await income({amount: 90_000, date: YESTERDAY});
      const middle = await expense({amount: 5_000, date: YESTERDAY});
      const page = await feature.getTransactionPage({sort: 'highest'});
      expect(page.items.map(i => i.key)).toEqual([
        `income-${big.id}`,
        `expense-${middle.id}`,
        `expense-${small.id}`,
      ]);
    });

    it('sorts by lowest amount', async () => {
      const small = await expense({amount: 500});
      const big = await income({amount: 90_000});
      const page = await feature.getTransactionPage({sort: 'lowest'});
      expect(page.items.map(i => i.key)).toEqual([
        `expense-${small.id}`,
        `income-${big.id}`,
      ]);
    });

    it('keeps equal-amount ties deterministic in every amount order', async () => {
      const e1 = await expense({amount: 2_000, date: YESTERDAY});
      const e2 = await expense({amount: 2_000, date: NOW});
      const i1 = await income({amount: 2_000});

      const highest = await feature.getTransactionPage({sort: 'highest'});
      const lowest = await feature.getTransactionPage({sort: 'lowest'});
      // Ties: expenses first (id order), then income — same relative block
      // in both directions.
      expect(highest.items.map(i => i.key)).toEqual([
        `expense-${e1.id}`,
        `expense-${e2.id}`,
        `income-${i1.id}`,
      ]);
      expect(lowest.items.map(i => i.key)).toEqual(
        highest.items.map(i => i.key),
      );
    });
  });

  /* ------------------------------ date windows ----------------------------- */

  describe('date windows', () => {
    it('today covers exactly the current local day', async () => {
      const now = Date.now();
      const inToday = await expense({date: now});
      await expense({date: startOfDay(now) - 1});

      const page = await feature.getTransactionPage({period: 'today'});
      expect(page.items.map(i => i.key)).toEqual([`expense-${inToday.id}`]);
    });

    it('this week covers Monday..Sunday inclusive (edges included)', async () => {
      const now = Date.now();
      const week = weekBounds(now);
      const monday = await expense({date: week.fromDate});
      const sunday = await income({date: week.toDate});
      await expense({date: week.fromDate - 1});
      await expense({date: week.toDate + 1});

      const page = await feature.getTransactionPage({period: 'thisWeek'});
      // Default sort is newest first: Sunday's end precedes Monday's start.
      expect(page.items.map(i => i.key)).toEqual([
        `income-${sunday.id}`,
        `expense-${monday.id}`,
      ]);
    });

    it('this month covers the whole calendar month (edges included)', async () => {
      const now = Date.now();
      const first = startOfMonth(now);
      const last = endOfMonth(now);
      const a = await expense({date: first});
      const b = await income({date: last});
      await expense({date: first - 1});
      await income({date: last + 1});

      const page = await feature.getTransactionPage({period: 'thisMonth'});
      expect(page.items.map(i => i.key)).toEqual([
        `income-${b.id}`,
        `expense-${a.id}`,
      ]);
    });

    it('last month resolves the previous calendar month across years', async () => {
      const now = Date.now();
      const current = {
        year: new Date(now).getFullYear(),
        month: new Date(now).getMonth() + 1,
      };
      const previous = previousMonth(current.year, current.month);
      const bounds = monthBounds(previous.year, previous.month);
      const inside = await expense({date: bounds.fromDate + 60_000});
      await expense({date: now});

      const page = await feature.getTransactionPage({period: 'lastMonth'});
      expect(page.items.map(i => i.key)).toEqual([`expense-${inside.id}`]);
    });

    it('custom ranges are inclusive on both ends and order-independent', async () => {
      const from = atNoon(2026, 7, 10);
      const to = atNoon(2026, 7, 12);
      const inside1 = await expense({date: from});
      const inside2 = await income({date: to});
      await expense({date: to + DAY_MS});

      const page = await feature.getTransactionPage({
        period: 'custom',
        customRange: {fromDate: from, toDate: to},
      });
      expect(page.items.map(i => i.key)).toEqual([
        `income-${inside2.id}`,
        `expense-${inside1.id}`,
      ]);

      const reversed = await feature.getTransactionPage({
        period: 'custom',
        customRange: {fromDate: to, toDate: from},
      });
      expect(reversed.items.map(i => i.key)).toEqual(
        page.items.map(i => i.key),
      );
    });
  });

  /* ---------------------------- payment method ----------------------------- */

  describe('payment method filter', () => {
    it('filters expenses by each stored enum value', async () => {
      await expense({title: 'Cash tea', paymentMethod: 'cash'});
      await expense({title: 'Card tea', paymentMethod: 'card'});
      await expense({title: 'Bank tea', paymentMethod: 'bank_transfer'});
      await expense({title: 'Wallet tea', paymentMethod: 'mobile_wallet'});
      await expense({title: 'Other tea', paymentMethod: 'other'});

      for (const method of PAYMENT_METHODS) {
        const page = await feature.getTransactionPage({paymentMethod: method});
        expect(page.items.map(i => i.paymentMethod)).toEqual([method]);
      }
    });

    it('excludes income while a payment filter is active', async () => {
      await expense({title: 'Cash purchase', paymentMethod: 'cash'});
      await income({source: 'Salary'});

      const page = await feature.getTransactionPage({paymentMethod: 'cash'});
      expect(page.items.map(i => i.type)).toEqual(['expense']);
    });
  });

  /* ------------------------------- recurring ------------------------------- */

  describe('recurring filter', () => {
    it('recurring returns only rule-generated rows of both types', async () => {
      await expense({title: 'Manual coffee'});
      await income({source: 'Manual gift'});
      await service.recurring.create({
        type: 'expense',
        amount: 12_000,
        title: 'Generated rent',
        categoryId: foodId,
        frequency: 'monthly',
        startDate: YESTERDAY,
        nextOccurrenceAt: YESTERDAY,
        paymentMethod: 'cash',
      });
      await service.recurring.create({
        type: 'income',
        amount: 40_000,
        title: 'Generated salary',
        frequency: 'monthly',
        startDate: YESTERDAY,
        nextOccurrenceAt: YESTERDAY,
      });
      const result = await processDueRecurringTransactions(service, NOW);
      expect(result.generatedExpenses).toBe(1);
      expect(result.generatedIncome).toBe(1);

      const page = await feature.getTransactionPage({recurring: 'recurring'});
      // Same occurrence date: the stable merge lists expenses first.
      expect(page.items.map(i => i.title)).toEqual([
        'Generated rent',
        'Generated salary',
      ]);
      expect(page.items.every(i => i.recurringRuleId != null)).toBe(true);
    });

    it('manual excludes rule-generated rows', async () => {
      await expense({title: 'Manual coffee'});
      await service.recurring.create({
        type: 'expense',
        amount: 12_000,
        title: 'Generated rent',
        categoryId: foodId,
        frequency: 'monthly',
        startDate: YESTERDAY,
        nextOccurrenceAt: YESTERDAY,
        paymentMethod: 'cash',
      });
      await processDueRecurringTransactions(service, NOW);

      const page = await feature.getTransactionPage({recurring: 'manual'});
      expect(page.items.map(i => i.title)).toEqual(['Manual coffee']);
      expect(page.items.every(i => i.recurringRuleId == null)).toBe(true);
    });

    it('deleting the rule keeps the transaction discoverable as manual', async () => {
      const rule = await service.recurring.create({
        type: 'expense',
        amount: 12_000,
        title: 'Generated rent',
        categoryId: foodId,
        frequency: 'monthly',
        startDate: YESTERDAY,
        nextOccurrenceAt: YESTERDAY,
        paymentMethod: 'cash',
      });
      await processDueRecurringTransactions(service, NOW);
      await service.recurring.delete(rule.id);

      const page = await feature.getTransactionPage({recurring: 'manual'});
      expect(page.items.map(i => i.title)).toEqual(['Generated rent']);
      expect(page.items[0].recurringRuleId).toBeNull();
    });
  });

  /* ----------------------------- amount bounds ----------------------------- */

  describe('amount bounds', () => {
    it('applies min/max to the merged ledger', async () => {
      const smallE = await expense({amount: 250});
      const bigI = await income({amount: 80_000});
      const midE = await expense({amount: 5_000});
      void smallE;

      const min = await feature.getTransactionPage({minAmount: 5_000});
      // Same date tie: the stable merge lists the expense first.
      expect(min.items.map(i => i.key)).toEqual([
        `expense-${midE.id}`,
        `income-${bigI.id}`,
      ]);

      const max = await feature.getTransactionPage({maxAmount: 5_000});
      expect(max.items.map(i => i.key)).toEqual([
        `expense-${midE.id}`,
        `expense-${smallE.id}`,
      ]);

      const both = await feature.getTransactionPage({
        minAmount: 251,
        maxAmount: 79_999,
      });
      expect(both.items.map(i => i.key)).toEqual([`expense-${midE.id}`]);
    });

    it('yields an empty page when the window excludes everything', async () => {
      await expense({amount: 1_000});
      const page = await feature.getTransactionPage({minAmount: 2_000});
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
    });
  });

  /* ---------------------------- combined filters --------------------------- */

  describe('combined filters', () => {
    it('applies type + category + payment + recurring + period + amount in SQL', async () => {
      const now = Date.now();
      await expense({
        title: 'Generated biryani',
        amount: 7_500,
        categoryId: foodId,
        paymentMethod: 'cash',
        date: now,
      });
      // wrong category
      await expense({
        title: 'Bus fare',
        amount: 7_500,
        categoryId: transportId,
        paymentMethod: 'cash',
        date: now,
      });
      // wrong payment method
      await expense({
        title: 'Card biryani',
        amount: 7_500,
        categoryId: foodId,
        paymentMethod: 'card',
        date: now,
      });
      // too small
      await expense({
        title: 'Cheap biryani',
        amount: 4_999,
        categoryId: foodId,
        paymentMethod: 'cash',
        date: now,
      });
      // income never matches an expense-filtered query
      await income({source: 'Biryani bonus', amount: 7_500});

      // Tag the matching row as rule-generated.
      const rule = await service.recurring.create({
        type: 'expense',
        amount: 7_500,
        title: 'Generated biryani',
        categoryId: foodId,
        frequency: 'monthly',
        startDate: startOfDay(now),
        nextOccurrenceAt: startOfDay(now),
        paymentMethod: 'cash',
      });
      // The manual row from above is NOT tagged; delete the manual one and
      // regenerate so the only 'Generated biryani' row carries the tag.
      const manualRows = await service.expenses.list({
        search: 'Generated biryani',
      });
      for (const row of manualRows) {
        if (row.recurringRuleId == null) {
          await service.expenses.delete(row.id);
        }
      }
      await processDueRecurringTransactions(service, now + 1);
      void rule; // documents that the tag came from THIS rule

      const query = {
        type: 'expense' as const,
        categoryId: foodId,
        paymentMethod: 'cash' as const,
        recurring: 'recurring' as const,
        period: 'today' as const,
        minAmount: 5_000,
        maxAmount: 10_000,
      };
      const page = await feature.getTransactionPage(query);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        type: 'expense',
        category: 'Food & Dining',
        paymentMethod: 'cash',
        recurringRuleId: expect.any(Number),
      });

      const count = await feature.getTransactionCount(query);
      expect(count).toBe(1);
    });
  });

  /* ------------------------------ result count ----------------------------- */

  describe('getTransactionCount', () => {
    it('counts everything when no filter constrains the ledger', async () => {
      await expense({});
      await expense({});
      await income({});
      expect(await feature.getTransactionCount({})).toBe(3);
    });

    it('matches the page length for the same filters', async () => {
      await expense({title: 'chai'});
      await expense({title: 'CHAI latte'});
      await expense({title: 'bus'});
      await income({source: 'chaiwala'});

      const query = {search: 'chai'};
      const page = await feature.getTransactionPage({
        ...query,
        pageSize: 1_000,
      });
      const count = await feature.getTransactionCount(query);
      expect(count).toBe(page.items.length);
      expect(count).toBe(3);
    });

    it('counts zero on an empty ledger', async () => {
      expect(await feature.getTransactionCount({})).toBe(0);
    });

    it('respects type and category constraints', async () => {
      await expense({categoryId: foodId});
      await expense({categoryId: transportId});
      await income({});

      expect(await feature.getTransactionCount({type: 'income'})).toBe(1);
      expect(
        await feature.getTransactionCount({
          type: 'expense',
          categoryId: transportId,
        }),
      ).toBe(1);
      expect(await feature.getTransactionCount({categoryId: foodId})).toBe(1);
    });
  });

  /* --------------------- archived categories / history -------------------- */

  describe('archived categories and history', () => {
    it('keeps archived-category transactions listed and filterable', async () => {
      const row = await expense({title: 'Legacy food', categoryId: foodId});
      await service.categories.update(foodId, {isActive: false});

      // Still in the default ledger.
      const all = await feature.getTransactionPage({});
      expect(all.items.map(i => i.title)).toContain('Legacy food');

      // Still reachable through the category filter.
      const filtered = await feature.getTransactionPage({categoryId: foodId});
      expect(filtered.items.map(i => i.key)).toEqual([`expense-${row.id}`]);

      // The filter sheet's category listing includes the archived category.
      const filterCategories = await feature.listFilterCategories();
      const archived = filterCategories.find(c => c.id === foodId);
      expect(archived?.isActive).toBe(false);
    });

    it('excludes income while an archived-category filter is active', async () => {
      await expense({categoryId: foodId});
      await income({});
      await service.categories.update(foodId, {isActive: false});

      const page = await feature.getTransactionPage({categoryId: foodId});
      expect(page.items.map(i => i.type)).toEqual(['expense']);
    });
  });

  /* --------------------- pagination under any sort order ------------------- */

  describe('pagination under sort orders', () => {
    it('walks the whole ledger exactly once with amount sorting', async () => {
      const seeds: TransactionItem['key'][] = [];
      for (let i = 0; i < 6; i++) {
        const row = await expense({
          title: `E${i}`,
          amount: (i + 1) * 1_000,
          date: YESTERDAY + i * 60_000,
        });
        seeds.push(`expense-${row.id}`);
      }
      const incomeRow = await income({
        source: 'Bonus',
        amount: 3_500,
        date: NOW,
      });
      seeds.push(`income-${incomeRow.id}`);

      // Full walk with highest-amount sorting.
      const collected: TransactionItem['key'][] = [];
      let page = 0;
      for (;;) {
        const result = await feature.getTransactionPage({
          sort: 'highest',
          pageSize: 2,
          page,
        });
        collected.push(...result.items.map(i => i.key));
        if (!result.hasMore) {
          break;
        }
        page++;
      }
      expect(collected).toHaveLength(seeds.length);
      expect(new Set(collected).size).toBe(seeds.length);
      // Re-walk recording amounts; they must be non-increasing.
      const amounts: number[] = [];
      for (let p = 0; ; p++) {
        const result = await feature.getTransactionPage({
          sort: 'highest',
          pageSize: 2,
          page: p,
        });
        amounts.push(...result.items.map(i => i.amount));
        if (!result.hasMore) {
          break;
        }
      }
      for (let k = 1; k < amounts.length; k++) {
        expect(amounts[k - 1]).toBeGreaterThanOrEqual(amounts[k]);
      }
    });

    it('surfaces a lone small row even when big rows outnumber it', async () => {
      // Income side holds many large rows; the expense is tiny but must
      // still land in its correct (last) merged position with 'lowest'.
      const small = await expense({amount: 100, date: YESTERDAY});
      for (let i = 0; i < 5; i++) {
        await income({amount: 50_000 + i, date: YESTERDAY + i * 60_000});
      }

      const page0 = await feature.getTransactionPage({
        sort: 'lowest',
        pageSize: 2,
        page: 0,
      });
      // Lowest first: the tiny expense leads page 0 even though income
      // rows vastly outnumber it.
      expect(page0.items.map(i => i.key)[0]).toBe(`expense-${small.id}`);
      const lastPage = await feature.getTransactionPage({
        sort: 'lowest',
        pageSize: 2,
        page: 2,
      });
      expect(lastPage.hasMore).toBe(false);
      expect(lastPage.items).toHaveLength(2);
    });
  });

  /* --------------- filter-change race regression (Phase 8 fix) ------------- */

  describe('filter-change race regression', () => {
    it('interleaved queries for different filters never cross-contaminate', async () => {
      await expense({title: 'Food row', categoryId: foodId});
      await expense({title: 'Bus row', categoryId: transportId});
      await income({source: 'Salary row'});

      // Fire page loads for two different filters "simultaneously".
      const [foodPage, incomePage] = await Promise.all([
        feature.getTransactionPage({categoryId: foodId}),
        feature.getTransactionPage({type: 'income'}),
      ]);
      expect(foodPage.items.map(i => i.type)).toEqual(['expense']);
      expect(foodPage.items[0].category).toBe('Food & Dining');
      expect(incomePage.items.map(i => i.type)).toEqual(['income']);

      // A pagination request issued under the NEW filter (page 1) after the
      // filter changed must only ever contain new-filter rows.
      for (let i = 0; i < 4; i++) {
        await income({source: `Extra ${i}`});
      }
      const page1 = await feature.getTransactionPage({
        type: 'income',
        page: 1,
        pageSize: 2,
      });
      expect(page1.items.map(i => i.type)).toEqual(['income', 'income']);
      expect(page1.hasMore).toBe(true);
    });

    it('hasMore stays correct for each filter independent of page history', async () => {
      await expense({});
      const first = await feature.getTransactionPage({pageSize: 10, page: 0});
      expect(first.hasMore).toBe(false);
      // Filtering to an empty result still reports hasMore=false.
      const none = await feature.getTransactionPage({
        search: 'nothing-matches',
        pageSize: 10,
        page: 0,
      });
      expect(none.items).toEqual([]);
      expect(none.hasMore).toBe(false);
    });
  });

  /* ---------------------------- dataset sizes ------------------------------ */

  describe('realistic dataset sizes', () => {
    it('paginates, searches and filters 100 rows correctly', async () => {
      for (let i = 0; i < 100; i++) {
        await expense({
          title: i % 10 === 0 ? `Chai special ${i}` : `Row ${i}`,
          amount: 1_000 + i,
          date: YESTERDAY + i * 1_000,
        });
      }

      // Full pagination walk, no duplicates, no skips.
      const collected: string[] = [];
      let page = 0;
      for (;;) {
        const result = await feature.getTransactionPage({
          pageSize: 30,
          page,
        });
        collected.push(...result.items.map(i => i.key));
        if (!result.hasMore) {
          break;
        }
        page++;
      }
      expect(collected).toHaveLength(100);
      expect(new Set(collected).size).toBe(100);

      // Search narrows to every 10th row.
      const searched = await feature.getTransactionPage({search: 'special'});
      expect(searched.items).toHaveLength(10);

      // Amount window + count consistency.
      const count = await feature.getTransactionCount({minAmount: 1_090});
      const pageWithBig = await feature.getTransactionPage({
        minAmount: 1_090,
        pageSize: 1_000,
      });
      expect(count).toBe(pageWithBig.items.length);
      expect(count).toBe(10);
    }, 30_000);

    it('searches and filters 1,000 rows with consistent counts', async () => {
      for (let i = 0; i < 1_000; i++) {
        await expense({
          title: i % 25 === 0 ? `Widget ${i}` : `Bulk ${i}`,
          amount: 500 + i,
          date: startOfDay(Date.now()) + (i % 20) * 60_000,
        });
      }
      await income({source: 'One salary', amount: 500_000});

      const searched = await feature.getTransactionPage({
        search: 'widget',
        pageSize: 1_000,
      });
      expect(searched.items).toHaveLength(40);
      expect(searched.hasMore).toBe(false);

      const count = await feature.getTransactionCount({search: 'widget'});
      expect(count).toBe(40);

      // Window-merge pagination stays correct across pages.
      const p0 = await feature.getTransactionPage({pageSize: 300, page: 0});
      const p1 = await feature.getTransactionPage({pageSize: 300, page: 1});
      const keys = new Set([...p0.items, ...p1.items].map(i => i.key));
      expect(p0.items).toHaveLength(300);
      expect(p1.items).toHaveLength(300);
      // No row appears on both pages.
      expect(keys.size).toBe(600);
    }, 60_000);

    it('combined filters stay correct on a 5,000-row ledger', async () => {
      const now = startOfDay(Date.now());
      for (let i = 0; i < 5_000; i++) {
        await expense({
          title: `Ledger ${i}`,
          amount: 100 + i,
          categoryId: i % 2 === 0 ? foodId : transportId,
          paymentMethod: i % 3 === 0 ? 'cash' : 'card',
          date: now + (i % 5) * 60_000,
        });
      }

      const query = {
        type: 'expense' as const,
        categoryId: foodId,
        paymentMethod: 'cash' as const,
        period: 'today' as const,
        minAmount: 100,
        maxAmount: 5_100,
      };
      const page = await feature.getTransactionPage({
        ...query,
        pageSize: 5_001,
      });
      // 2,500 food rows, of which every other (i % 6 === 0) is cash →
      // food ∩ cash over i in [0..4999]: i % 2 === 0 && i % 3 === 0 →
      // i % 6 === 0 → 834 rows; all within the amount window (100..5099).
      const expected = 834;
      expect(page.items).toHaveLength(expected);

      const count = await feature.getTransactionCount(query);
      expect(count).toBe(expected);
      expect(new Set(page.items.map(i => i.key)).size).toBe(expected);
      expect(page.hasMore).toBe(false);
    }, 120_000);
  });
});
