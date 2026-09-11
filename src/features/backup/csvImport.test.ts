/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';

import {escapeCsvField} from './csv';
import {prepareCsvExport} from './csvExport';
import {
  buildImportPlan,
  createCategoryMatcher,
  DEFAULT_IMPORT_OPTIONS,
  parseCsvDate,
  prepareCsvImport,
  recognizeCsvHeader,
  transactionFingerprint,
} from './csvImport';
import {createCsvImportFeature} from './csvImportService';
import {InvalidCsvError} from './errors';

/**
 * CSV import on the REAL SQLite engine: header recognition, row-level
 * validation, safe category matching, duplicate fingerprints, preview
 * counts and the ATOMIC import run (commit + rollback), spec §8–§21.
 */

const CANONICAL_HEADER =
  'Type,Date,Amount,Title,Category,Payment Method,Source,Note,Created At,Updated At,Recurring';

interface Row {
  // Widened (not just 'Expense' | 'Income') so validation tests can write
  // deliberately invalid type values.
  type: string;
  date: string;
  amount: string;
  title?: string;
  category?: string;
  payment?: string;
  source?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
  recurring?: string;
}

function csvFile(rows: Row[]): string {
  const lines = [CANONICAL_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.type,
        row.date,
        row.amount,
        row.title ?? '',
        row.category ?? '',
        row.payment ?? '',
        row.source ?? '',
        row.note ?? '',
        row.createdAt ?? '',
        row.updatedAt ?? '',
        row.recurring ?? '',
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Local noon keeps every expectation stable regardless of the test TZ. */
function localNoon(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).getTime();
}

const DAY_LABEL = '2026-09-08';
const DAY_MS = localNoon(2026, 8, 8);

/** Creates one stored expense, resolving/creating its category by name. */
async function seedExpense(
  service: DatabaseService,
  overrides: {
    amount?: number;
    title?: string;
    categoryName?: string;
    date?: number;
    paymentMethod?:
      'cash' | 'card' | 'bank_transfer' | 'mobile_wallet' | 'other';
    note?: string | null;
  } = {},
) {
  let categoryId: number;
  if (overrides.categoryName === undefined) {
    categoryId = (await service.categories.findByName(
      'Food & Dining',
      'expense',
    ))!.id;
  } else {
    const existing = await service.categories.findByName(
      overrides.categoryName,
      'expense',
    );
    categoryId =
      existing?.id ??
      (
        await service.categories.create({
          name: overrides.categoryName,
          icon: 'tag',
          type: 'expense',
        })
      ).id;
  }

  return service.expenses.create({
    amount: overrides.amount ?? 125_050,
    title: overrides.title ?? 'Lunch',
    categoryId,
    date: overrides.date ?? DAY_MS,
    paymentMethod: overrides.paymentMethod ?? 'cash',
    note: overrides.note ?? null,
  });
}

describe('parseCsvDate', () => {
  it('parses strict local dates to local noon', () => {
    expect(parseCsvDate('2026-09-08')).toBe(DAY_MS);
    expect(parseCsvDate('2024-02-29')).toBe(localNoon(2024, 1, 29)); // leap
  });

  it('rejects impossible and malformed dates', () => {
    expect(parseCsvDate('2026-99-44')).toBeNull();
    expect(parseCsvDate('2026-02-30')).toBeNull();
    expect(parseCsvDate('2025-02-29')).toBeNull(); // non-leap
    expect(parseCsvDate('2026-9-8')).toBeNull(); // not zero-padded
    expect(parseCsvDate('08/09/2026')).toBeNull();
    expect(parseCsvDate('')).toBeNull();
    expect(parseCsvDate('  ')).toBeNull();
  });

  it('has no timezone drift (same input, any UTC offset)', () => {
    // Local noon is 12h away from every UTC-midnight boundary edge.
    const ms = parseCsvDate('2026-01-01')!;
    expect(new Date(ms).getDate()).toBe(1);
    expect(new Date(ms).getMonth()).toBe(0);
  });
});

describe('recognizeCsvHeader', () => {
  it('recognizes the canonical 11-column header', () => {
    const recognized = recognizeCsvHeader([
      'Type',
      'Date',
      'Amount',
      'Title',
      'Category',
      'Payment Method',
      'Source',
      'Note',
      'Created At',
      'Updated At',
      'Recurring',
    ]);
    expect(recognized.kind).toBe('canonical');
    expect(recognized.index.Amount).toBe(2);
    expect(recognized.index.Recurring).toBe(10);
  });

  it('recognizes the legacy 10-column header without Recurring', () => {
    const recognized = recognizeCsvHeader([
      'Type',
      'Date',
      'Amount',
      'Title',
      'Category',
      'Payment Method',
      'Source',
      'Note',
      'Created At',
      'Updated At',
    ]);
    expect(recognized.kind).toBe('legacy');
  });

  it('matches case- and whitespace-insensitively', () => {
    const recognized = recognizeCsvHeader([
      ' type ',
      'date',
      'AMOUNT',
      'title',
      'category',
      'payment method',
      'source',
      'note',
      'created at',
      'updated at',
      'recurring',
    ]);
    expect(recognized.kind).toBe('canonical');
  });

  it('rejects unknown columns with their names', () => {
    expect(() =>
      recognizeCsvHeader([
        'Type',
        'Date',
        'Amount',
        'Title',
        'Category',
        'Payment Method',
        'Source',
        'Note',
        'Created At',
        'Updated At',
        'Recurring',
        'Currency',
      ]),
    ).toThrow(/Currency/);
  });

  it('rejects missing required columns', () => {
    expect(() => recognizeCsvHeader(['Type', 'Date', 'Amount'])).toThrow(
      InvalidCsvError,
    );
  });

  it('rejects a completely foreign file', () => {
    expect(() => recognizeCsvHeader(['name', 'email'])).toThrow(
      InvalidCsvError,
    );
  });
});

describe('prepareCsvImport — validation', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('validates a clean expense row completely', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '500.50',
          title: 'Groceries run',
          category: 'Food & Dining',
          payment: 'card',
          note: 'weekly',
        },
      ]),
    );

    expect(preview.totalRows).toBe(1);
    expect(preview.invalidRows).toBe(0);
    expect(preview.validRows).toBe(1);
    expect(preview.expenseCount).toBe(1);
    expect(preview.totalExpenseAmount).toBe(50050);
    const row = preview.rows[0];
    expect(row.kind).toBe('expense');
    if (row.kind === 'expense') {
      expect(row.amountMinor).toBe(50050);
      expect(row.dateMs).toBe(DAY_MS);
      expect(row.title).toBe('Groceries run');
      expect(row.paymentMethod).toBe('card');
      expect(row.note).toBe('weekly');
      expect(row.duplicate).toBe(false);
    }
  });

  it('validates a clean income row (source required, category ignored)', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Income',
          date: DAY_LABEL,
          amount: '85000.00',
          source: 'Monthly salary',
          note: 'September',
        },
      ]),
    );
    expect(preview.incomeCount).toBe(1);
    expect(preview.totalIncomeAmount).toBe(8_500_000);
    const row = preview.rows[0];
    if (row.kind === 'income') {
      expect(row.source).toBe('Monthly salary');
    }
  });

  it('reports row-level errors without crashing on other rows', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '500.50',
          title: 'Good row',
          category: 'Food & Dining',
          payment: 'cash',
        },
        {
          type: 'Savings',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Bad type',
          category: 'Food & Dining',
          payment: 'cash',
        },
        {
          type: 'Expense',
          date: '2026-99-44',
          amount: '10.00',
          title: 'Bad date',
          category: 'Food & Dining',
          payment: 'cash',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: 'abc',
          title: 'Bad amount',
          category: 'Food & Dining',
          payment: 'cash',
        },
      ]),
    );

    expect(preview.totalRows).toBe(4);
    expect(preview.validRows).toBe(1);
    expect(preview.invalidRows).toBe(3);
    expect(preview.errors.map(error => error.row)).toEqual([2, 3, 4]);
    expect(preview.errors[0].message).toContain('Unknown transaction type');
    expect(preview.errors[1].message).toBe('Invalid date "2026-99-44"');
    expect(preview.errors[2].message).toBe('Invalid amount "abc"');
  });

  it('rejects zero, negative, fractional-precision and huge-broken amounts', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '0',
          title: 'Zero',
          category: 'Food & Dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '-5.00',
          title: 'Negative',
          category: 'Food & Dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '5.005',
          title: 'Too many decimals',
          category: 'Food & Dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '12.',
          title: 'Trailing dot',
          category: 'Food & Dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1,000',
          title: 'Grouped',
          category: 'Food & Dining',
        },
      ]),
    );
    expect(preview.invalidRows).toBe(5);
    expect(preview.validRows).toBe(0);
  });

  it('keeps large amounts exact', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '99999999.99',
          title: 'Big',
          category: 'Food & Dining',
          payment: 'cash',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '500',
          title: 'Whole',
          category: 'Food & Dining',
          payment: 'cash',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '0.01',
          title: 'Paisa',
          category: 'Food & Dining',
          payment: 'cash',
        },
      ]),
    );
    expect(preview.invalidRows).toBe(0);
    expect(preview.totalExpenseAmount).toBe(9_999_999_999 + 50_000 + 1);
  });

  it('requires titles for expenses and sources for income', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: '',
          category: 'Food & Dining',
        },
        {type: 'Income', date: DAY_LABEL, amount: '10.00', source: ''},
      ]),
    );
    expect(preview.errors).toHaveLength(2);
    expect(preview.errors[0].message).toBe('Missing title');
    expect(preview.errors[1].message).toBe('Missing income source');
  });

  it('requires a category for expenses (data model has none-free expenses)', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'No cat',
          category: '',
        },
      ]),
    );
    expect(preview.invalidRows).toBe(1);
    expect(preview.errors[0].message).toBe('Missing category');
  });

  it('rejects an expense category that only exists as an income category', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Wrong side',
          category: 'Salary',
        },
      ]),
    );
    expect(preview.invalidRows).toBe(1);
    expect(preview.errors[0].message).toContain('income category');
  });

  it('defaults an absent payment method to cash and rejects invalid ones', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Default',
          category: 'Food & Dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Invalid',
          category: 'Food & Dining',
          payment: 'crypto',
        },
      ]),
    );
    expect(preview.validRows).toBe(1);
    expect(
      preview.rows[0].kind === 'expense' && preview.rows[0].paymentMethod,
    ).toBe('cash');
    expect(preview.errors[0].message).toContain(
      'Invalid payment method "crypto"',
    );
  });

  it('enforces title/source/note length limits', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'x'.repeat(201),
          category: 'Food & Dining',
        },
        {
          type: 'Income',
          date: DAY_LABEL,
          amount: '10.00',
          source: 's'.repeat(121),
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Long note',
          category: 'Food & Dining',
          note: 'n'.repeat(2001),
        },
      ]),
    );
    expect(preview.invalidRows).toBe(3);
    expect(preview.errors[0].message).toContain('Title is longer than 200');
    expect(preview.errors[1].message).toContain(
      'Income source is longer than 120',
    );
    expect(preview.errors[2].message).toContain('Note is longer than 2000');
  });

  it('reads the Recurring column as informational provenance only', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Marked',
          category: 'Food & Dining',
          recurring: 'Yes',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Unmarked',
          category: 'Food & Dining',
          recurring: '',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Nonsense',
          category: 'Food & Dining',
          recurring: 'banana',
        },
      ]),
    );
    expect(preview.invalidRows).toBe(0);
    const marked = preview.rows[0];
    expect(marked.recurring).toBe(true);
    expect(preview.rows[1].recurring).toBe(false);
    expect(preview.rows[2].recurring).toBe(false); // lenient: provenance only
  });

  it('throws for an empty file and for header-only files (zero rows OK)', async () => {
    await expect(prepareCsvImport(service, '')).rejects.toThrow(
      InvalidCsvError,
    );
    const headerOnly = await prepareCsvImport(
      service,
      `${CANONICAL_HEADER}\r\n`,
    );
    expect(headerOnly.totalRows).toBe(0);
    expect(headerOnly.validRows).toBe(0);
  });
});

describe('prepareCsvImport — category matching', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('matches exactly, then normalized (case/whitespace) — never by similarity', async () => {
    const food = await service.categories.findByName(
      'Food & Dining',
      'expense',
    );
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Exact',
          category: 'Food & Dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '11.00',
          title: 'Case',
          category: 'food & dining',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '12.00',
          title: 'Spaces',
          category: '  FOOD   &  Dining ',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '13.00',
          title: 'Similar but different',
          category: 'Food',
        },
      ]),
    );

    expect(preview.invalidRows).toBe(0);
    const rows = preview.rows;
    expect(rows[0].kind === 'expense' && rows[0].categoryId).toBe(food!.id);
    expect(rows[1].kind === 'expense' && rows[1].categoryId).toBe(food!.id);
    expect(rows[2].kind === 'expense' && rows[2].categoryId).toBe(food!.id);
    // "Food" is NOT matched to "Food & Dining" — no guessing.
    expect(preview.missingCategories).toEqual(['Food']);
    expect(rows[3].kind === 'expense' && rows[3].categoryId).toBeNull();
  });

  it('matches archived categories (historical rows stay resolvable)', async () => {
    const created = await service.categories.create({
      name: 'Old Hobby',
      icon: 'tag',
      type: 'expense',
    });
    await service.categories.update(created.id, {isActive: false});

    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'Legacy',
          category: 'Old Hobby',
        },
      ]),
    );
    expect(preview.missingCategories).toEqual([]);
    expect(
      preview.rows[0].kind === 'expense' && preview.rows[0].categoryId,
    ).toBe(created.id);
  });

  it('dedupes missing categories across rows (case-normalized)', async () => {
    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'A',
          category: 'Imported Utilities',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '11.00',
          title: 'B',
          category: 'imported utilities',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '12.00',
          title: 'C',
          category: 'Imported Utilities',
        },
      ]),
    );
    expect(preview.missingCategories).toEqual(['Imported Utilities']);
  });

  it('builds a matcher that only consults expense categories', async () => {
    const food = await service.categories.findByName(
      'Food & Dining',
      'expense',
    );
    const matcher = createCategoryMatcher(await service.categories.list());
    expect(matcher.match('Food & Dining')).toBe(food!.id);
    expect(matcher.match('  food &  DINING ')).toBe(food!.id);
    expect(matcher.match('Salary')).toBeNull(); // income category
    expect(matcher.matchesOtherType('Salary')).toBe(true);
    expect(matcher.matchesOtherType('Food & Dining')).toBe(false);
    expect(matcher.match('Unknown')).toBeNull();
    expect(matcher.matchesOtherType('Unknown')).toBe(false);
  });
});

describe('prepareCsvImport — duplicate fingerprints', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  const iso = (ms: number): string => new Date(ms).toISOString();

  it('flags an exact re-import as duplicate', async () => {
    const created = await seedExpense(service, {
      amount: 125_050,
      title: 'Lunch',
      date: DAY_MS,
      paymentMethod: 'cash',
      note: null,
    });

    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1250.50',
          title: 'Lunch',
          category: 'Food & Dining',
          payment: 'cash',
          createdAt: iso(created.createdAt),
          updatedAt: iso(created.updatedAt),
        },
      ]),
    );
    expect(preview.duplicateCount).toBe(1);
    expect(preview.duplicates[0].row).toBe(1);
    expect(preview.duplicates[0].label).toBe('Lunch');
  });

  it('does NOT flag when the note, amount or date changed', async () => {
    const created = await seedExpense(service, {note: 'with tea'});

    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          // Same everything, different note → a DIFFERENT record.
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1250.50',
          title: 'Lunch',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'with coffee',
          createdAt: iso(created.createdAt),
        },
        {
          // Different amount → not a duplicate.
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1251.00',
          title: 'Lunch',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'with tea',
          createdAt: iso(created.createdAt),
        },
        {
          // Different date → not a duplicate.
          type: 'Expense',
          date: '2026-09-09',
          amount: '1250.50',
          title: 'Lunch',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'with tea',
          createdAt: iso(created.createdAt),
        },
        {
          // Different createdAt → indistinguishable from a genuine new
          // same-day purchase — never skipped on a hunch.
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1250.50',
          title: 'Lunch',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'with tea',
          createdAt: iso(created.createdAt + 1),
        },
      ]),
    );
    expect(preview.duplicateCount).toBe(0);
  });

  it('keeps same-day identical purchases distinct via createdAt', async () => {
    const first = await seedExpense(service, {title: 'Coffee', amount: 50_00});
    const second = await seedExpense(service, {title: 'Coffee', amount: 50_00});
    // Force DISTINCT creation timestamps (rapid creates can share a ms).
    await service.driver.run(
      'UPDATE expenses SET created_at = ? WHERE id = ?',
      [first.createdAt + 5, second.id],
    );
    const secondCreated = first.createdAt + 5;

    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          // Matches the FIRST purchase exactly (incl. timestamp).
          type: 'Expense',
          date: DAY_LABEL,
          amount: '50.00',
          title: 'Coffee',
          category: 'Food & Dining',
          payment: 'cash',
          createdAt: iso(first.createdAt),
        },
        {
          // Same everything, but a timestamp the database has never seen —
          // it could be a genuine third purchase, so it is NOT a duplicate.
          type: 'Expense',
          date: DAY_LABEL,
          amount: '50.00',
          title: 'Coffee',
          category: 'Food & Dining',
          payment: 'cash',
          createdAt: iso(secondCreated + 60_000),
        },
      ]),
    );
    expect(preview.duplicateCount).toBe(1);
    expect(preview.duplicates[0].row).toBe(1);
  });

  it('matches duplicates by COUNT: two identical CSV rows, one stored copy', async () => {
    const stored = await seedExpense(service, {title: 'Coffee', amount: 50_00});
    const csvRow = {
      type: 'Expense',
      date: DAY_LABEL,
      amount: '50.00',
      title: 'Coffee',
      category: 'Food & Dining',
      payment: 'cash',
      createdAt: iso(stored.createdAt),
    };

    const preview = await prepareCsvImport(service, csvFile([csvRow, csvRow]));
    // One of the two matches the stored copy; the extra one imports.
    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[0].duplicate).toBe(true);
    expect(preview.rows[1].duplicate).toBe(false);
  });

  it('normalizes whitespace but stays case-sensitive in titles', async () => {
    const stored = await seedExpense(service, {
      title: 'Tea  extra',
      note: 'two  words',
    });

    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1250.50',
          title: 'Tea extra',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'two words',
          createdAt: iso(stored.createdAt),
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1250.50',
          title: 'tea extra',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'two words',
          createdAt: iso(stored.createdAt),
        },
      ]),
    );
    // Whitespace-collapsed row matches; case-different row does not.
    expect(preview.duplicateCount).toBe(1);
  });

  it('detects income duplicates on the source fingerprint', async () => {
    const created = await service.income.create({
      amount: 850_000,
      source: 'Freelance',
      date: DAY_MS,
      note: null,
    });

    const preview = await prepareCsvImport(
      service,
      csvFile([
        {
          type: 'Income',
          date: DAY_LABEL,
          amount: '8500.00',
          source: 'Freelance',
          createdAt: iso(created.createdAt),
        },
        {
          // Hand-made row without a timestamp: business fields match, but
          // the fingerprint cannot PROVE it is the same record — treated
          // as new (conservative direction: never skip a real record).
          type: 'Income',
          date: DAY_LABEL,
          amount: '8500.00',
          source: 'Freelance',
        },
      ]),
    );
    expect(preview.duplicateCount).toBe(1);
    expect(preview.duplicates[0].row).toBe(1);
  });

  it('round-trips a real Kharcha export as 100% duplicates', async () => {
    await seedExpense(service, {
      amount: 125_050,
      title: 'Tea, "green"',
      note: 'multiline\nnote',
    });
    await service.income.create({
      amount: 999_999,
      source: 'Cashback',
      date: DAY_MS,
    });

    const exported = await prepareCsvExport(service, {
      type: 'all',
      period: {kind: 'all'},
    });
    const preview = await prepareCsvImport(service, exported.csv);

    expect(preview.headerKind).toBe('canonical');
    expect(preview.totalRows).toBe(2);
    expect(preview.invalidRows).toBe(0);
    expect(preview.duplicateCount).toBe(2);
    expect(preview.missingCategories).toEqual([]);
  });

  it('exposes the documented fingerprint composition', () => {
    const base = {
      type: 'expense' as const,
      dateMs: DAY_MS,
      amountMinor: 125_050,
      titleOrSource: 'Lunch',
      categoryKey: '7',
      paymentMethod: 'cash',
      note: null as string | null,
      createdAtMs: null as number | null,
    };
    const fingerprint = transactionFingerprint(base);

    expect(transactionFingerprint({...base})).toBe(fingerprint);
    // Every stable field participates:
    expect(transactionFingerprint({...base, amountMinor: 125_051})).not.toBe(
      fingerprint,
    );
    expect(
      transactionFingerprint({
        ...base,
        dateMs: localNoon(2026, 8, 9),
      }),
    ).not.toBe(fingerprint);
    expect(transactionFingerprint({...base, note: 'x'})).not.toBe(fingerprint);
    expect(
      transactionFingerprint({...base, createdAtMs: 1_700_000_000_000}),
    ).not.toBe(fingerprint);
    expect(transactionFingerprint({...base, categoryKey: '8'})).not.toBe(
      fingerprint,
    );
    // Whitespace normalization of text fields:
    expect(transactionFingerprint({...base, titleOrSource: '  Lunch  '})).toBe(
      fingerprint,
    );
    // Local-day semantics (time of day irrelevant):
    expect(
      transactionFingerprint({
        ...base,
        dateMs: DAY_MS + 60_000,
      }),
    ).toBe(fingerprint);
  });
});

describe('buildImportPlan', () => {
  const preview = {
    headerKind: 'canonical' as const,
    totalRows: 6,
    validRows: 4,
    invalidRows: 2,
    expenseCount: 3,
    incomeCount: 1,
    totalExpenseAmount: 30,
    totalIncomeAmount: 40,
    duplicateCount: 2,
    duplicates: [],
    missingCategories: ['New Cat'],
    errors: [],
    rows: [
      {
        kind: 'expense' as const,
        row: 1,
        dateMs: DAY_MS,
        dateLabel: DAY_LABEL,
        amountMinor: 10,
        title: 'Dup expense',
        categoryName: 'Food & Dining',
        categoryId: 1,
        paymentMethod: 'cash' as const,
        note: null,
        recurring: false,
        createdAtMs: null,
        duplicate: true,
      },
      {
        kind: 'expense' as const,
        row: 2,
        dateMs: DAY_MS,
        dateLabel: DAY_LABEL,
        amountMinor: 10,
        title: 'New cat expense',
        categoryName: 'New Cat',
        categoryId: null,
        paymentMethod: 'cash' as const,
        note: null,
        recurring: false,
        createdAtMs: null,
        duplicate: false,
      },
      {
        kind: 'expense' as const,
        row: 3,
        dateMs: DAY_MS,
        dateLabel: DAY_LABEL,
        amountMinor: 10,
        title: 'Fresh expense',
        categoryName: 'Food & Dining',
        categoryId: 1,
        paymentMethod: 'cash' as const,
        note: null,
        recurring: false,
        createdAtMs: null,
        duplicate: false,
      },
      {
        kind: 'income' as const,
        row: 4,
        dateMs: DAY_MS,
        dateLabel: DAY_LABEL,
        amountMinor: 40,
        source: 'Side gig',
        note: null,
        recurring: false,
        createdAtMs: null,
        duplicate: false,
      },
    ],
  };

  it('defaults to skipping duplicates and creating missing categories', () => {
    const plan = buildImportPlan(preview, DEFAULT_IMPORT_OPTIONS);
    expect(plan.expenses).toHaveLength(2); // duplicate skipped
    expect(plan.income).toHaveLength(1);
    expect(plan.skippedDuplicates).toBe(1);
    expect(plan.skippedNoCategory).toBe(0);
    expect(plan.categoriesToCreate).toEqual(['New Cat']);
    expect(plan.invalidRows).toBe(2);
  });

  it('importAll mode keeps duplicate rows', () => {
    const plan = buildImportPlan(preview, {
      mode: 'importAll',
      createMissingCategories: true,
    });
    expect(plan.expenses).toHaveLength(3);
    expect(plan.skippedDuplicates).toBe(0);
  });

  it('skips unresolved-category rows when creation is declined', () => {
    const plan = buildImportPlan(preview, {
      mode: 'skipDuplicates',
      createMissingCategories: false,
    });
    expect(plan.expenses).toHaveLength(1); // only the fresh resolved one
    expect(plan.skippedNoCategory).toBe(1);
    expect(plan.categoriesToCreate).toEqual([]);
  });
});

describe('CsvImportFeature — atomic execution', () => {
  let service: DatabaseService;
  let feature: ReturnType<typeof createCsvImportFeature>;

  beforeEach(async () => {
    service = await createTestService();
    feature = createCsvImportFeature(service);
  });

  afterEach(async () => {
    await service.close();
  });

  it('imports mixed expense/income rows with exact money and local-noon dates', async () => {
    const preview = await feature.prepareImport(
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '500.50',
          title: 'Groceries',
          category: 'Food & Dining',
          payment: 'card',
          note: 'weekly',
        },
        {
          type: 'Income',
          date: DAY_LABEL,
          amount: '8500.00',
          source: 'Salary',
        },
      ]),
    );
    const result = await feature.executeImport(preview, DEFAULT_IMPORT_OPTIONS);

    expect(result.importedExpenses).toBe(1);
    expect(result.importedIncome).toBe(1);
    expect(result.createdCategories).toBe(0);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.invalidRows).toBe(0);
    expect(result.importedExpenseAmount).toBe(50050);
    expect(result.importedIncomeAmount).toBe(850_000);

    const stored = await service.expenses.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe(50050);
    expect(stored[0].date).toBe(DAY_MS); // local noon, no UTC drift
    expect(stored[0].title).toBe('Groceries');
    expect(stored[0].paymentMethod).toBe('card');
    expect(stored[0].note).toBe('weekly');
    // Imported rows are ORDINARY transactions — never rule-generated.
    expect(stored[0].recurringRuleId ?? null).toBeNull();

    const income = await service.income.list();
    expect(income).toHaveLength(1);
    expect(income[0].source).toBe('Salary');
    expect(income[0].amount).toBe(850_000);
    expect(income[0].recurringRuleId ?? null).toBeNull();
  });

  it('creates missing categories inside the import (once, expense-typed)', async () => {
    const preview = await feature.prepareImport(
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'A',
          category: 'Imported Utilities',
          payment: 'cash',
        },
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '11.00',
          title: 'B',
          category: 'imported utilities',
          payment: 'cash',
        },
      ]),
    );
    expect(preview.missingCategories).toEqual(['Imported Utilities']);

    const result = await feature.executeImport(preview, DEFAULT_IMPORT_OPTIONS);
    expect(result.createdCategories).toBe(1);
    expect(result.importedExpenses).toBe(2);

    const created = await service.categories.findByName(
      'Imported Utilities',
      'expense',
    );
    expect(created).not.toBeNull();
    // Second row normalized onto the SAME created category — no orphans.
    const rows = await service.expenses.list();
    expect(rows.map(row => row.categoryId)).toEqual([created!.id, created!.id]);
  });

  it('skips duplicates by default; re-importing an export adds nothing', async () => {
    const existing = await seedExpense(service, {
      amount: 125_050,
      title: 'Lunch',
      date: DAY_MS,
    });

    const file = csvFile([
      {
        type: 'Expense',
        date: DAY_LABEL,
        amount: '1250.50',
        title: 'Lunch',
        category: 'Food & Dining',
        payment: 'cash',
        createdAt: new Date(existing.createdAt).toISOString(),
      },
      {
        type: 'Expense',
        date: DAY_LABEL,
        amount: '99.00',
        title: 'Brand new',
        category: 'Food & Dining',
        payment: 'cash',
      },
    ]);

    const preview = await feature.prepareImport(file);
    const skipped = await feature.executeImport(
      preview,
      DEFAULT_IMPORT_OPTIONS,
    );
    expect(skipped.importedExpenses).toBe(1);
    expect(skipped.skippedDuplicates).toBe(1);
    expect(
      (await service.expenses.list()).map(row => row.title).sort(),
    ).toEqual(['Brand new', 'Lunch']);

    // §37 Flow 2: export the ledger and import the SAME CSV — every row
    // carries its full fingerprint, so the default skips everything and
    // NO duplicate transactions appear.
    const exported = await prepareCsvExport(service, {
      type: 'all',
      period: {kind: 'all'},
    });
    const roundTrip = await feature.prepareImport(exported.csv);
    expect(roundTrip.duplicateCount).toBe(2);
    const result = await feature.executeImport(
      roundTrip,
      DEFAULT_IMPORT_OPTIONS,
    );
    expect(result.importedExpenses).toBe(0);
    expect(result.skippedDuplicates).toBe(2);
    expect(await service.expenses.count()).toBe(2);
    expect(await service.income.count()).toBe(0);
  });

  it('imports duplicates when the user explicitly chooses importAll', async () => {
    const existing = await seedExpense(service, {});
    const preview = await feature.prepareImport(
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '1250.50',
          title: 'Lunch',
          category: 'Food & Dining',
          payment: 'cash',
          createdAt: new Date(existing.createdAt).toISOString(),
        },
      ]),
    );
    const result = await feature.executeImport(preview, {
      mode: 'importAll',
      createMissingCategories: true,
    });
    expect(result.importedExpenses).toBe(1);
    expect(result.skippedDuplicates).toBe(0);
    expect(await service.expenses.count()).toBe(2);
  });

  it('is ATOMIC: an engine failure mid-import leaves zero partial rows', async () => {
    // A controlled failure on the SECOND expense insert (spec §37 Flow 6).
    const originalRun = service.driver.run.bind(service.driver);
    let expenseInserts = 0;
    const runSpy = jest
      .spyOn(service.driver, 'run')
      .mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO expenses')) {
          expenseInserts += 1;
          if (expenseInserts === 2) {
            throw new Error('simulated engine failure');
          }
        }
        return originalRun(sql, params);
      });

    try {
      const preview = await feature.prepareImport(
        csvFile([
          {
            type: 'Expense',
            date: DAY_LABEL,
            amount: '10.00',
            title: 'First',
            category: 'Food & Dining',
            payment: 'cash',
          },
          {
            type: 'Expense',
            date: DAY_LABEL,
            amount: '11.00',
            title: 'Second',
            category: 'Boom Category',
            payment: 'cash',
          },
          {
            type: 'Expense',
            date: DAY_LABEL,
            amount: '12.00',
            title: 'Third',
            category: 'Food & Dining',
            payment: 'cash',
          },
        ]),
      );

      await expect(
        feature.executeImport(preview, DEFAULT_IMPORT_OPTIONS),
      ).rejects.toThrow(/import failed and nothing was changed/i);

      // NOTHING survived: no transactions, no created category, no orphans.
      expect(await service.expenses.count()).toBe(0);
      expect(await service.income.count()).toBe(0);
      expect(
        await service.categories.findByName('Boom Category', 'expense'),
      ).toBeNull();
      expect(await service.foreignKeyCheck()).toEqual([]);
    } finally {
      runSpy.mockRestore();
    }
  });

  it('writes nothing when there is nothing to import', async () => {
    const preview = await feature.prepareImport(
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: 'abc',
          title: 'Broken',
          category: 'Food & Dining',
        },
      ]),
    );
    const result = await feature.executeImport(preview, DEFAULT_IMPORT_OPTIONS);
    expect(result.importedExpenses).toBe(0);
    expect(result.invalidRows).toBe(1);
    expect(await service.expenses.count()).toBe(0);
  });

  it('imports a 1,000-row dataset correctly (batched, no per-row lookups)', async () => {
    const rows: Row[] = [];
    for (let index = 0; index < 1000; index += 1) {
      rows.push({
        type: index % 4 === 0 ? 'Income' : 'Expense',
        date: `2026-08-${String((index % 31) + 1).padStart(2, '0')}`,
        amount: `${(index % 500) + 1}.25`,
        title: `Bulk row ${index}`,
        category: index % 3 === 0 ? 'Food & Dining' : 'Bulk Imported',
        payment: 'cash',
        source: index % 4 === 0 ? 'Bulk source' : '',
      });
    }
    const preview = await feature.prepareImport(csvFile(rows));
    expect(preview.totalRows).toBe(1000);
    expect(preview.invalidRows).toBe(0);
    // 'Bulk Imported' is missing — ONE distinct category, not 500.
    expect(preview.missingCategories).toEqual(['Bulk Imported']);

    const result = await feature.executeImport(preview, DEFAULT_IMPORT_OPTIONS);
    expect(result.importedExpenses).toBe(750);
    expect(result.importedIncome).toBe(250);
    expect(result.createdCategories).toBe(1);

    expect(await service.expenses.count()).toBe(750);
    expect(await service.income.count()).toBe(250);
    const sum = await service.expenses.sumAmount({});
    const expectedExpenseSum = rows
      .filter(row => row.type === 'Expense')
      .reduce(
        (total, row) => total + (Number(row.amount.split('.')[0]) * 100 + 25),
        0,
      );
    expect(sum).toBe(expectedExpenseSum);
    expect(await service.foreignKeyCheck()).toEqual([]);
  });

  it('handles Unicode titles, commas, quotes and multiline notes end to end', async () => {
    const preview = await feature.prepareImport(
      csvFile([
        {
          type: 'Expense',
          date: DAY_LABEL,
          amount: '10.00',
          title: 'چائے, "green"',
          category: 'Food & Dining',
          payment: 'cash',
          note: 'line one\nline two',
        },
      ]),
    );
    expect(preview.invalidRows).toBe(0);
    await feature.executeImport(preview, DEFAULT_IMPORT_OPTIONS);

    const stored = (await service.expenses.list())[0];
    expect(stored.title).toBe('چائے, "green"');
    expect(stored.note).toBe('line one\nline two');
  });
});
