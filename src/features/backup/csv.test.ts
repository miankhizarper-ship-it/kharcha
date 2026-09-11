import {
  buildTransactionCsv,
  escapeCsvField,
  formatDateColumn,
  formatMinorAsDecimal,
} from './csv';
import type {ExpenseWithCategory, Income} from '@/database/models';

/**
 * CSV export — pure string building: RFC 4180 escaping, exact money
 * rendering (no floats, no rounding, no conversion) and ledger ordering.
 */

/** Local noon keeps every expectation stable regardless of the test TZ. */
function localNoon(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).getTime();
}

const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z — fixed timestamps

function makeExpense(
  overrides: Partial<ExpenseWithCategory>,
): ExpenseWithCategory {
  return {
    id: 1,
    amount: 125050,
    title: 'Lunch',
    categoryId: 7,
    date: localNoon(2026, 8, 8),
    paymentMethod: 'cash',
    note: null,
    createdAt: T0,
    updatedAt: T0,
    categoryName: 'Food & Dining',
    categoryIcon: 'restaurant',
    ...overrides,
  };
}

function makeIncome(overrides: Partial<Income>): Income {
  return {
    id: 1,
    amount: 5_000_000,
    source: 'Salary',
    date: localNoon(2026, 8, 1),
    note: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('formatMinorAsDecimal', () => {
  it('renders exact decimal strings from integer minor units', () => {
    expect(formatMinorAsDecimal(0)).toBe('0.00');
    expect(formatMinorAsDecimal(5)).toBe('0.05');
    expect(formatMinorAsDecimal(50)).toBe('0.50');
    expect(formatMinorAsDecimal(100)).toBe('1.00');
    expect(formatMinorAsDecimal(125050)).toBe('1250.50');
    expect(formatMinorAsDecimal(1)).toBe('0.01');
  });

  it('preserves large amounts without float drift or rounding', () => {
    // 99999999.99 — the largest amount the input sanitizer accepts.
    expect(formatMinorAsDecimal(9_999_999_999)).toBe('99999999.99');
    // Values that a parseFloat-based approach would mangle:
    expect(formatMinorAsDecimal(8_200)).toBe('82.00');
    expect(formatMinorAsDecimal(1_005)).toBe('10.05');
    expect(formatMinorAsDecimal(100_000_001)).toBe('1000000.01');
  });

  it('keeps negative values exact (defensive; CHECK forbids them in DB)', () => {
    expect(formatMinorAsDecimal(-150)).toBe('-1.50');
  });

  it('rejects non-integer input instead of silently formatting it', () => {
    expect(() => formatMinorAsDecimal(1.5)).toThrow();
    expect(() => formatMinorAsDecimal(Number.NaN)).toThrow();
    expect(() => formatMinorAsDecimal('100' as never)).toThrow();
  });
});

describe('formatDateColumn', () => {
  it('renders the LOCAL calendar day of an epoch-millis value', () => {
    expect(formatDateColumn(localNoon(2026, 8, 8))).toBe('2026-09-08');
    expect(formatDateColumn(localNoon(2026, 0, 1))).toBe('2026-01-01');
    expect(formatDateColumn(localNoon(2025, 11, 31))).toBe('2025-12-31');
  });

  it('pads single-digit months and days', () => {
    expect(formatDateColumn(localNoon(2026, 2, 5))).toBe('2026-03-05');
  });
});

describe('escapeCsvField', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvField('Lunch')).toBe('Lunch');
    expect(escapeCsvField('Food & Dining')).toBe('Food & Dining');
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes values containing commas, quotes, newlines and CRs', () => {
    expect(escapeCsvField('Tea, coffee')).toBe('"Tea, coffee"');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it('keeps Unicode text intact', () => {
    expect(escapeCsvField('چائے')).toBe('چائے');
    expect(escapeCsvField('房租（一月）')).toBe('房租（一月）');
    expect(escapeCsvField('café ☕')).toBe('café ☕');
  });
});

describe('buildTransactionCsv', () => {
  it('writes the documented header row', () => {
    const csv = buildTransactionCsv({expenses: [], income: []});
    expect(csv).toBe(
      'Type,Date,Amount,Title,Category,Payment Method,Source,Note,Created At,Updated At,Recurring\r\n',
    );
  });

  it('exports an expense row with its CATEGORY NAME and decimal amount', () => {
    const csv = buildTransactionCsv({
      expenses: [makeExpense({amount: 125050, categoryName: 'Food & Dining'})],
      income: [],
    });
    expect(csv).toBe(
      'Type,Date,Amount,Title,Category,Payment Method,Source,Note,Created At,Updated At,Recurring\r\n' +
        'Expense,2026-09-08,1250.50,Lunch,Food & Dining,cash,,,' +
        '2023-11-14T22:13:20.000Z,2023-11-14T22:13:20.000Z,No\r\n',
    );
  });

  it('exports an income row with Source and empty expense-only columns', () => {
    const csv = buildTransactionCsv({
      expenses: [],
      income: [
        makeIncome({
          amount: 5_000_000,
          source: 'Monthly salary',
          note: 'September pay',
        }),
      ],
    });
    expect(csv).toBe(
      'Type,Date,Amount,Title,Category,Payment Method,Source,Note,Created At,Updated At,Recurring\r\n' +
        'Income,2026-09-01,50000.00,,,,Monthly salary,September pay,' +
        '2023-11-14T22:13:20.000Z,2023-11-14T22:13:20.000Z,No\r\n',
    );
  });

  it('marks recurring-generated rows Yes and manual rows No', () => {
    const csv = buildTransactionCsv({
      expenses: [
        makeExpense({title: 'Generated', recurringRuleId: 42}),
        makeExpense({title: 'Manual', recurringRuleId: null}),
      ],
      income: [makeIncome({source: 'Rule income', recurringRuleId: 7})],
    });
    const generated = csv
      .split('\r\n')
      .find(line => line.includes(',Generated,'));
    const manual = csv.split('\r\n').find(line => line.includes(',Manual,'));
    const ruleIncome = csv
      .split('\r\n')
      .find(line => line.includes(',Rule income,'));
    expect(generated!.endsWith(',Yes')).toBe(true);
    expect(manual!.endsWith(',No')).toBe(true);
    expect(ruleIncome!.endsWith(',Yes')).toBe(true);
  });

  it('merges expenses and income into one date-ascending ledger', () => {
    const csv = buildTransactionCsv({
      expenses: [makeExpense({date: localNoon(2026, 8, 8)})],
      income: [makeIncome({date: localNoon(2026, 8, 1)})],
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toMatch(/^Income,/);
    expect(lines[2]).toMatch(/^Expense,/);
  });

  it('escapes commas, quotes and newlines in real fields', () => {
    const csv = buildTransactionCsv({
      expenses: [
        makeExpense({
          title: 'Tea, "green"',
          categoryName: 'Shops, Markets',
          note: 'two\nlines',
        }),
      ],
      income: [],
    });
    expect(csv).toContain('"Tea, ""green"""');
    expect(csv).toContain('"Shops, Markets"');
    expect(csv).toContain('"two\nlines"');
    // The escaped fields must not add CSV rows:
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });

  it('exports empty note and empty values as nothing', () => {
    const csv = buildTransactionCsv({
      expenses: [makeExpense({note: null})],
      income: [],
    });
    expect(csv).toContain(',,2023-11-14');
  });

  it('keeps Unicode category names and notes intact', () => {
    const csv = buildTransactionCsv({
      expenses: [makeExpense({title: 'چائے', categoryName: 'épicerie'})],
      income: [],
    });
    expect(csv).toContain('چائے');
    expect(csv).toContain('épicerie');
  });

  it('preserves amounts exactly — no rounding, no currency formatting', () => {
    const csv = buildTransactionCsv({
      expenses: [makeExpense({amount: 9_999_999_999})],
      income: [makeIncome({amount: 1})],
    });
    expect(csv).toContain(',99999999.99,');
    expect(csv).toContain(',0.01,');
    // Never formatted currency strings:
    expect(csv).not.toContain('Rs');
    expect(csv).not.toContain('99,999,999');
  });
});
