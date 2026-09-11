/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {
  BackupValidationError,
  BackupVersionError,
} from '@/features/backup/errors';
import {createBackupFeature} from '@/features/backup/service';
import {BACKUP_FORMAT, BACKUP_VERSION} from '@/features/backup/types';
import {parseBackup} from '@/features/backup/validation';
import {createRecurringFeature} from './service';
import {noonOf} from './date';

/**
 * Backup integration (spec §24): new backups are FORMAT v2 and carry the
 * recurring rules; restore preserves rule ids, next occurrence, active
 * state and category relationships; generated transactions keep their
 * recurringRuleId; v1 backups still restore (migrated to an empty rules
 * list — their meaning is unchanged); and restore + processing never
 * duplicates an already-generated occurrence.
 */

const AUG_1 = noonOf(2026, 8, 1);
const SEP_1 = noonOf(2026, 9, 1);
const SEP_8 = noonOf(2026, 9, 8);
const OCT_1 = noonOf(2026, 10, 1);

async function seedSource(service: DatabaseService) {
  const category = await service.categories.create({
    name: 'Rent',
    icon: 'home',
    type: 'expense',
  });

  const recurring = createRecurringFeature(service);
  const rule = await recurring.addRule({
    type: 'expense',
    amount: 12_000_00,
    title: 'Hostel rent',
    categoryId: category.id,
    frequency: 'monthly',
    startDate: AUG_1,
    nextOccurrenceAt: AUG_1,
    paymentMethod: 'cash',
  });
  await recurring.addRule({
    type: 'income',
    amount: 85_000_00,
    title: 'Stipend',
    frequency: 'weekly',
    startDate: SEP_1,
    nextOccurrenceAt: SEP_1,
    isActive: false, // paused rules are data too
  });

  // Generate one occurrence so the ledger carries a linked transaction.
  await recurring.processDue(SEP_8);
  return {category, rule};
}

describe('backup v2 — recurring rules', () => {
  let source: DatabaseService;

  beforeEach(async () => {
    source = await createTestService();
  });

  afterEach(async () => {
    await source.close();
  });

  it('exports rules verbatim and round-trips through parseBackup', async () => {
    await seedSource(source);
    const feature = createBackupFeature(source);

    const json = await feature.generateBackupJson({appVersion: '1.0.0'});
    const backup = JSON.parse(json) as {version: number};
    expect(backup.version).toBe(BACKUP_VERSION);

    const validated = parseBackup(json);
    expect(validated.counts.recurringTransactions).toBe(2);

    const expenseRule = validated.data.recurringTransactions.find(
      candidate => candidate.type === 'expense',
    )!;
    expect(expenseRule.title).toBe('Hostel rent');
    expect(expenseRule.amount).toBe(12_000_00); // exact integer money
    expect(expenseRule.nextOccurrenceAt).toBe(OCT_1); // engine advanced it
    expect(expenseRule.isActive).toBe(true);
    expect(expenseRule.categoryId).toBeGreaterThan(0);

    const incomeRule = validated.data.recurringTransactions.find(
      candidate => candidate.type === 'income',
    )!;
    expect(incomeRule.isActive).toBe(false); // paused state preserved
    expect(incomeRule.categoryId).toBeNull();
  });

  it('restores rules, ids, next occurrence, active state and the generated linkage', async () => {
    await seedSource(source);
    const feature = createBackupFeature(source);
    const validated = parseBackup(await feature.generateBackupJson({}));

    const target = await createTestService();
    const result = await createBackupFeature(target).restoreBackup(validated);
    expect(result.recurringTransactions).toBe(2);

    const rules = await target.recurring.list();
    expect(rules).toHaveLength(2);

    const restoredExpenseRule = rules.find(rule => rule.type === 'expense')!;
    const sourceRules = await source.recurring.list();
    const sourceExpenseRule = sourceRules.find(
      rule => rule.type === 'expense',
    )!;
    expect(restoredExpenseRule.id).toBe(sourceExpenseRule.id); // ids preserved
    expect(restoredExpenseRule.nextOccurrenceAt).toBe(OCT_1);
    expect(restoredExpenseRule.categoryId).toBe(sourceExpenseRule.categoryId);

    const restoredIncomeRule = rules.find(rule => rule.type === 'income')!;
    expect(restoredIncomeRule.isActive).toBe(false);

    // Generated transaction keeps its provenance after the round trip.
    const expenses = await target.expenses.list();
    const generated = expenses.find(
      expense => expense.title === 'Hostel rent',
    )!;
    expect(generated.recurringRuleId).toBe(restoredExpenseRule.id);

    // And the FULL dataset deep-equals the source, rules included.
    await expect(target.recurring.list()).resolves.toEqual(
      await source.recurring.list(),
    );

    await target.close();
  });

  it('restore + processing never duplicates already-generated occurrences', async () => {
    await seedSource(source);
    const feature = createBackupFeature(source);
    const validated = parseBackup(await feature.generateBackupJson({}));

    const target = await createTestService();
    await createBackupFeature(target).restoreBackup(validated);

    // The rule's next occurrence (Oct 1) is ahead of "today" (Sep 8), so
    // processing right after the restore must generate NOTHING — the two
    // occurrences already inside the backup (Aug 1 + Sep 1) are the only ones.
    const recurring = createRecurringFeature(target);
    const result = await recurring.processDue(SEP_8);
    expect(result.generatedExpenses).toBe(0);
    expect(await target.expenses.count()).toBe(2);

    await target.close();
  });
});

describe('backup v1 compatibility', () => {
  let source: DatabaseService;

  beforeEach(async () => {
    source = await createTestService();
  });

  afterEach(async () => {
    await source.close();
  });

  it('still restores a v1 backup (migrated to an empty rules list)', async () => {
    // A hand-written v1 file exactly as Phase 7B produced them: no
    // recurringTransactions, no recurringRuleId anywhere.
    const v1 = {
      format: BACKUP_FORMAT,
      version: 1,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '1.0.0',
      currency: 'PKR',
      data: {
        categories: [
          {
            id: 1,
            name: 'Rent',
            icon: 'home',
            type: 'expense',
            isDefault: false,
            isActive: true,
            createdAt: 1_700_000_000_000,
          },
        ],
        expenses: [
          {
            id: 10,
            amount: 12_000_00,
            title: 'Old expense',
            categoryId: 1,
            date: 1_700_000_000_000,
            paymentMethod: 'cash',
            note: null,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        settings: [{key: 'currency', value: 'PKR'}],
      },
    };

    const validated = parseBackup(JSON.stringify(v1));
    expect(validated.counts.recurringTransactions).toBe(0);
    expect(validated.data.expenses[0]!.recurringRuleId).toBeNull();

    const target = await createTestService();
    const result = await createBackupFeature(target).restoreBackup(validated);
    expect(result.expenses).toBe(1);
    expect(result.recurringTransactions).toBe(0);
    expect((await target.expenses.list())[0]!.title).toBe('Old expense');
    expect(
      (await target.expenses.list())[0]!.recurringRuleId ?? null,
    ).toBeNull();

    // v1 semantics are unchanged — restoring twice stays duplicate-free.
    await createBackupFeature(target).restoreBackup(validated);
    expect(await target.expenses.count()).toBe(1);

    await target.close();
  });

  it('rejects a v2 backup missing the recurringTransactions list', async () => {
    const v2MissingRules = {
      format: BACKUP_FORMAT,
      version: 2,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '1.0.0',
      currency: 'PKR',
      data: {
        categories: [],
        expenses: [],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        settings: [],
      },
    };
    expect(() => parseBackup(JSON.stringify(v2MissingRules))).toThrow(
      BackupValidationError,
    );
  });

  it('rejects versions beyond the current one', async () => {
    const future = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION + 1,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '1.0.0',
      currency: 'PKR',
      data: {
        categories: [],
        expenses: [],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        recurringTransactions: [],
        settings: [],
      },
    };
    expect(() => parseBackup(JSON.stringify(future))).toThrow(
      BackupVersionError,
    );
  });

  it('rejects rules that reference missing or mistyped categories', async () => {
    const badCategory = {
      format: BACKUP_FORMAT,
      version: 2,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '1.0.0',
      currency: 'PKR',
      data: {
        categories: [
          {
            id: 1,
            name: 'Rent',
            icon: 'home',
            type: 'expense',
            isDefault: false,
            isActive: true,
            createdAt: 1_700_000_000_000,
          },
        ],
        expenses: [],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        recurringTransactions: [
          {
            id: 50,
            type: 'expense',
            amount: 1_000,
            title: 'Orphan rule',
            categoryId: 4242, // no such category in the backup
            frequency: 'monthly',
            startDate: SEP_1,
            nextOccurrenceAt: SEP_1,
            endDate: null,
            paymentMethod: 'cash',
            note: null,
            isActive: true,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ],
        settings: [],
      },
    };
    expect(() => parseBackup(JSON.stringify(badCategory))).toThrow(
      BackupValidationError,
    );

    const badType = JSON.parse(
      JSON.stringify(badCategory),
    ) as typeof badCategory & {
      data: {
        categories: {id: number; type: string}[];
        recurringTransactions: {categoryId: number}[];
      };
    };
    badType.data.recurringTransactions[0]!.categoryId = 1;
    badType.data.categories[0]!.type = 'income';
    expect(() => parseBackup(JSON.stringify(badType))).toThrow(
      BackupValidationError,
    );
  });

  it('rejects transactions referencing unknown or mistyped rules', async () => {
    const base = {
      format: BACKUP_FORMAT,
      version: 2,
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '1.0.0',
      currency: 'PKR',
      data: {
        categories: [
          {
            id: 1,
            name: 'Rent',
            icon: 'home',
            type: 'expense',
            isDefault: false,
            isActive: true,
            createdAt: 1_700_000_000_000,
          },
        ],
        expenses: [
          {
            id: 10,
            amount: 100,
            title: 'Linked expense',
            categoryId: 1,
            date: SEP_1,
            paymentMethod: 'cash',
            note: null,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            recurringRuleId: 50,
          },
        ],
        income: [],
        budgets: [],
        monthlyBudgets: [],
        recurringTransactions: [] as unknown[],
        settings: [],
      },
    };
    expect(() => parseBackup(JSON.stringify(base))).toThrow(
      BackupValidationError,
    );
  });
});
