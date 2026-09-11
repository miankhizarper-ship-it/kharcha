/**
 * @jest-environment node
 */
import type {DatabaseDriver} from '@/database/driver';
import {createTestService} from '@/database/testing/helpers';
import {DatabaseService} from '@/database/service';
import {noonOf} from './date';
import {processDueRecurringTransactions} from './processing';

/**
 * The generation engine on the REAL SQLite engine: catch-up policy
 * (spec §13), future/end-date handling (§18/§19), duplicate prevention and
 * idempotency (§14/§17), atomicity with rollback (§15) and the inactive-
 * category block (§8/§25).
 */

const JUN_1 = noonOf(2026, 6, 1);
const JUL_1 = noonOf(2026, 7, 1);
const AUG_1 = noonOf(2026, 8, 1);
const SEP_1 = noonOf(2026, 9, 1);
const SEP_8 = noonOf(2026, 9, 8);
const OCT_1 = noonOf(2026, 10, 1);
const JAN_31 = noonOf(2027, 1, 31);
const FEB_28 = noonOf(2027, 2, 28);
const MAR_28 = noonOf(2027, 3, 28);
const APR_28 = noonOf(2027, 4, 28);

/** Fault-injecting driver (same pattern as the backup restore tests). */
class FaultInjectionDriver implements DatabaseDriver {
  constructor(
    private readonly inner: DatabaseDriver,
    private readonly fault: (sql: string) => Error | null,
  ) {}
  get name(): string {
    return this.inner.name;
  }
  open(): Promise<void> {
    return this.inner.open();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
  exec(sql: string): Promise<void> {
    const failure = this.fault(sql);
    if (failure) {
      return Promise.reject(failure);
    }
    return this.inner.exec(sql);
  }
  query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> {
    return this.inner.query(sql, params as never);
  }
  run(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{rowsAffected: number}> {
    const failure = this.fault(sql);
    if (failure) {
      return Promise.reject(failure);
    }
    return this.inner.run(sql, params as never);
  }
}

async function createExpenseRule(
  service: DatabaseService,
  overrides: Partial<{
    amount: number;
    title: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    startDate: number;
    nextOccurrenceAt: number;
    endDate: number | null;
    isActive: boolean;
    categoryId: number;
    paymentMethod: 'cash' | 'card';
    note: string | null;
  }> = {},
) {
  let categoryId = overrides.categoryId;
  if (categoryId === undefined) {
    categoryId = (
      await service.categories.create({
        name: `Recurring Cat ${Math.random().toString(36).slice(2, 8)}`,
        icon: 'home',
        type: 'expense',
      })
    ).id;
  }
  return service.recurring.create({
    type: 'expense',
    amount: 12_000_00,
    title: 'Hostel rent',
    categoryId,
    frequency: 'monthly',
    startDate: JUN_1,
    nextOccurrenceAt: JUN_1,
    paymentMethod: overrides.paymentMethod ?? 'cash',
    ...overrides,
  });
}

describe('processDueRecurringTransactions — catch-up', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('generates one due occurrence and advances to the next one', async () => {
    const rule = await createExpenseRule(service, {
      frequency: 'daily',
      startDate: SEP_8,
      nextOccurrenceAt: SEP_8,
    });

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(1);
    expect(result.generatedIncome).toBe(0);
    expect(result.completedRules).toBe(0);
    expect(result.blockedRuleIds).toEqual([]);

    const expenses = await service.expenses.list();
    expect(expenses).toHaveLength(1);
    expect(expenses[0]!.amount).toBe(12_000_00); // exact minor units
    expect(expenses[0]!.date).toBe(SEP_8); // occurrence, local noon
    expect(expenses[0]!.recurringRuleId).toBe(rule.id);
    expect(expenses[0]!.title).toBe('Hostel rent');
    expect(expenses[0]!.categoryId).toBe(rule.categoryId);

    const advanced = await service.recurring.getById(rule.id);
    expect(advanced!.nextOccurrenceAt).toBe(noonOf(2026, 9, 9));
    expect(advanced!.isActive).toBe(true);
  });

  it('generates ALL missed occurrences (the spec §13 example)', async () => {
    // Monthly rule due July 1, app not opened in July/August, opened Sep 8:
    // July 1 + August 1 + September 1 generate; next becomes October 1.
    const rule = await createExpenseRule(service, {
      nextOccurrenceAt: JUL_1,
    });

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(3);

    const expenses = await service.expenses.list({order: 'dateAsc'});
    expect(expenses.map(expense => expense.date)).toEqual([
      JUL_1,
      AUG_1,
      SEP_1,
    ]);
    for (const expense of expenses) {
      expect(expense.recurringRuleId).toBe(rule.id);
    }

    expect((await service.recurring.getById(rule.id))!.nextOccurrenceAt).toBe(
      OCT_1,
    );
  });

  it('backfills a rule created with a past start date (documented policy)', async () => {
    // Created Sep 8 with start June 1 — the same catch-up policy applies
    // on the first processing run.
    const rule = await createExpenseRule(service, {
      startDate: JUN_1,
      nextOccurrenceAt: JUN_1,
    });
    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(4); // Jun, Jul, Aug, Sep
    expect((await service.recurring.getById(rule.id))!.nextOccurrenceAt).toBe(
      OCT_1,
    );
  });

  it('never generates future occurrences', async () => {
    await createExpenseRule(service, {
      frequency: 'daily',
      startDate: SEP_8,
      nextOccurrenceAt: SEP_8,
    });

    // "Today" is the day BEFORE the next occurrence: nothing happens.
    const result = await processDueRecurringTransactions(
      service,
      noonOf(2026, 9, 7),
    );
    expect(result.generatedExpenses).toBe(0);
    expect(await service.expenses.count()).toBe(0);
  });

  it('clamps month-end advancement without drift inside the engine', async () => {
    const rule = await createExpenseRule(service, {
      frequency: 'monthly',
      startDate: JAN_31,
      nextOccurrenceAt: JAN_31,
    });

    await processDueRecurringTransactions(service, MAR_28);
    const expenses = await service.expenses.list({order: 'dateAsc'});
    // Jan 31 -> Feb 28 (clamped) -> Mar 28 — all three are <= today.
    expect(expenses.map(expense => expense.date)).toEqual([
      JAN_31,
      FEB_28,
      MAR_28,
    ]);
    expect((await service.recurring.getById(rule.id))!.nextOccurrenceAt).toBe(
      APR_28,
    );
  });
});

describe('processDueRecurringTransactions — end dates & inactive rules', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('generates up to AND INCLUDING the end date, then completes the rule', async () => {
    const rule = await createExpenseRule(service, {
      frequency: 'monthly',
      nextOccurrenceAt: AUG_1,
      endDate: SEP_1,
    });

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(2); // Aug 1 + Sep 1, NOT Oct 1
    expect(result.completedRules).toBe(1);

    const expenses = await service.expenses.list({order: 'dateAsc'});
    expect(expenses.map(expense => expense.date)).toEqual([AUG_1, SEP_1]);

    const finished = await service.recurring.getById(rule.id);
    expect(finished!.isActive).toBe(false);
  });

  it('completes immediately when the end date already passed', async () => {
    await createExpenseRule(service, {
      nextOccurrenceAt: JUL_1,
      endDate: JUL_1,
    });

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(1); // July 1 was within the end
    expect(result.completedRules).toBe(1);
  });

  it('skips inactive (paused) rules entirely', async () => {
    const rule = await createExpenseRule(service, {
      nextOccurrenceAt: JUL_1,
      isActive: false,
    });

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(0);
    expect(result.completedRules).toBe(0);

    const untouched = await service.recurring.getById(rule.id);
    expect(untouched!.nextOccurrenceAt).toBe(JUL_1);
    expect(untouched!.isActive).toBe(false);
  });
});

describe('processDueRecurringTransactions — inactive categories (spec §8/§25)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('blocks generation for a rule whose category was archived, without advancing', async () => {
    const rule = await createExpenseRule(service, {
      nextOccurrenceAt: AUG_1,
    });
    await service.categories.update(rule.categoryId!, {isActive: false});

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(0);
    expect(result.blockedRuleIds).toEqual([rule.id]);

    const untouched = await service.recurring.getById(rule.id);
    expect(untouched!.nextOccurrenceAt).toBe(AUG_1); // stays due
    expect(untouched!.isActive).toBe(true); // NOT silently paused

    expect(await service.expenses.count()).toBe(0);
  });

  it('generates the backlog once the category is active again', async () => {
    const rule = await createExpenseRule(service, {
      nextOccurrenceAt: AUG_1,
    });
    await service.categories.update(rule.categoryId!, {isActive: false});
    await processDueRecurringTransactions(service, SEP_8);

    await service.categories.update(rule.categoryId!, {isActive: true});
    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedExpenses).toBe(2); // Aug 1 + Sep 1
    expect(result.blockedRuleIds).toEqual([]);
    expect((await service.recurring.getById(rule.id))!.nextOccurrenceAt).toBe(
      OCT_1,
    );
  });

  it('never blocks income rules (they have no category)', async () => {
    await service.recurring.create({
      type: 'income',
      amount: 85_000_00,
      title: 'Salary',
      frequency: 'monthly',
      startDate: AUG_1,
      nextOccurrenceAt: AUG_1,
    });

    const result = await processDueRecurringTransactions(service, SEP_8);
    expect(result.generatedIncome).toBe(2); // Aug 1 + Sep 1
    expect(result.blockedRuleIds).toEqual([]);

    const income = await service.income.list();
    expect(income[0]!.source).toBe('Salary');
    expect(income[0]!.recurringRuleId).toBeGreaterThan(0);
  });
});

describe('processDueRecurringTransactions — idempotency & atomicity', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates each occurrence exactly once across repeated calls (spec §17)', async () => {
    await createExpenseRule(service, {
      frequency: 'daily',
      startDate: SEP_1,
      nextOccurrenceAt: SEP_1,
    });

    for (let i = 0; i < 5; i++) {
      const result = await processDueRecurringTransactions(service, SEP_8);
      if (i === 0) {
        expect(result.generatedExpenses).toBe(8); // Sep 1 .. Sep 8
      } else {
        expect(result.generatedExpenses).toBe(0);
      }
    }

    const expenses = await service.expenses.list({order: 'dateAsc'});
    expect(expenses).toHaveLength(8);
    const uniquePairs = new Set(
      expenses.map(expense => `${expense.recurringRuleId}:${expense.date}`),
    );
    expect(uniquePairs.size).toBe(8);
  });

  it('rolls back EVERYTHING when an insert fails mid-run', async () => {
    const rule = await createExpenseRule(service, {
      nextOccurrenceAt: AUG_1,
    });

    const failingService = await DatabaseService.open(
      new FaultInjectionDriver(service.driver, sql =>
        sql.startsWith('INSERT INTO expenses')
          ? new Error('injected failure')
          : null,
      ),
    );

    await expect(
      processDueRecurringTransactions(failingService, SEP_8),
    ).rejects.toThrow();

    // ROLLBACK: no transactions, next occurrence untouched.
    expect(await service.expenses.count()).toBe(0);
    expect((await service.recurring.getById(rule.id))!.nextOccurrenceAt).toBe(
      AUG_1,
    );
    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);

    // The engine remains usable on the healthy driver afterwards.
    const retry = await processDueRecurringTransactions(service, SEP_8);
    expect(retry.generatedExpenses).toBe(2);
  });

  it('rolls back when the rule ADVANCE fails (no orphan transaction)', async () => {
    const rule = await createExpenseRule(service, {
      frequency: 'daily',
      startDate: SEP_1,
      nextOccurrenceAt: SEP_1,
    });

    const failingService = await DatabaseService.open(
      new FaultInjectionDriver(service.driver, sql =>
        sql.includes('UPDATE recurring_transactions SET next_occurrence_at')
          ? new Error('injected advancement failure')
          : null,
      ),
    );

    await expect(
      processDueRecurringTransactions(failingService, SEP_8),
    ).rejects.toThrow();

    // The inserted expenses rolled back together with the failed update —
    // no orphan transactions and no half-advanced state.
    expect(await service.expenses.count()).toBe(0);
    expect((await service.recurring.getById(rule.id))!.nextOccurrenceAt).toBe(
      SEP_1,
    );
  });

  it('leaves no due work behind after a full catch-up', async () => {
    await createExpenseRule(service, {
      frequency: 'daily',
      startDate: SEP_1,
      nextOccurrenceAt: SEP_1,
    });

    const first = await processDueRecurringTransactions(service, SEP_8);
    expect(first.generatedExpenses).toBe(8);
    const second = await processDueRecurringTransactions(service, SEP_8);
    expect(second.generatedExpenses).toBe(0);
  });
});
