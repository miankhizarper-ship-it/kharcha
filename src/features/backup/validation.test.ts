import {
  BackupFormatError,
  BackupParseError,
  BackupValidationError,
  BackupVersionError,
} from './errors';
import {parseBackup, validateBackupObject} from './validation';
import {BACKUP_FORMAT, BACKUP_VERSION, type KharchaBackup} from './types';

/**
 * Backup validation — corrupted, foreign or structurally invalid backups
 * are rejected with typed errors BEFORE any database is touched.
 *
 * Fixtures use the CURRENT format (v2). The v1 → v2 migration path is
 * covered explicitly in `features/recurring/backup.test.ts`.
 */

function buildValidBackup(): KharchaBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: '2026-09-08T10:30:00.000Z',
    appVersion: '0.1.0',
    currency: 'PKR',
    data: {
      categories: [
        {
          id: 1,
          name: 'Food & Dining',
          icon: 'restaurant',
          type: 'expense',
          isDefault: true,
          isActive: true,
          createdAt: 1_700_000_000_000,
        },
        {
          id: 2,
          name: 'Old Category',
          icon: 'pricetag',
          type: 'expense',
          isDefault: false,
          isActive: false,
          createdAt: 1_700_000_000_000,
        },
        {
          id: 3,
          name: 'Salary',
          icon: 'briefcase',
          type: 'income',
          isDefault: true,
          isActive: true,
          createdAt: 1_700_000_000_000,
        },
      ],
      expenses: [
        {
          id: 10,
          amount: 125050,
          title: 'Lunch',
          categoryId: 1,
          date: 1_700_000_000_000,
          paymentMethod: 'cash',
          note: null,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          recurringRuleId: null,
        },
        {
          id: 11,
          amount: 1,
          title: 'Disabled-category record',
          categoryId: 2,
          date: 1_700_000_000_000,
          paymentMethod: 'card',
          note: 'history referencing an archived category',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          recurringRuleId: null,
        },
      ],
      income: [
        {
          id: 20,
          amount: 5_000_000,
          source: 'Salary',
          date: 1_700_000_000_000,
          note: null,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          recurringRuleId: null,
        },
      ],
      budgets: [
        {
          id: 30,
          categoryId: 1,
          amount: 10_000_000,
          month: 9,
          year: 2026,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      ],
      monthlyBudgets: [
        {
          id: 40,
          amount: 50_000_000,
          month: 9,
          year: 2026,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      ],
      recurringTransactions: [],
      settings: [
        {key: 'currency', value: 'PKR'},
        {key: 'themeMode', value: 'dark'},
      ],
    },
  };
}

/** Structural clone so each rejection test can mutate one field. */
function clone(backup: KharchaBackup): KharchaBackup {
  return JSON.parse(JSON.stringify(backup)) as KharchaBackup;
}

function expectValidationError(run: () => unknown, pattern?: RegExp): void {
  try {
    run();
    throw new Error('expected validation to throw');
  } catch (error) {
    if (error instanceof BackupValidationError === false) {
      throw error;
    }
    if (pattern && !pattern.test(error.message)) {
      throw new Error(
        `message "${error.message}" did not match ${String(pattern)}`,
      );
    }
  }
}

describe('validateBackupObject — acceptance', () => {
  it('accepts a fully valid backup and reports its counts', () => {
    const validated = validateBackupObject(buildValidBackup());
    expect(validated.counts).toEqual({
      categories: 3,
      expenses: 2,
      income: 1,
      budgets: 1,
      monthlyBudgets: 1,
      recurringTransactions: 0,
      settings: 2,
    });
    expect(validated.meta).toEqual({
      createdAt: '2026-09-08T10:30:00.000Z',
      appVersion: '0.1.0',
    });
  });

  it('accepts archived categories, null notes and an empty dataset', () => {
    const backup = buildValidBackup();
    backup.data.expenses = [];
    backup.data.budgets = [];
    backup.data.monthlyBudgets = [];
    backup.data.settings = [];
    expect(() => validateBackupObject(backup)).not.toThrow();
  });

  it('preserves exact integer amounts through validation', () => {
    const backup = buildValidBackup();
    backup.data.expenses[0]!.amount = 9_999_999_999;
    const validated = validateBackupObject(backup);
    expect(validated.data.expenses[0]!.amount).toBe(9_999_999_999);
  });
});

describe('validateBackupObject — envelope', () => {
  it('rejects non-object payloads', () => {
    expectValidationError(() => validateBackupObject(null));
    expectValidationError(() => validateBackupObject('backup'));
    expectValidationError(() => validateBackupObject([]));
  });

  it('rejects a missing or foreign format identifier', () => {
    const noFormat = clone(buildValidBackup());
    delete (noFormat as {format?: string}).format;
    expect(() => validateBackupObject(noFormat)).toThrow(BackupFormatError);

    const foreign = clone(buildValidBackup());
    (foreign as {format: string}).format = 'some-other-app-backup';
    expect(() => validateBackupObject(foreign)).toThrow(BackupFormatError);
  });

  it('rejects missing, non-numeric and unsupported versions', () => {
    // `2` is now the SUPPORTED version (Phase 7C); the unsupported
    // boundary moved to 3 — every other invalid shape still rejects.
    for (const version of [undefined, 0, 3, '1', 1.5, null]) {
      const backup = clone(buildValidBackup());
      (backup as {version?: unknown}).version = version;
      expect(() => validateBackupObject(backup)).toThrow(BackupVersionError);
    }
  });

  it('rejects missing createdAt / appVersion / currency', () => {
    for (const field of ['createdAt', 'appVersion', 'currency'] as const) {
      const backup = clone(buildValidBackup());
      delete (backup as unknown as Record<string, unknown>)[field];
      expectValidationError(
        () => validateBackupObject(backup),
        new RegExp(field),
      );
    }
  });

  it('rejects a missing or non-object data section', () => {
    const backup = clone(buildValidBackup());
    delete (backup as {data?: unknown}).data;
    expectValidationError(() => validateBackupObject(backup), /data/);

    const arrayData = clone(buildValidBackup());
    (arrayData as {data: unknown}).data = [];
    expectValidationError(() => validateBackupObject(arrayData), /data/);
  });

  it('rejects a missing or non-array entity list', () => {
    for (const key of [
      'categories',
      'expenses',
      'income',
      'budgets',
      'monthlyBudgets',
      'recurringTransactions',
      'settings',
    ] as const) {
      const backup = clone(buildValidBackup());
      delete (backup.data as unknown as Record<string, unknown>)[key];
      expectValidationError(
        () => validateBackupObject(backup),
        new RegExp(`data\\.${key}`),
      );

      const notArray = clone(buildValidBackup());
      (notArray.data as unknown as Record<string, unknown>)[key] = {};
      expectValidationError(
        () => validateBackupObject(notArray),
        new RegExp(`data\\.${key}`),
      );
    }
  });
});

describe('validateBackupObject — records', () => {
  it('rejects categories with invalid ids, names, icons, types or flags', () => {
    const cases: ((category: Record<string, unknown>) => void)[] = [
      category => (category.id = 0),
      category => (category.id = 1.5),
      category => (category.id = '1'),
      category => (category.name = ''),
      category => (category.name = undefined),
      category => (category.name = 'x'.repeat(101)),
      category => (category.icon = ''),
      category => (category.icon = 'x'.repeat(51)),
      category => (category.type = 'both'),
      category => (category.type = undefined),
      category => (category.isDefault = 1), // SQLite-style 0/1 is NOT the file format
      category => (category.isActive = 'yes'),
      category => (category.createdAt = -1),
      category => (category.createdAt = 1.5),
      category => delete category.createdAt,
    ];
    for (const mutate of cases) {
      const backup = clone(buildValidBackup());
      mutate(backup.data.categories[0] as unknown as Record<string, unknown>);
      expectValidationError(
        () => validateBackupObject(backup),
        /categories\[0\]/,
      );
    }
  });

  it('rejects expenses with invalid amounts, dates or payment methods', () => {
    const cases: ((expense: Record<string, unknown>) => void)[] = [
      expense => (expense.amount = 0), // CHECK (amount > 0) mirror
      expense => (expense.amount = -5),
      expense => (expense.amount = 1250.5), // floats are never valid money here
      expense => (expense.amount = '125050'),
      expense => (expense.title = ''),
      expense => (expense.title = 'x'.repeat(201)),
      expense => (expense.categoryId = 0),
      expense => (expense.categoryId = 999), // unknown relationship
      expense => (expense.date = 0),
      expense => (expense.paymentMethod = 'bitcoin'),
      expense => (expense.note = 42),
      expense => (expense.note = 'x'.repeat(2001)),
      expense => delete expense.updatedAt,
    ];
    for (const mutate of cases) {
      const backup = clone(buildValidBackup());
      mutate(backup.data.expenses[0] as unknown as Record<string, unknown>);
      expectValidationError(
        () => validateBackupObject(backup),
        /expenses\[0\]/,
      );
    }
  });

  it('rejects income records with invalid sources or amounts', () => {
    const backup = clone(buildValidBackup());
    (backup.data.income[0] as unknown as Record<string, unknown>).source = '';
    expectValidationError(() => validateBackupObject(backup), /income\[0\]/);

    const badAmount = clone(buildValidBackup());
    (badAmount.data.income[0] as unknown as Record<string, unknown>).amount = 0;
    expectValidationError(() => validateBackupObject(badAmount), /income\[0\]/);
  });

  it('rejects budgets outside the schema month/year ranges', () => {
    const cases: ((budget: Record<string, unknown>) => void)[] = [
      budget => (budget.month = 0),
      budget => (budget.month = 13),
      budget => (budget.year = 1999),
      budget => (budget.year = 2101),
      budget => (budget.amount = 0),
      budget => (budget.categoryId = 999), // unknown category
      budget => (budget.categoryId = 3), // income category
    ];
    for (const mutate of cases) {
      const backup = clone(buildValidBackup());
      mutate(backup.data.budgets[0] as unknown as Record<string, unknown>);
      expectValidationError(() => validateBackupObject(backup), /budgets\[0\]/);
    }
  });

  it('rejects monthly budgets outside the schema month/year ranges', () => {
    const backup = clone(buildValidBackup());
    (
      backup.data.monthlyBudgets[0] as unknown as Record<string, unknown>
    ).month = 13;
    expectValidationError(
      () => validateBackupObject(backup),
      /monthlyBudgets\[0\]/,
    );
  });

  it('rejects settings with empty keys or non-string values', () => {
    const backup = clone(buildValidBackup());
    (backup.data.settings[0] as unknown as Record<string, unknown>).key = '';
    expectValidationError(() => validateBackupObject(backup), /settings\[0\]/);

    const badValue = clone(buildValidBackup());
    (badValue.data.settings[0] as unknown as Record<string, unknown>).value = 5;
    expectValidationError(
      () => validateBackupObject(badValue),
      /settings\[0\]/,
    );
  });
});

describe('validateBackupObject — relationships and uniqueness', () => {
  it('rejects an expense whose category type mismatches', () => {
    const backup = clone(buildValidBackup());
    (backup.data.expenses[0] as unknown as Record<string, unknown>).categoryId =
      3; // income category
    expectValidationError(
      () => validateBackupObject(backup),
      /expenses\[0\].*not an expense category/,
    );
  });

  it('rejects a budget whose category type mismatches', () => {
    const backup = clone(buildValidBackup());
    (backup.data.budgets[0] as unknown as Record<string, unknown>).categoryId =
      3;
    expectValidationError(
      () => validateBackupObject(backup),
      /budgets\[0\].*not an expense category/,
    );
  });

  it('rejects duplicate ids within every entity list', () => {
    const duplicateCategory = clone(buildValidBackup());
    duplicateCategory.data.categories[1]!.id =
      duplicateCategory.data.categories[0]!.id;
    expectValidationError(
      () => validateBackupObject(duplicateCategory),
      /categories/,
    );

    const duplicateExpense = clone(buildValidBackup());
    duplicateExpense.data.expenses[1]!.id =
      duplicateExpense.data.expenses[0]!.id;
    expectValidationError(
      () => validateBackupObject(duplicateExpense),
      /expenses/,
    );

    const duplicateIncome = clone(buildValidBackup());
    duplicateIncome.data.income.push({...duplicateIncome.data.income[0]!});
    expectValidationError(
      () => validateBackupObject(duplicateIncome),
      /income/,
    );

    const duplicateMonthly = clone(buildValidBackup());
    duplicateMonthly.data.monthlyBudgets.push({
      ...duplicateMonthly.data.monthlyBudgets[0]!,
      id: 41,
    });
    expectValidationError(
      () => validateBackupObject(duplicateMonthly),
      /monthlyBudgets/,
    );
  });

  it('rejects duplicate category (name, type) pairs — the UNIQUE index', () => {
    const backup = clone(buildValidBackup());
    const second = backup.data.categories[1]!;
    second.name = backup.data.categories[0]!.name;
    second.type = backup.data.categories[0]!.type;
    expectValidationError(
      () => validateBackupObject(backup),
      /duplicate name\/type/,
    );
  });

  it('rejects duplicate budget periods and duplicate setting keys', () => {
    const duplicateBudget = clone(buildValidBackup());
    duplicateBudget.data.budgets.push({
      ...duplicateBudget.data.budgets[0]!,
      id: 31,
    });
    expectValidationError(
      () => validateBackupObject(duplicateBudget),
      /budgets/,
    );

    const duplicateSetting = clone(buildValidBackup());
    duplicateSetting.data.settings.push({
      ...duplicateSetting.data.settings[0]!,
    });
    expectValidationError(
      () => validateBackupObject(duplicateSetting),
      /duplicate keys/,
    );
  });

  it('allows the same category name across DIFFERENT types', () => {
    const backup = buildValidBackup();
    // 'Food & Dining' already exists as an EXPENSE category (id 1); the
    // unique index is (name, type), so an INCOME category may share it.
    backup.data.categories.push({
      id: 4,
      name: 'Food & Dining',
      icon: 'cash',
      type: 'income',
      isDefault: false,
      isActive: true,
      createdAt: 1_700_000_000_000,
    });
    expect(() => validateBackupObject(backup)).not.toThrow();
  });
});

describe('parseBackup', () => {
  it('parses and validates serialized JSON text', () => {
    const validated = parseBackup(JSON.stringify(buildValidBackup()));
    expect(validated.counts.expenses).toBe(2);
  });

  it('rejects invalid JSON with BackupParseError', () => {
    expect(() => parseBackup('{not json')).toThrow(BackupParseError);
    expect(() => parseBackup('')).toThrow(BackupParseError);
    expect(() => parseBackup('null')).toThrow(BackupValidationError);
  });

  it('rejects a JSON array or scalar at the top level', () => {
    expect(() => parseBackup('[]')).toThrow(BackupValidationError);
    expect(() => parseBackup('"kharcha-backup"')).toThrow(
      BackupValidationError,
    );
  });
});
