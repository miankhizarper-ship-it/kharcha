/**
 * @jest-environment node
 */
import {NodeSqliteDriver} from '../drivers/node';
import {DatabaseError} from '../errors';
import {MIGRATIONS, runMigrations} from '../migrations';
import {DatabaseService} from '../service';
import {createTestExpense, createTestService, T0} from '../testing/helpers';
import {noonOf} from '@/features/recurring/date';

/**
 * RecurringTransactionRepository on the REAL SQLite engine: guards, CHECK
 * constraints, FK behavior (RESTRICT on categories, SET NULL on generated
 * transactions) and the partial UNIQUE indexes that make the database the
 * final duplicate-prevention authority (spec §14).
 */

const SEPT_1 = noonOf(2026, 9, 1);
const SEPT_8 = noonOf(2026, 9, 8);

async function createExpenseRule(
  service: DatabaseService,
  overrides: Partial<
    Parameters<DatabaseService['recurring']['create']>[0]
  > = {},
) {
  const category =
    overrides.categoryId !== undefined && overrides.categoryId !== null
      ? null
      : await service.categories.create({
          name: `Rule Cat ${Math.random().toString(36).slice(2, 8)}`,
          icon: 'home',
          type: 'expense',
        });
  return service.recurring.create({
    type: 'expense',
    amount: 12_000_00,
    title: 'Hostel rent',
    categoryId: overrides.categoryId ?? category!.id,
    frequency: 'monthly',
    startDate: SEPT_1,
    nextOccurrenceAt: SEPT_8,
    paymentMethod: 'cash',
    ...overrides,
  });
}

describe('recurring repository — create', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates an expense rule with defaults (active, no end date)', async () => {
    const rule = await createExpenseRule(service);
    expect(rule.type).toBe('expense');
    expect(rule.amount).toBe(12_000_00);
    expect(rule.frequency).toBe('monthly');
    expect(rule.isActive).toBe(true);
    expect(rule.endDate).toBeNull();
    expect(rule.paymentMethod).toBe('cash');
    expect(rule.categoryId).toBeGreaterThan(0);
    expect(rule.createdAt).toBeGreaterThan(0);
    expect(rule.nextOccurrenceAt).toBe(SEPT_8);
  });

  it('defaults nextOccurrenceAt to startDate and rejects income-only fields on expense rules', async () => {
    const category = await service.categories.create({
      name: 'Default next',
      icon: 'bus',
      type: 'expense',
    });
    const rule = await service.recurring.create({
      type: 'expense',
      amount: 100,
      title: 'Bus pass',
      categoryId: category.id,
      frequency: 'daily',
      startDate: SEPT_1,
      paymentMethod: 'cash',
    });
    expect(rule.nextOccurrenceAt).toBe(SEPT_1);

    await expect(
      service.recurring.create({
        type: 'expense',
        amount: 100,
        title: 'No method',
        categoryId: category.id,
        frequency: 'daily',
        startDate: SEPT_1,
        paymentMethod: null,
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('creates income rules without category or payment method', async () => {
    const rule = await service.recurring.create({
      type: 'income',
      amount: 85_000_00,
      title: 'Salary',
      frequency: 'monthly',
      startDate: SEPT_1,
    });
    expect(rule.categoryId).toBeNull();
    expect(rule.paymentMethod).toBeNull();

    await expect(
      service.recurring.create({
        type: 'income',
        amount: 100,
        title: 'Bad income rule',
        frequency: 'daily',
        startDate: SEPT_1,
        categoryId: 1,
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects end dates before the start date', async () => {
    await expect(
      createExpenseRule(service, {
        startDate: SEPT_8,
        endDate: SEPT_1,
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects unknown frequencies, zero amounts and bad types via guards/CHECK', async () => {
    await expect(
      createExpenseRule(service, {
        frequency: 'yearly' as never,
      }),
    ).rejects.toBeInstanceOf(DatabaseError);

    await expect(
      createExpenseRule(service, {amount: 0}),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects rules referencing a missing or income-typed category', async () => {
    await expect(
      createExpenseRule(service, {categoryId: 999_999}),
    ).rejects.toBeInstanceOf(DatabaseError);

    const incomeCategory = await service.categories.create({
      name: 'Not for rules',
      icon: 'briefcase',
      type: 'income',
    });
    await expect(
      createExpenseRule(service, {categoryId: incomeCategory.id}),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('recurring repository — list / update / pause / delete', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('lists rules by type and active state, soonest occurrence first', async () => {
    await createExpenseRule(service, {
      title: 'Later',
      nextOccurrenceAt: noonOf(2026, 10, 1),
    });
    await createExpenseRule(service, {title: 'Sooner'});
    await service.recurring.create({
      type: 'income',
      amount: 500,
      title: 'Stipend',
      frequency: 'weekly',
      startDate: SEPT_1,
    });

    const expenses = await service.recurring.list({type: 'expense'});
    expect(expenses.map(rule => rule.title)).toEqual(['Sooner', 'Later']);

    const income = await service.recurring.list({type: 'income'});
    expect(income).toHaveLength(1);
    expect(income[0]!.title).toBe('Stipend');

    await service.recurring.setActive(expenses[0]!.id, false);
    const activeOnly = await service.recurring.list({
      type: 'expense',
      isActive: true,
    });
    expect(activeOnly.map(rule => rule.title)).toEqual(['Later']);
  });

  it('joins the category for display (LEFT JOIN keeps income rules)', async () => {
    const rule = await createExpenseRule(service, {title: 'Joined'});
    await service.recurring.create({
      type: 'income',
      amount: 100,
      title: 'Salary',
      frequency: 'monthly',
      startDate: SEPT_1,
    });

    const rows = await service.recurring.listWithCategory();
    const joined = rows.find(row => row.id === rule.id)!;
    expect(joined.categoryName).toBeTruthy();
    expect(joined.categoryIcon).toBe('home');
    const incomeRow = rows.find(row => row.type === 'income')!;
    expect(incomeRow.categoryName).toBeNull();
  });

  it('updates editable fields but never the type or start date', async () => {
    const rule = await createExpenseRule(service);
    const updated = await service.recurring.update(rule.id, {
      amount: 13_500_00,
      title: 'Hostel rent (renewed)',
      frequency: 'weekly',
      nextOccurrenceAt: SEPT_1,
      endDate: null,
    });
    expect(updated.amount).toBe(13_500_00);
    expect(updated.title).toBe('Hostel rent (renewed)');
    expect(updated.frequency).toBe('weekly');
    expect(updated.nextOccurrenceAt).toBe(SEPT_1);
    expect(updated.type).toBe('expense');

    // `type` is absent from RecurringTransactionPatch — a runtime attempt
    // to sneak it in is ignored by the repository (no such column update).
    const sneaky = await service.recurring.update(rule.id, {
      type: 'income',
    } as never);
    expect(sneaky.type).toBe('expense');
  });

  it('rejects moving a rule onto a mismatched category', async () => {
    const rule = await createExpenseRule(service);
    const incomeCategory = await service.categories.create({
      name: 'Income only',
      icon: 'briefcase',
      type: 'income',
    });
    await expect(
      service.recurring.update(rule.id, {categoryId: incomeCategory.id}),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('pauses and resumes via setActive (flag only)', async () => {
    const rule = await createExpenseRule(service);
    await service.recurring.setActive(rule.id, false);
    expect((await service.recurring.getById(rule.id))!.isActive).toBe(false);
    await service.recurring.setActive(rule.id, true);
    expect((await service.recurring.getById(rule.id))!.isActive).toBe(true);
  });

  it('deletes ONLY the rule — generated transactions survive via SET NULL', async () => {
    const rule = await createExpenseRule(service);
    // Simulate one generated transaction (the engine's insert).
    await service.driver.run(
      `INSERT INTO expenses (amount, title, category_id, date, payment_method, note, created_at, updated_at, recurring_rule_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        rule.amount,
        rule.title,
        rule.categoryId,
        SEPT_1,
        rule.paymentMethod,
        Date.now(),
        Date.now(),
        rule.id,
      ],
    );

    const deleted = await service.recurring.delete(rule.id);
    expect(deleted).toBe(true);
    expect(await service.recurring.getById(rule.id)).toBeNull();

    const expenses = await service.expenses.list();
    expect(expenses).toHaveLength(1);
    expect(expenses[0]!.recurringRuleId).toBeNull(); // ON DELETE SET NULL
  });
});

describe('recurring schema — duplicate prevention (spec §14)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('rejects the same (rule, occurrence) twice via the partial UNIQUE index', async () => {
    const rule = await createExpenseRule(service);
    const insert = () =>
      service.driver.run(
        `INSERT INTO expenses (amount, title, category_id, date, payment_method, note, created_at, updated_at, recurring_rule_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          rule.amount,
          rule.title,
          rule.categoryId,
          SEPT_1,
          rule.paymentMethod,
          Date.now(),
          Date.now(),
          rule.id,
        ],
      );

    await insert();
    await expect(insert()).rejects.toBeInstanceOf(DatabaseError);
  });

  it('allows the same date for different rules and for manual rows', async () => {
    const ruleA = await createExpenseRule(service, {title: 'Rule A'});
    const ruleB = await createExpenseRule(service, {title: 'Rule B'});

    for (const rule of [ruleA, ruleB]) {
      await service.driver.run(
        `INSERT INTO expenses (amount, title, category_id, date, payment_method, note, created_at, updated_at, recurring_rule_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          rule.amount,
          rule.title,
          rule.categoryId,
          SEPT_1,
          rule.paymentMethod,
          Date.now(),
          Date.now(),
          rule.id,
        ],
      );
    }

    // Manual rows (NULL rule id) on the same date are unaffected.
    await createTestExpense(service, {date: SEPT_1});
    expect(await service.expenses.count()).toBe(3);
  });

  it('prevents duplicate income occurrences the same way', async () => {
    const rule = await service.recurring.create({
      type: 'income',
      amount: 100,
      title: 'Salary',
      frequency: 'monthly',
      startDate: SEPT_1,
    });
    const insert = () =>
      service.driver.run(
        `INSERT INTO income (amount, source, date, note, created_at, updated_at, recurring_rule_id)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        [rule.amount, rule.title, SEPT_1, Date.now(), Date.now(), rule.id],
      );

    await insert();
    await expect(insert()).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('recurring schema — category delete interaction (spec §25)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('RESTRICTS deleting a category still referenced by a rule', async () => {
    const rule = await createExpenseRule(service);
    await expect(
      service.categories.delete(rule.categoryId!),
    ).rejects.toBeInstanceOf(DatabaseError);

    // Archiving stays possible; the rule remains stored.
    await service.categories.update(rule.categoryId!, {isActive: false});
    const stored = await service.recurring.getById(rule.id);
    expect(stored!.isActive).toBe(true);
  });
});

describe('migration 004 — recurring transactions', () => {
  let driver: NodeSqliteDriver;
  let service: DatabaseService;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    service = await DatabaseService.open(driver);
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates the table, the columns and the indexes; bumps user_version', async () => {
    const tables = await driver.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map(row => row.name)).toContain('recurring_transactions');

    const expenseColumns = await driver.query<{name: string}>(
      "SELECT name FROM pragma_table_info('expenses') ORDER BY name",
    );
    expect(expenseColumns.map(row => row.name)).toContain('recurring_rule_id');

    const incomeColumns = await driver.query<{name: string}>(
      "SELECT name FROM pragma_table_info('income') ORDER BY name",
    );
    expect(incomeColumns.map(row => row.name)).toContain('recurring_rule_id');

    const indexes = await driver.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    );
    expect(indexes.map(row => row.name)).toEqual(
      expect.arrayContaining([
        'idx_recurring_due',
        'idx_recurring_category_id',
        'idx_expenses_rule_occurrence',
        'idx_income_rule_occurrence',
      ]),
    );

    const version = await driver.query<{user_version: number}>(
      'PRAGMA user_version',
    );
    expect(version[0]!.user_version).toBe(
      MIGRATIONS[MIGRATIONS.length - 1].version,
    );
  });

  it('keeps all previous data intact and re-runs idempotently', async () => {
    expect(await service.categories.countByType('expense')).toBe(10);
    expect(await service.categories.countByType('income')).toBe(6);

    const expense = await createTestExpense(service, {date: T0});
    const version = await runMigrations(driver, MIGRATIONS);
    expect(version).toBe(4);
    expect(await service.expenses.getById(expense.id)).not.toBeNull();
    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);
  });
});
