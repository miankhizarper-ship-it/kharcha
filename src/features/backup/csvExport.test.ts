/**
 * @jest-environment node
 */
import {createTestService} from '@/database/testing/helpers';
import type {DatabaseService} from '@/database/service';
import {processDueRecurringTransactions} from '@/features/recurring/processing';

import {
  buildCsvFilename,
  prepareCsvExport,
  resolveExportPeriod,
} from './csvExport';

/**
 * Smart CSV export on the REAL SQLite engine: SQL-level filtering (type,
 * date window, category), exact preview totals, recurring provenance and
 * the predictable filename scheme (spec §2–§7).
 */

/** Local noon keeps every expectation stable regardless of the test TZ. */
function localNoon(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).getTime();
}

const NOW = localNoon(2026, 8, 15); // 2026-09-15 (a Tuesday)

const HEADER =
  'Type,Date,Amount,Title,Category,Payment Method,Source,Note,Created At,Updated At,Recurring';

async function seed(service: DatabaseService): Promise<void> {
  // Reuse the migration-seeded defaults — creating them again would hit
  // the (name, type) UNIQUE index.
  const food = await service.categories.findByName('Food & Dining', 'expense');
  const transport = await service.categories.findByName('Transport', 'expense');
  // August rows (last month relative to September 2026).
  await service.expenses.create({
    amount: 500_00,
    title: 'August groceries',
    categoryId: food!.id,
    date: localNoon(2026, 7, 10),
    paymentMethod: 'cash',
    note: 'monthly stock-up',
  });
  await service.expenses.create({
    amount: 120_00,
    title: 'August fuel',
    categoryId: transport!.id,
    date: localNoon(2026, 7, 20),
    paymentMethod: 'card',
  });
  // September rows (this month).
  await service.expenses.create({
    amount: 250_50,
    title: 'September lunch',
    categoryId: food!.id,
    date: localNoon(2026, 8, 3),
    paymentMethod: 'card',
  });
  await service.income.create({
    amount: 8_500_00,
    source: 'Salary',
    date: localNoon(2026, 8, 1),
  });
}

describe('buildCsvFilename', () => {
  it('date-stamps an all-time export', () => {
    expect(buildCsvFilename(localNoon(2026, 8, 11))).toBe(
      'kharcha-transactions-2026-09-11.csv',
    );
  });

  it('range-stamps a filtered export', () => {
    const filename = buildCsvFilename(NOW, {
      kind: 'custom',
      fromDate: localNoon(2026, 8, 1),
      toDate: localNoon(2026, 8, 11),
    });
    expect(filename).toBe('kharcha-transactions-2026-09-01-to-2026-09-11.csv');
  });

  it('range-stamps week/month/lastMonth windows by their RESOLVED bounds', () => {
    const filename = buildCsvFilename(NOW, {kind: 'thisWeek'});
    // 2026-09-15 is a Tuesday → ISO week runs Mon 14th … Sun 20th.
    expect(filename).toBe('kharcha-transactions-2026-09-14-to-2026-09-20.csv');
  });
});

describe('resolveExportPeriod', () => {
  it('keeps thisMonth on true calendar bounds', () => {
    const bounds = resolveExportPeriod({kind: 'thisMonth'}, NOW);
    expect(bounds.fromDate).toBe(localNoon(2026, 8, 1) - 12 * 3600_000);
    expect(bounds.toDate).toBe(localNoon(2026, 8, 30) + 12 * 3600_000 - 1);
  });

  it('moves lastMonth to the previous calendar month across years', () => {
    const january = localNoon(2026, 0, 15);
    const bounds = resolveExportPeriod({kind: 'lastMonth'}, january);
    expect(bounds.fromDate).toBe(localNoon(2025, 11, 1) - 12 * 3600_000);
    expect(bounds.toDate).toBe(localNoon(2025, 11, 31) + 12 * 3600_000 - 1);
  });

  it('normalizes a reversed custom range to full local days', () => {
    const bounds = resolveExportPeriod(
      {
        kind: 'custom',
        fromDate: localNoon(2026, 8, 11),
        toDate: localNoon(2026, 8, 5),
      },
      NOW,
    );
    expect(bounds.fromDate).toBe(localNoon(2026, 8, 5) - 12 * 3600_000);
    expect(bounds.toDate).toBe(localNoon(2026, 8, 11) + 12 * 3600_000 - 1);
  });
});

describe('prepareCsvExport', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
    await seed(service);
  });

  afterEach(async () => {
    await service.close();
  });

  it('exports everything by default with correct totals', async () => {
    const prepared = await prepareCsvExport(
      service,
      {type: 'all', period: {kind: 'all'}},
      NOW,
    );

    expect(prepared.summary.expenseCount).toBe(3);
    expect(prepared.summary.incomeCount).toBe(1);
    expect(prepared.summary.totalExpenses).toBe(870_50);
    expect(prepared.summary.totalIncome).toBe(8_500_00);
    expect(prepared.summary.fromDate).toBeNull();

    const lines = prepared.csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(5);
  });

  it('exports expenses only (SQL-filtered, income excluded)', async () => {
    const prepared = await prepareCsvExport(
      service,
      {type: 'expenses', period: {kind: 'all'}},
      NOW,
    );
    expect(prepared.summary.incomeCount).toBe(0);
    expect(prepared.summary.expenseCount).toBe(3);
    const rows = prepared.csv.trimEnd().split('\r\n').slice(1);
    expect(rows.every(row => row.startsWith('Expense,'))).toBe(true);
  });

  it('exports income only (expense-only columns empty)', async () => {
    const prepared = await prepareCsvExport(
      service,
      {type: 'income', period: {kind: 'all'}},
      NOW,
    );
    expect(prepared.summary.expenseCount).toBe(0);
    const rows = prepared.csv.trimEnd().split('\r\n').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(',Salary,');
  });

  it('filters by date window (this month / last month)', async () => {
    const thisMonth = await prepareCsvExport(
      service,
      {type: 'all', period: {kind: 'thisMonth'}},
      NOW,
    );
    expect(thisMonth.summary.expenseCount).toBe(1);
    expect(thisMonth.summary.incomeCount).toBe(1);
    expect(thisMonth.summary.totalExpenses).toBe(250_50);

    const lastMonth = await prepareCsvExport(
      service,
      {type: 'expenses', period: {kind: 'lastMonth'}},
      NOW,
    );
    expect(lastMonth.summary.expenseCount).toBe(2);
    expect(lastMonth.summary.totalExpenses).toBe(620_00);
  });

  it('filters by custom range inclusive of both endpoints', async () => {
    const prepared = await prepareCsvExport(
      service,
      {
        type: 'all',
        period: {
          kind: 'custom',
          fromDate: localNoon(2026, 7, 20),
          toDate: localNoon(2026, 8, 3),
        },
      },
      NOW,
    );
    // Expenses: Aug 20 fuel + Sep 3 lunch. Income: Sep 1 salary.
    expect(prepared.summary.expenseCount).toBe(2);
    expect(prepared.summary.totalExpenses).toBe(370_50);
    expect(prepared.summary.incomeCount).toBe(1);
  });

  it('filters by category (expense-scoped, income excluded)', async () => {
    const food = await service.categories.findByName(
      'Food & Dining',
      'expense',
    );
    const prepared = await prepareCsvExport(
      service,
      {
        type: 'all',
        period: {kind: 'all'},
        categoryId: food!.id,
      },
      NOW,
    );
    expect(prepared.summary.expenseCount).toBe(2);
    expect(prepared.summary.incomeCount).toBe(0);
    expect(prepared.summary.totalExpenses).toBe(750_50);
    const rows = prepared.csv.trimEnd().split('\r\n').slice(1);
    expect(rows.every(row => row.includes('Food & Dining'))).toBe(true);
  });

  it('writes the Recurring provenance column for generated rows', async () => {
    await service.recurring.create({
      type: 'expense',
      amount: 100_00,
      title: 'Gym',
      categoryId: (await service.categories.findByName('Health', 'expense'))!
        .id,
      frequency: 'monthly',
      startDate: localNoon(2026, 7, 1),
      paymentMethod: 'cash',
    });
    await processDueRecurringTransactions(
      service,
      localNoon(2026, 8, 15) + 12 * 3600_000 - 1,
    );

    const prepared = await prepareCsvExport(
      service,
      {type: 'all', period: {kind: 'all'}},
      NOW,
    );
    const lines = prepared.csv.trimEnd().split('\r\n');
    const recurringRow = lines.find(line => line.includes(',Gym,'));
    expect(recurringRow).toBeDefined();
    expect(recurringRow!.endsWith(',Yes')).toBe(true);
    const ordinaryRow = lines.find(line => line.includes(',September lunch,'));
    expect(ordinaryRow!.endsWith(',No')).toBe(true);
  });

  it('returns a header-only file when nothing matches the filters', async () => {
    const prepared = await prepareCsvExport(
      service,
      {
        type: 'expenses',
        period: {
          kind: 'custom',
          fromDate: localNoon(2030, 0, 1),
          toDate: localNoon(2030, 0, 31),
        },
      },
      NOW,
    );
    expect(prepared.summary.expenseCount).toBe(0);
    expect(prepared.csv).toBe(`${HEADER}\r\n`);
  });

  it('keeps exact decimal amounts with no rounding or grouping', async () => {
    await service.expenses.create({
      amount: 9_999_999_999,
      title: 'Big ticket',
      categoryId: (
        await service.categories.create({
          name: 'Rare Luxury',
          icon: 'diamond',
          type: 'expense',
        })
      ).id,
      date: localNoon(2026, 8, 2),
      paymentMethod: 'other',
    });
    const prepared = await prepareCsvExport(
      service,
      {type: 'expenses', period: {kind: 'thisMonth'}},
      NOW,
    );
    expect(prepared.csv).toContain(',99999999.99,');
    expect(prepared.csv).not.toContain('99,999,999');
  });
});
