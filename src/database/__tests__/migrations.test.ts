/**
 * @jest-environment node
 */
import {NodeSqliteDriver} from '../drivers/node';
import {DatabaseError} from '../errors';
import {MIGRATIONS, runMigrations} from '../migrations';
import {DatabaseService} from '../service';
import {createTestExpense, createTestService} from '../testing/helpers';
import {processDueRecurringTransactions} from '@/features/recurring/processing';

describe('migration 001 — initial schema', () => {
  let driver: NodeSqliteDriver;
  let service: DatabaseService;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    service = await DatabaseService.open(driver);
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates all five tables', async () => {
    const rows = await driver.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = rows.map(row => row.name);
    for (const table of [
      'budgets',
      'categories',
      'expenses',
      'income',
      'settings',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('creates the expected indexes', async () => {
    const rows = await driver.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    );
    const names = rows.map(row => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'idx_categories_name_type',
        'idx_expenses_date',
        'idx_expenses_category_id',
        'idx_income_date',
        'idx_budgets_category_period',
      ]),
    );
  });

  it('sets PRAGMA user_version to the latest migration version', async () => {
    const rows = await driver.query<{user_version: number}>(
      'PRAGMA user_version',
    );
    const latest = MIGRATIONS[MIGRATIONS.length - 1].version;
    expect(rows[0].user_version).toBe(latest);
  });

  it('seeds 10 default expense and 6 default income categories', async () => {
    expect(await service.categories.countByType('expense')).toBe(10);
    expect(await service.categories.countByType('income')).toBe(6);

    const expenseCategories = await service.categories.list('expense');
    for (const category of expenseCategories) {
      expect(category.isDefault).toBe(true);
      expect(category.createdAt).toBeGreaterThan(0);
    }
    const incomeCategories = await service.categories.list('income');
    for (const category of incomeCategories) {
      expect(category.isDefault).toBe(true);
    }
    expect(expenseCategories.map(c => c.name)).toContain('Food & Dining');
    expect(expenseCategories.map(c => c.name)).toContain('Groceries');
    expect(incomeCategories.map(c => c.name)).toContain('Salary');
  });

  it('is idempotent — re-running applies nothing and keeps data intact', async () => {
    const expense = await createTestExpense(service);
    const categoriesBefore = await service.categories.countByType('expense');

    const version = await runMigrations(driver, MIGRATIONS);

    expect(version).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    expect(await service.categories.countByType('expense')).toBe(
      categoriesBefore,
    );
    expect(await service.expenses.getById(expense.id)).not.toBeNull();
    expect(await service.expenses.count()).toBe(1);
  });

  it('passes integrity checks after seeding', async () => {
    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);
  });
});

describe('schema constraints (CHECK / UNIQUE / FK)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('rejects non-positive amounts via CHECK', async () => {
    const expense = await createTestExpense(service);
    const {categoryId} = expense;

    await expect(
      service.expenses.create({
        amount: 0,
        title: 'Zero',
        categoryId,
        date: Date.now(),
        paymentMethod: 'cash',
      }),
    ).rejects.toBeInstanceOf(DatabaseError);

    await expect(
      service.expenses.create({
        amount: -100,
        title: 'Negative',
        categoryId,
        date: Date.now(),
        paymentMethod: 'cash',
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects unknown payment methods via CHECK', async () => {
    const expense = await createTestExpense(service);

    await expect(
      service.expenses.create({
        amount: 100,
        title: 'Barter',
        categoryId: expense.categoryId,
        date: Date.now(),
        // Runtime literal on purpose: bypasses the compile-time union.
        paymentMethod: 'seashells' as never,
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects expenses referencing a missing category (FK)', async () => {
    await expect(
      service.expenses.create({
        amount: 100,
        title: 'Orphan',
        categoryId: 999_999,
        date: Date.now(),
        paymentMethod: 'cash',
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('RESTRICTS deleting a category that still has expenses', async () => {
    const expense = await createTestExpense(service);

    await expect(
      service.categories.delete(expense.categoryId),
    ).rejects.toBeInstanceOf(DatabaseError);

    // Both the expense and the category survive the failed delete.
    expect(await service.expenses.getById(expense.id)).not.toBeNull();
    expect(await service.categories.getById(expense.categoryId)).not.toBeNull();
  });

  it('CASCADES budget deletion when the backing category is removed', async () => {
    const category = await service.categories.create({
      name: 'Budgeted',
      icon: 'wallet',
      type: 'expense',
    });
    const budget = await service.budgets.create({
      categoryId: category.id,
      amount: 50_000,
      month: 9,
      year: 2026,
    });

    await service.categories.delete(category.id);

    expect(await service.budgets.getById(budget.id)).toBeNull();
  });

  it('enforces unique (name, type) for categories', async () => {
    await service.categories.create({
      name: 'Unique',
      icon: 'star',
      type: 'expense',
    });
    await expect(
      service.categories.create({
        name: 'Unique',
        icon: 'star',
        type: 'expense',
      }),
    ).rejects.toBeInstanceOf(DatabaseError);

    // Same name under a different type is allowed.
    await expect(
      service.categories.create({name: 'Unique', icon: 'star', type: 'income'}),
    ).resolves.toHaveProperty('type', 'income');
  });

  it('keeps settings rows unique per key with upsert semantics', async () => {
    await service.settings.set('currency', 'PKR');
    await service.settings.set('currency', 'USD');

    expect(await service.settings.getAll()).toEqual([
      {key: 'currency', value: 'USD'},
    ]);
  });
});

describe('migration 002 — monthly budgets', () => {
  let driver: NodeSqliteDriver;
  let service: DatabaseService;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    service = await DatabaseService.open(driver);
  });

  afterEach(async () => {
    await service.close();
  });

  it('creates the monthly_budgets table and its period index', async () => {
    const tables = await driver.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map(row => row.name)).toContain('monthly_budgets');

    const indexes = await driver.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    );
    expect(indexes.map(row => row.name)).toContain(
      'idx_monthly_budgets_period',
    );
  });

  it('keeps migration 001 data intact after upgrading to v2', async () => {
    // The seeded categories from migration 001 must survive migration 002.
    expect(await service.categories.countByType('expense')).toBe(10);
    expect(await service.categories.countByType('income')).toBe(6);
    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);
  });

  it('enforces one budget per (year, month) via the unique index', async () => {
    await service.monthlyBudgets.create({
      amount: 300_000,
      month: 9,
      year: 2026,
    });
    await expect(
      service.monthlyBudgets.create({amount: 400_000, month: 9, year: 2026}),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('enforces the CHECK constraints (amount, month, year)', async () => {
    await expect(
      service.monthlyBudgets.create({amount: 0, month: 9, year: 2026}),
    ).rejects.toBeInstanceOf(DatabaseError);
    await expect(
      service.monthlyBudgets.create({amount: -1, month: 9, year: 2026}),
    ).rejects.toBeInstanceOf(DatabaseError);
    await expect(
      service.monthlyBudgets.create({amount: 100, month: 13, year: 2026}),
    ).rejects.toBeInstanceOf(DatabaseError);
    await expect(
      service.monthlyBudgets.create({amount: 100, month: 9, year: 1999}),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('migration 003 — category is_active', () => {
  let driver: NodeSqliteDriver;
  let service: DatabaseService;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    service = await DatabaseService.open(driver);
  });

  afterEach(async () => {
    await service.close();
  });

  it('adds the is_active column defaulting to active for every row', async () => {
    const columns = await driver.query<{name: string}>(
      "SELECT name FROM pragma_table_info('categories') ORDER BY name",
    );
    expect(columns.map(row => row.name)).toContain('is_active');

    const expenseCategories = await service.categories.list('expense');
    expect(expenseCategories.length).toBeGreaterThan(0);
    for (const category of [
      ...expenseCategories,
      ...(await service.categories.list('income')),
    ]) {
      expect(category.isActive).toBe(true);
    }
  });

  it('keeps migration 001/002 data intact after upgrading to v3', async () => {
    expect(await service.categories.countByType('expense')).toBe(10);
    expect(await service.categories.countByType('income')).toBe(6);
    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);
  });

  it('rejects non-boolean is_active values via CHECK', async () => {
    await expect(
      driver.run(
        "INSERT INTO categories (name, icon, type, is_default, is_active, created_at)\n         VALUES ('Broken', 'tag', 'expense', 0, 2, 0)",
      ),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('archives a category and keeps historical expenses resolvable', async () => {
    const expense = await createTestExpense(service);
    await service.categories.update(expense.categoryId, {isActive: false});

    const archived = await service.categories.getById(expense.categoryId);
    expect(archived?.isActive).toBe(false);

    // The joined read (used by ledger/report screens) still resolves the
    // archived category — historical records are never orphaned.
    const [joined] = await service.expenses.listWithCategory({
      categoryId: expense.categoryId,
    });
    expect(joined.categoryName).toBe(archived?.name);
    expect(joined.categoryIcon).toBe(archived?.icon);

    // Deleting is still blocked by the FK RESTRICT after archiving.
    await expect(
      service.categories.delete(expense.categoryId),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('existing-database upgrade paths (release readiness)', () => {
  it('upgrades a v2 database (pre-archive, pre-recurring) with zero data loss', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    // Build a genuine v2 database — migrations 001+002 only, i.e. exactly
    // what an app version predating migrations 003/004 would have on disk.
    const service = await DatabaseService.open(driver, {
      migrations: MIGRATIONS.slice(0, 2),
    });
    const versionBefore = await driver.query<{user_version: number}>(
      'PRAGMA user_version',
    );
    expect(versionBefore[0]!.user_version).toBe(2);

    // Representative user data, inserted with the OLD schema shape (raw SQL
    // so the test does not depend on current repository behavior).
    const ts = Date.now();
    await driver.run(
      `INSERT INTO categories (name, icon, type, is_default, created_at)
       VALUES ('Travel', 'airplane', 'expense', 0, ?)`,
      [ts],
    );
    const [cat] = await driver.query<{id: number}>(
      "SELECT id FROM categories WHERE name = 'Travel'",
    );
    await driver.run(
      `INSERT INTO expenses (amount, title, category_id, date, payment_method, note, created_at, updated_at)
       VALUES (?, 'Hotel booking', ?, ?, 'card', 'Lahore trip', ?, ?)`,
      [125_000, cat!.id, ts, ts, ts],
    );
    await driver.run(
      `INSERT INTO income (amount, source, date, note, created_at, updated_at)
       VALUES (?, 'Salary', ?, NULL, ?, ?)`,
      [500_000, ts, ts, ts],
    );
    await driver.run(
      `INSERT INTO budgets (category_id, amount, month, year, created_at, updated_at)
       VALUES (?, ?, 8, 2026, ?, ?)`,
      [cat!.id, 10_000, ts, ts],
    );
    await driver.run(
      `INSERT INTO monthly_budgets (amount, month, year, created_at, updated_at)
       VALUES (?, 8, 2026, ?, ?)`,
      [50_000, ts, ts],
    );
    await driver.run(
      `INSERT INTO settings (key, value) VALUES ('currency', 'PKR')`,
    );

    // Upgrade IN PLACE to the current schema.
    const version = await runMigrations(driver, MIGRATIONS);
    expect(version).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);

    // All pre-upgrade data reads back through the CURRENT repositories.
    const upgradedCategory = await service.categories.getById(cat!.id);
    expect(upgradedCategory?.name).toBe('Travel');
    expect(upgradedCategory?.isActive).toBe(true); // migration 003 default
    expect(await service.categories.countByType('expense')).toBe(11);

    const [expense] = await service.expenses.list();
    expect(expense?.amount).toBe(125_000);
    expect(expense?.title).toBe('Hotel booking');
    expect(expense?.recurringRuleId).toBeNull(); // 004 column; manual rows stay NULL

    const [income] = await service.income.list();
    expect(income?.amount).toBe(500_000);
    expect(income?.recurringRuleId).toBeNull();

    expect((await service.budgets.getById(1))?.amount).toBe(10_000);
    expect((await service.monthlyBudgets.getById(1))?.amount).toBe(50_000);
    expect(await service.settings.getAll()).toEqual([
      {key: 'currency', value: 'PKR'},
    ]);

    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);

    // The upgraded schema is fully FUNCTIONAL for the newest feature:
    // a recurring rule can be created against upgraded data.
    const rule = await service.recurring.create({
      type: 'expense',
      amount: 12_000,
      title: 'Hostel rent',
      categoryId: cat!.id,
      frequency: 'monthly',
      startDate: ts,
      paymentMethod: 'cash',
    });
    expect(rule.id).toBeGreaterThan(0);
    await service.close();
  });

  it('upgrades a v3 database (archived category) and the generation engine runs on it', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    const service = await DatabaseService.open(driver, {
      migrations: MIGRATIONS.slice(0, 3),
    });
    const versionBefore = await driver.query<{user_version: number}>(
      'PRAGMA user_version',
    );
    expect(versionBefore[0]!.user_version).toBe(3);

    // A user with an archived category and history pointing at it.
    const ts = Date.now();
    await driver.run(
      `INSERT INTO categories (name, icon, type, is_default, is_active, created_at)
       VALUES ('Old Gym', 'fitness', 'expense', 0, 0, ?)`,
      [ts],
    );
    const [cat] = await driver.query<{id: number}>(
      "SELECT id FROM categories WHERE name = 'Old Gym'",
    );
    await driver.run(
      `INSERT INTO expenses (amount, title, category_id, date, payment_method, created_at, updated_at)
       VALUES (?, 'Gym membership', ?, ?, 'cash', ?, ?)`,
      [30_000, cat!.id, ts, ts, ts],
    );

    const version = await runMigrations(driver, MIGRATIONS);
    expect(version).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);

    // Archive state survived migration 004 and history still resolves it.
    expect((await service.categories.getById(cat!.id))?.isActive).toBe(false);
    const [joined] = await service.expenses.listWithCategory({
      categoryId: cat!.id,
    });
    expect(joined.categoryName).toBe('Old Gym');
    expect(joined.categoryIcon).toBe('fitness');

    expect(await service.integrityCheck()).toBe('ok');
    expect(await service.foreignKeyCheck()).toEqual([]);

    // The occurrence-generation engine runs on the upgraded database and
    // tags generated rows with the rule id (partial UNIQUE indexes active).
    const activeCategory = await service.categories.create({
      name: 'Post Upgrade Cat',
      icon: 'wifi',
      type: 'expense',
    });
    const rule = await service.recurring.create({
      type: 'expense',
      amount: 15_000,
      title: 'Internet bill',
      categoryId: activeCategory.id,
      frequency: 'monthly',
      startDate: ts,
      paymentMethod: 'cash',
    });
    const result = await processDueRecurringTransactions(
      service,
      ts + 86_400_000,
    );
    expect(result.generatedExpenses).toBe(1);

    const generated = (await service.expenses.list()).find(
      row => row.recurringRuleId === rule.id,
    );
    expect(generated).toBeDefined();
    expect(generated?.amount).toBe(15_000);
    expect(generated?.title).toBe('Internet bill');
    await service.close();
  });
});
