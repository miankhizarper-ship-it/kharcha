/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {PAYMENT_METHODS} from '@/database/models';
import {
  buildBackup,
  buildBackupFilename,
  serializeBackup,
} from './serialization';
import {buildCsvFilename} from './csvExport';
import {parseBackup} from './validation';
import {BACKUP_FORMAT, BACKUP_VERSION} from './types';

/**
 * Backup building + serialization on the REAL SQLite engine: the file must
 * mirror the stored domain rows exactly (integer money, epoch-millis dates,
 * booleans for 0/1 flags) and survive a serialize → parse round trip.
 */

/** Local noon keeps the expected filename stable regardless of the test TZ. */
const SEED_DAY = new Date(2026, 8, 8, 12, 0, 0, 0).getTime();
const T0 = 1_700_000_000_000;

async function seedDatabase(service: DatabaseService): Promise<void> {
  // Disable a seeded category and add a custom one — the backup must carry
  // BOTH, with isActive/isDefault as booleans.
  const groceries = await service.categories.findByName('Groceries', 'expense');
  await service.categories.update(groceries!.id, {isActive: false});

  const custom = await service.categories.create({
    name: 'Transport Extra',
    icon: 'bus',
    type: 'expense',
  });

  await service.categories.findByName('Salary', 'income');
  const expense = await service.expenses.create({
    amount: 125_050, // 1250.50 exactly — integer paisa
    title: 'Auto fare',
    categoryId: custom.id,
    date: T0,
    paymentMethod: 'mobile_wallet',
    note: 'Careem ride',
  });
  await service.expenses.update(expense.id, {title: 'Auto fare (edited)'});

  await service.income.create({
    amount: 9_999_999_999, // 99999999.99 — largest supported amount
    source: 'Freelance project',
    date: T0,
  });

  await service.budgets.create({
    categoryId: custom.id,
    amount: 10_000_000,
    month: 9,
    year: 2026,
  });
  await service.monthlyBudgets.create({
    amount: 50_000_000,
    month: 9,
    year: 2026,
  });
  await service.settings.set('currency', 'USD');
}

describe('backup filenames', () => {
  it('uses the documented, date-stamped names', () => {
    expect(buildBackupFilename(SEED_DAY)).toBe(
      'Kharcha_Backup_2026-09-08.json',
    );
  });

  it('uses the lowercase, range-aware CSV scheme (Phase 10)', () => {
    expect(buildCsvFilename(SEED_DAY)).toBe(
      'kharcha-transactions-2026-09-08.csv',
    );
  });
});

describe('buildBackup', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
    await seedDatabase(service);
  });

  afterEach(async () => {
    await service.close();
  });

  it('writes the versioned envelope with metadata', async () => {
    const backup = await buildBackup(service, {
      appVersion: '0.1.0',
      now: SEED_DAY,
    });
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.createdAt).toBe(new Date(SEED_DAY).toISOString());
    expect(backup.appVersion).toBe('0.1.0');
    // The envelope currency mirrors the restored/stored setting:
    expect(backup.currency).toBe('USD');
  });

  it('includes every category — active AND archived', async () => {
    const backup = await buildBackup(service, {now: SEED_DAY});
    const names = backup.data.categories.map(category => category.name);
    expect(names).toContain('Groceries'); // seeded + archived in the seed
    expect(names).toContain('Transport Extra');

    const archived = backup.data.categories.find(
      category => category.name === 'Groceries',
    )!;
    expect(archived.isActive).toBe(false);
    expect(archived.isDefault).toBe(true);
    expect(typeof archived.id).toBe('number');
  });

  it('copies transaction rows verbatim — integer money, exact timestamps', async () => {
    const backup = await buildBackup(service, {now: SEED_DAY});

    const edited = backup.data.expenses.find(row => row.id !== undefined)!;
    expect(edited.title).toBe('Auto fare (edited)');
    expect(edited.amount).toBe(125_050);
    expect(edited.date).toBe(T0);
    expect(edited.paymentMethod).toBe('mobile_wallet');
    expect(edited.note).toBe('Careem ride');
    expect(Number.isSafeInteger(edited.createdAt)).toBe(true);

    const income = backup.data.income[0]!;
    expect(income.amount).toBe(9_999_999_999);
    expect(income.source).toBe('Freelance project');
  });

  it('includes budgets, monthly budgets and settings', async () => {
    const backup = await buildBackup(service, {now: SEED_DAY});
    expect(backup.data.budgets).toHaveLength(1);
    expect(backup.data.budgets[0]).toMatchObject({
      amount: 10_000_000,
      month: 9,
      year: 2026,
    });
    expect(backup.data.monthlyBudgets).toHaveLength(1);
    expect(backup.data.settings).toEqual([{key: 'currency', value: 'USD'}]);
  });

  it('does not leak SQLite internals (only documented keys are present)', async () => {
    const backup = await buildBackup(service, {now: SEED_DAY});
    expect(Object.keys(backup).sort()).toEqual([
      'appVersion',
      'createdAt',
      'currency',
      'data',
      'format',
      'version',
    ]);
    expect(Object.keys(backup.data.categories[0]!).sort()).toEqual([
      'createdAt',
      'icon',
      'id',
      'isActive',
      'isDefault',
      'name',
      'type',
    ]);
    expect(Object.keys(backup.data.expenses[0]!).sort()).toEqual([
      'amount',
      'categoryId',
      'createdAt',
      'date',
      'id',
      'note',
      'paymentMethod',
      'recurringRuleId',
      'title',
      'updatedAt',
    ]);
  });

  it('round-trips through serializeBackup → parseBackup unchanged', async () => {
    const backup = await buildBackup(service, {now: SEED_DAY});
    const json = serializeBackup(backup);

    const restored = parseBackup(json);
    expect(restored.data).toEqual(backup.data);
    expect(restored.counts).toEqual({
      categories: backup.data.categories.length,
      expenses: backup.data.expenses.length,
      income: backup.data.income.length,
      budgets: backup.data.budgets.length,
      monthlyBudgets: backup.data.monthlyBudgets.length,
      recurringTransactions: backup.data.recurringTransactions.length,
      settings: backup.data.settings.length,
    });
  });

  it('serializes amounts as exact JSON integers (never floats/strings)', async () => {
    const backup = await buildBackup(service, {now: SEED_DAY});
    const json = serializeBackup(backup);
    expect(json).toContain('"amount": 9999999999');
    expect(json).toContain('"amount": 125050');
    // Sanity: the enum is untouched by the export.
    expect(PAYMENT_METHODS).toContain(backup.data.expenses[0]!.paymentMethod);
  });

  it('falls back to the default currency when none is stored', async () => {
    const fresh = await createTestService();
    const backup = await buildBackup(fresh, {now: SEED_DAY});
    expect(backup.currency).toBe('PKR');
    expect(backup.data.settings).toEqual([]);
    await fresh.close();
  });
});
