import {buildReportHtml, buildReportPdfFilename, escapeHtml} from './reportPdf';
import type {
  CategoryBudgetProgress,
  OverallBudgetProgress,
} from '@/features/budgets/types';
import type {ReportSelection, ReportSnapshot} from './types';
import {formatCurrency} from '@/utils/format';

/** Local-time epochs (tests run in a fixed local timezone). */
const SEP_1_2026 = new Date(2026, 8, 1, 0, 0, 0).getTime();
const SEP_7_2026 = new Date(2026, 8, 7, 0, 0, 0).getTime();
const SEP_30_2026 = new Date(2026, 8, 30, 0, 0, 0).getTime();

function makeSnapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    period: {fromDate: SEP_1_2026, toDate: SEP_30_2026, dayCount: 30},
    income: 0,
    expenses: 0,
    balance: 0,
    averageDailySpend: 0,
    dailySpending: [],
    categoryBreakdown: [],
    incomeVsExpense: {income: 0, expenses: 0, balance: 0},
    topCategory: null,
    highestSpendingDay: null,
    previousPeriodComparison: null,
    budgetPerformance: null,
    expenseCount: 0,
    incomeCount: 0,
    averageTransaction: 0,
    largestTransaction: null,
    mostFrequentCategory: null,
    incomeSources: [],
    ...overrides,
  };
}

describe('buildReportPdfFilename', () => {
  it('uses the year and month for month selections', () => {
    const selection: ReportSelection = {kind: 'month', year: 2026, month: 9};
    expect(
      buildReportPdfFilename(selection, {
        fromDate: SEP_1_2026,
        toDate: SEP_30_2026,
      }),
    ).toBe('Kharcha-Report-2026-09.pdf');
  });

  it('uses the inclusive date range for custom selections', () => {
    const selection: ReportSelection = {
      kind: 'custom',
      fromDate: SEP_1_2026,
      toDate: SEP_7_2026,
    };
    expect(
      buildReportPdfFilename(selection, {
        fromDate: SEP_1_2026,
        toDate: SEP_7_2026,
      }),
    ).toBe('Kharcha-Report-2026-09-01_to_2026-09-07.pdf');
  });

  it('uses the date range for week selections too', () => {
    const selection: ReportSelection = {kind: 'thisWeek'};
    expect(
      buildReportPdfFilename(selection, {
        fromDate: SEP_1_2026,
        toDate: SEP_7_2026,
      }),
    ).toBe('Kharcha-Report-2026-09-01_to_2026-09-07.pdf');
  });
});

describe('escapeHtml', () => {
  it('escapes markup-significant characters in user-entered text', () => {
    expect(escapeHtml(`<b>Tom & "Jerry's" Cafe</b>`)).toBe(
      '&lt;b&gt;Tom &amp; &quot;Jerry&#39;s&quot; Cafe&lt;/b&gt;',
    );
  });
});

describe('buildReportHtml', () => {
  it('renders a self-contained document with the period label and brand', () => {
    const html = buildReportHtml({
      snapshot: makeSnapshot(),
      currency: 'PKR',
      periodLabel: 'September 2026',
      generatedAt: SEP_1_2026,
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Kharcha');
    expect(html).toContain('September 2026');
    expect(html).toContain('Summary');
  });

  it('escapes user-entered category and source names', () => {
    const html = buildReportHtml({
      snapshot: makeSnapshot({
        expenses: 150000,
        categoryBreakdown: [
          {
            categoryId: 3,
            name: `<script>Tom & "Jerry's"</script>`,
            icon: 'fast-food',
            total: 150000,
            percent: 100,
            transactionCount: 2,
          },
        ],
        topCategory: {
          categoryId: 3,
          name: `<script>Tom & "Jerry's"</script>`,
          icon: 'fast-food',
          total: 150000,
          percent: 100,
        },
        incomeSources: [
          {
            source: `Salary & "Bonus"`,
            icon: 'cash',
            total: 200000,
            percent: 100,
            transactionCount: 1,
          },
        ],
        income: 200000,
      }),
      currency: 'PKR',
      periodLabel: 'September 2026',
      generatedAt: SEP_1_2026,
    });

    expect(html).toContain(
      '&lt;script&gt;Tom &amp; &quot;Jerry&#39;s&quot;&lt;/script&gt;',
    );
    expect(html).toContain('Salary &amp; &quot;Bonus&quot;');
    // The raw unescaped form must never appear.
    expect(html).not.toContain('<script>');
    // Formatted money reaches the document (minor units → 1,500.00 PKR).
    // Compare against the shared formatter itself — Intl may join the code
    // and amount with a non-breaking space.
    expect(html).toContain(formatCurrency(150000, 'PKR'));
  });

  it('includes budget and month-over-month sections only for month reports', () => {
    const overall: OverallBudgetProgress = {
      id: 1,
      amount: 5000000,
      spent: 150000,
      remaining: 4850000,
      percent: 3,
      state: 'ok',
    };
    const categoryBudget: CategoryBudgetProgress = {
      id: 2,
      categoryId: 3,
      categoryName: 'Food & Dining',
      categoryIcon: 'fast-food',
      amount: 100000,
      spent: 100000,
      remaining: 0,
      percent: 100,
      state: 'exceeded',
    };
    const monthSnapshot = makeSnapshot({
      expenses: 150000,
      previousPeriodComparison: {
        currentTotal: 150000,
        previousTotal: 200000,
        difference: -50000,
        percentChange: -25,
        direction: 'down',
      },
      budgetPerformance: {
        overall,
        topCategories: [categoryBudget],
        categoryBudgets: [categoryBudget],
      },
    });

    const monthHtml = buildReportHtml({
      snapshot: monthSnapshot,
      currency: 'PKR',
      periodLabel: 'September 2026',
      previousLabel: 'August 2026',
      generatedAt: SEP_1_2026,
    });
    expect(monthHtml).toContain('Budget Performance');
    expect(monthHtml).toContain('Overall budget');
    expect(monthHtml).toContain('Exceeded');
    expect(monthHtml).toContain('Month-over-Month');
    expect(monthHtml).toContain('Compared against August 2026');

    const weekHtml = buildReportHtml({
      snapshot: makeSnapshot({expenses: 150000}),
      currency: 'PKR',
      periodLabel: 'This Week',
      generatedAt: SEP_1_2026,
    });
    expect(weekHtml).not.toContain('Budget Performance');
    expect(weekHtml).not.toContain('Month-over-Month');
  });

  it('reuses the app insight strings so the PDF matches the screen', () => {
    const html = buildReportHtml({
      snapshot: makeSnapshot({
        expenses: 150000,
        categoryBreakdown: [
          {
            categoryId: 3,
            name: 'Food & Dining',
            icon: 'fast-food',
            total: 150000,
            percent: 100,
          },
        ],
        topCategory: {
          categoryId: 3,
          name: 'Food & Dining',
          icon: 'fast-food',
          total: 150000,
          percent: 100,
        },
      }),
      currency: 'PKR',
      periodLabel: 'September 2026',
      generatedAt: SEP_1_2026,
    });

    expect(html).toContain('Insights');
    expect(html).toContain('Top Category');
  });

  it('never emits NaN, Infinity or undefined for empty periods', () => {
    const html = buildReportHtml({
      snapshot: makeSnapshot(),
      currency: 'PKR',
      periodLabel: 'September 2026',
      generatedAt: SEP_1_2026,
    });

    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).not.toContain('>undefined<');
    // Empty period: no fabricated data sections beyond the summary.
    expect(html).not.toContain('Daily Spending');
    expect(html).not.toContain('By Category');
  });
});
