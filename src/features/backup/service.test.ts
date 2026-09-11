/**
 * @jest-environment node
 */
import type {DatabaseDriver} from '@/database/driver';
import {createTestService} from '@/database/testing/helpers';
import {DatabaseService} from '@/database/service';
import {
  BackupParseError,
  BackupRestoreError,
  BackupValidationError,
  BackupVersionError,
  describeBackupError,
} from './errors';
import {createBackupFeature, type BackupFeature} from './service';
import type {ValidatedBackup} from './types';
import {parseBackup} from './validation';

/**
 * Restore + export on the REAL SQLite engine.
 *
 * Focus areas (spec §12-§16, §22): full-dataset replacement with preserved
 * ids and relationships, duplicate-free re-restores, untouched schema /
 * migrations metadata, FK integrity, and ROLLBACK — a failed restore must
 * leave the previous dataset completely intact.
 */

const T0 = 1_700_000_000_000;
const T1 = T0 + 24 * 60 * 60 * 1000;

/**
 * Test double that fails selected statements, simulating a database-level
 * error in the middle of the restore transaction.
 */
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

async function makeSourceBackup(): Promise<{
  source: DatabaseService;
  json: string;
  validated: ValidatedBackup;
}> {
  const source = await createTestService();

  const groceries = await source.categories.findByName('Groceries', 'expense');
  await source.categories.update(groceries!.id, {isActive: false});
  const custom = await source.categories.create({
    name: 'Auto & Travel',
    icon: 'bus',
    type: 'expense',
  });

  await source.expenses.create({
    amount: 125_050,
    title: 'Ride to office',
    categoryId: custom.id,
    date: T0,
    paymentMethod: 'card',
    note: 'Careem, "airport" run',
  });
  await source.expenses.create({
    amount: 1,
    title: 'One paisa expense',
    categoryId: groceries!.id, // archived category — history must resolve
    date: T1,
    paymentMethod: 'cash',
    note: null,
  });
  await source.income.create({
    amount: 9_999_999_999,
    source: 'September salary',
    date: T0,
    note: 'Salary\nwith a newline',
  });
  await source.budgets.create({
    categoryId: custom.id,
    amount: 10_000_000,
    month: 9,
    year: 2026,
  });
  await source.monthlyBudgets.create({
    amount: 50_000_000,
    month: 9,
    year: 2026,
  });
  await source.settings.set('currency', 'USD');
  await source.settings.set('themeMode', 'dark');

  const feature = createBackupFeature(source);
  const json = await feature.generateBackupJson({appVersion: '0.1.0'});

  return {source, json, validated: parseBackup(json)};
}

async function makeDirtyTarget(): Promise<DatabaseService> {
  // A database with its own DIFFERENT data that the restore must replace.
  const target = await createTestService();
  const temp = await target.categories.create({
    name: 'Temporary Category',
    icon: 'pricetag',
    type: 'expense',
  });
  await target.expenses.create({
    amount: 42,
    title: 'Doomed expense',
    categoryId: temp.id,
    date: T0,
    paymentMethod: 'cash',
  });
  await target.income.create({
    amount: 7,
    source: 'Doomed income',
    date: T0,
  });
  await target.settings.set('currency', 'EUR');
  return target;
}

describe('BackupFeature — CSV export', () => {
  let source: DatabaseService;
  let feature: BackupFeature;

  beforeEach(async () => {
    source = await createTestService();
    feature = createBackupFeature(source);
  });

  afterEach(async () => {
    await source.close();
  });

  it('resolves CATEGORY NAMES (including archived) via the join', async () => {
    const groceries = await source.categories.findByName(
      'Groceries',
      'expense',
    );
    await source.categories.update(groceries!.id, {isActive: false});
    const expense = await source.expenses.create({
      amount: 125_050,
      title: 'Veggies',
      categoryId: groceries!.id,
      date: T0,
      paymentMethod: 'cash',
    });

    const csv = await feature.generateTransactionsCsv();
    const lines = csv.trimEnd().split('\r\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Type,Date,Amount,Title,Category,Payment Method,Source,Note,Created At,Updated At,Recurring',
    );
    expect(lines[1]).toContain(',1250.50,');
    expect(lines[1]).toContain(',Veggies,');
    expect(lines[1]).toContain(',Groceries,'); // archived name still resolves
    expect(expense.id).toBeGreaterThan(0);
  });

  it('exports an empty ledger as header-only CSV', async () => {
    const csv = await feature.generateTransactionsCsv();
    expect(csv.trimEnd().split('\r\n')).toHaveLength(1);
  });
});

describe('BackupFeature — restore replaces the dataset', () => {
  it('restores a full backup with ids, relationships and settings intact', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();
    const feature = createBackupFeature(target);

    const result = await feature.restoreBackup(validated);

    expect(result).toEqual({
      categories: validated.counts.categories,
      expenses: 2,
      income: 1,
      budgets: 1,
      monthlyBudgets: 1,
      recurringTransactions: 0,
      settings: 2,
    });

    // The ENTIRE dataset now deep-equals the source database's rows.
    await expect(target.categories.list()).resolves.toEqual(
      await source.categories.list(),
    );
    await expect(target.expenses.list()).resolves.toEqual(
      await source.expenses.list(),
    );
    await expect(target.income.list()).resolves.toEqual(
      await source.income.list(),
    );
    await expect(target.budgets.listAll()).resolves.toEqual(
      await source.budgets.listAll(),
    );
    await expect(target.monthlyBudgets.listAll()).resolves.toEqual(
      await source.monthlyBudgets.listAll(),
    );
    await expect(target.settings.getAll()).resolves.toEqual(
      await source.settings.getAll(),
    );

    await source.close();
    await target.close();
  });

  it('keeps historical records resolvable to ARCHIVED categories', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();
    const feature = createBackupFeature(target);
    await feature.restoreBackup(validated);

    const rows = await target.expenses.listWithCategory();
    const historical = rows.find(row => row.title === 'One paisa expense')!;
    expect(historical.categoryName).toBe('Groceries');
    expect(historical.categoryId).not.toBeNull();

    // New-transaction pickers only offer ACTIVE categories.
    const activeExpenseNames = (
      await target.categories.list('expense', {activeOnly: true})
    ).map(category => category.name);
    expect(activeExpenseNames).not.toContain('Groceries');
    expect(activeExpenseNames).toContain('Auto & Travel');

    await source.close();
    await target.close();
  });

  it('does not create duplicates when the same backup is restored twice', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();
    const feature = createBackupFeature(target);

    await feature.restoreBackup(validated);
    const afterFirst = {
      expenses: await target.expenses.count(),
      categories: (await target.categories.list()).length,
    };
    await feature.restoreBackup(validated);
    const afterSecond = {
      expenses: await target.expenses.count(),
      categories: (await target.categories.list()).length,
    };

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.expenses).toBe(2);
    expect(afterSecond.categories).toBe(validated.counts.categories);

    await source.close();
    await target.close();
  });

  it('restores into an EMPTY database (fresh install scenario)', async () => {
    const {source, validated} = await makeSourceBackup();
    const fresh = await createTestService();
    const feature = createBackupFeature(fresh);

    await feature.restoreBackup(validated);

    await expect(fresh.expenses.list()).resolves.toEqual(
      await source.expenses.list(),
    );
    await expect(fresh.settings.getAll()).resolves.toEqual([
      {key: 'currency', value: 'USD'},
      {key: 'themeMode', value: 'dark'},
    ]);

    await source.close();
    await fresh.close();
  });

  it('preserves schema state: migrations metadata, integrity, FK check', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();
    const feature = createBackupFeature(target);

    await feature.restoreBackup(validated);

    const version = await target.driver.query<{user_version: number}>(
      'PRAGMA user_version',
    );
    expect(version[0]?.user_version).toBe(4);
    await expect(target.integrityCheck()).resolves.toBe('ok');
    await expect(target.foreignKeyCheck()).resolves.toEqual([]);

    await source.close();
    await target.close();
  });

  it('preserves exact integer amounts (no rounding, no conversion)', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();
    await createBackupFeature(target).restoreBackup(validated);

    const restored = await target.income.list();
    expect(restored[0]!.amount).toBe(9_999_999_999); // 99999999.99 in paisa

    await source.close();
    await target.close();
  });

  it('continues AUTOINCREMENT beyond restored ids after a restore', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();
    await createBackupFeature(target).restoreBackup(validated);

    const firstCategory = (await source.categories.list())[0]!;
    const created = await target.categories.create({
      name: 'Post Restore Category',
      icon: 'pricetag',
      type: 'expense',
    });
    expect(created.id).toBeGreaterThan(firstCategory.id);

    await source.close();
    await target.close();
  });
});

describe('BackupFeature — atomic restore on failure', () => {
  it('rolls back EVERYTHING when an insert fails mid-restore', async () => {
    const {source, validated} = await makeSourceBackup();
    const target = await makeDirtyTarget();

    // Snapshot the pre-restore state:
    const before = {
      categories: await target.categories.list(),
      expenses: await target.expenses.list(),
      income: await target.income.list(),
      settings: await target.settings.getAll(),
    };

    const failingService = await DatabaseService.open(
      new FaultInjectionDriver(target.driver, sql =>
        sql.startsWith('INSERT INTO income')
          ? new Error('injected failure')
          : null,
      ),
    );

    await expect(
      createBackupFeature(failingService).restoreBackup(validated),
    ).rejects.toThrow(BackupRestoreError);

    // The ROLLBACK left the previous dataset untouched, row for row.
    await expect(target.categories.list()).resolves.toEqual(before.categories);
    await expect(target.expenses.list()).resolves.toEqual(before.expenses);
    await expect(target.income.list()).resolves.toEqual(before.income);
    await expect(target.settings.getAll()).resolves.toEqual(before.settings);

    await expect(target.integrityCheck()).resolves.toBe('ok');
    await expect(target.foreignKeyCheck()).resolves.toEqual([]);
    const version = await target.driver.query<{user_version: number}>(
      'PRAGMA user_version',
    );
    expect(version[0]?.user_version).toBe(4);

    await source.close();
    await target.close();
  });

  it('rolls back when the backup violates a database constraint', async () => {
    // A hand-tampered "validated" backup whose expense points at a category
    // id that does not exist after the DELETE phase — the FK backstop must
    // reject it and roll back.
    const {source, validated} = await makeSourceBackup();
    await source.close(); // only its data matters here

    const tampered = JSON.parse(JSON.stringify(validated)) as ValidatedBackup;
    tampered.data.expenses[0]!.categoryId = 4242; // missing after wipe

    const target = await makeDirtyTarget();
    const before = await target.expenses.list();

    await expect(
      createBackupFeature(target).restoreBackup(tampered),
    ).rejects.toThrow(BackupRestoreError);

    await expect(target.expenses.list()).resolves.toEqual(before);

    await target.close();
  });

  it('reports failures with a calm, user-safe message (no SQL leakage)', async () => {
    const {source, validated} = await makeSourceBackup();
    await source.close();
    const target = await makeDirtyTarget();

    const failingService = await DatabaseService.open(
      new FaultInjectionDriver(target.driver, sql =>
        sql.startsWith('INSERT INTO income')
          ? new Error('injected failure with SQL secrets')
          : null,
      ),
    );

    const error = await createBackupFeature(failingService)
      .restoreBackup(validated)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BackupRestoreError);
    expect((error as Error).message).toBe(
      'The restore failed and your current data was left unchanged.',
    );
    expect((error as Error).message).not.toContain('injected');
    expect(describeBackupError(error)).toBe(
      'The restore failed and your current data was left unchanged.',
    );

    await target.close();
  });
});

describe('BackupFeature — validation happens BEFORE the database is touched', () => {
  let service: DatabaseService;
  let feature: BackupFeature;

  beforeEach(async () => {
    // A real service, but parse-level rejections must never reach it.
    service = await createTestService();
    feature = createBackupFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  it('rejects malformed JSON with BackupParseError', () => {
    expect(() => feature.parseBackup('{oops')).toThrow(BackupParseError);
    // Nothing was modified (nothing could be — restore never started).
    expect(() => feature.parseBackup('{oops')).not.toThrow(BackupRestoreError);
  });

  it('rejects unknown backup versions without touching the database', () => {
    const json = JSON.stringify({
      format: 'kharcha-backup',
      version: 99,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '0.1.0',
      currency: 'PKR',
      data: {
        categories: [],
        expenses: [],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        settings: [],
      },
    });
    expect(() => feature.parseBackup(json)).toThrow(BackupVersionError);
    expect(describeBackupError(new BackupVersionError(99))).toMatch(
      /version this app cannot restore/i,
    );
  });

  it('rejects structurally broken records before any DELETE runs', () => {
    const json = JSON.stringify({
      format: 'kharcha-backup',
      version: 1,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '0.1.0',
      currency: 'PKR',
      data: {
        categories: [{id: 1, name: 'No Icon', type: 'expense'}],
        expenses: [],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        settings: [],
      },
    });
    expect(() => feature.parseBackup(json)).toThrow(BackupValidationError);
  });
});
