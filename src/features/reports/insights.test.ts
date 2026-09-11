import {buildReportInsights} from './insights';
import type {ReportSnapshot} from './types';

/**
 * The insights builder is a pure function over a snapshot with INJECTED
 * formatters, so tests use deterministic strings: money renders as the raw
 * minor units, percents as the raw number, dates as `d<ms>`.
 */
const FORMAT = {
  formatCurrency: (minor: number) => `Rs${minor}`,
  formatPercent: (percent: number) => `${percent}`,
  formatShortDate: (ms: number) => `d${ms}`,
};

/** A complete, valid zero snapshot to mutate per test (type-enforced). */
function makeSnapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    period: {fromDate: 1, toDate: 2, dayCount: 30},
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

describe('buildReportInsights', () => {
  it('renders no rows for a fully empty period (no fabricated facts)', () => {
    const rows = buildReportInsights(makeSnapshot(), FORMAT);
    expect(rows).toEqual([]);
  });

  it('describes the top category with amount and share', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        expenses: 2_000_000,
        expenseCount: 4,
        averageTransaction: 500_000,
        topCategory: {
          categoryId: 1,
          name: 'Food & Dining',
          icon: 'restaurant',
          total: 850_000,
          percent: 42.5,
        },
      }),
      FORMAT,
    );

    const top = rows.find(row => row.kind === 'topCategory');
    expect(top).toMatchObject({
      key: 'top-category',
      title: 'Top Category',
      detail: 'Food & Dining — Rs850000 · 42.5% of expenses',
      icon: 'restaurant',
    });
  });

  it('describes the highest spending day', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        expenses: 500_000,
        expenseCount: 2,
        averageTransaction: 250_000,
        highestSpendingDay: {date: 12345, total: 300_000},
      }),
      FORMAT,
    );

    expect(rows.find(row => row.kind === 'highestSpendingDay')).toMatchObject({
      detail: 'd12345 — Rs300000',
    });
  });

  it('reports average daily spend and average transaction frequency', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        expenses: 1_845_000,
        expenseCount: 12,
        averageDailySpend: 61_500,
        averageTransaction: 153_750,
      }),
      FORMAT,
    );

    expect(rows.find(row => row.kind === 'averageDailySpend')).toMatchObject({
      detail: 'Rs61500',
    });
    expect(rows.find(row => row.kind === 'averageTransaction')).toMatchObject({
      detail: 'Rs153750 across 12 expenses',
    });
  });

  it('singularizes the frequency line for a single expense', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        expenses: 900,
        expenseCount: 1,
        averageDailySpend: 30,
        averageTransaction: 900,
      }),
      FORMAT,
    );
    expect(rows.find(row => row.kind === 'averageTransaction')).toMatchObject({
      detail: 'Rs900 across 1 expense',
    });
  });

  it('describes the most frequent category', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        expenses: 300_000,
        expenseCount: 9,
        averageTransaction: 33_333,
        mostFrequentCategory: {
          categoryId: 3,
          name: 'Transport',
          icon: 'bus',
          transactionCount: 9,
          total: 300_000,
        },
      }),
      FORMAT,
    );
    expect(rows.find(row => row.kind === 'mostFrequentCategory')).toMatchObject(
      {
        detail: 'Transport · 9 transactions — Rs300000',
        icon: 'bus',
      },
    );
  });

  it('makes the largest transaction tappable via a navigation ref (no ids in text)', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        expenses: 900_000,
        expenseCount: 3,
        averageTransaction: 300_000,
        largestTransaction: {
          key: 'expense-42',
          type: 'expense',
          id: 42,
          title: 'New phone',
          amount: 800_000,
          date: 777,
          categoryName: 'Shopping',
        },
      }),
      FORMAT,
    );

    const largest = rows.find(row => row.kind === 'largestTransaction');
    expect(largest).toMatchObject({
      detail: 'New phone — Rs800000 · Shopping · d777',
      transaction: {type: 'expense', id: 42},
    });
    expect(largest?.detail).not.toContain('42');
  });

  it('labels income-side largest transactions without a fake category', () => {
    const rows = buildReportInsights(
      makeSnapshot({
        largestTransaction: {
          key: 'income-7',
          type: 'income',
          id: 7,
          title: 'Salary',
          amount: 500_000,
          date: 888,
          categoryName: null,
        },
      }),
      FORMAT,
    );
    expect(rows.find(row => row.kind === 'largestTransaction')).toMatchObject({
      detail: 'Salary — Rs500000 · Income · d888',
    });
  });

  describe('budget rows', () => {
    it('flags exceeded budgets before approaching ones and caps the rows', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          budgetPerformance: {
            overall: null,
            topCategories: [],
            categoryBudgets: [
              {
                id: 1,
                categoryId: 1,
                categoryName: 'A',
                categoryIcon: 'tag',
                amount: 100,
                spent: 90,
                remaining: 10,
                percent: 90,
                state: 'warning',
              },
              {
                id: 2,
                categoryId: 2,
                categoryName: 'B',
                categoryIcon: 'tag',
                amount: 100,
                spent: 120,
                remaining: -20,
                percent: 120,
                state: 'exceeded',
              },
              {
                id: 3,
                categoryId: 3,
                categoryName: 'C',
                categoryIcon: 'tag',
                amount: 100,
                spent: 85,
                remaining: 15,
                percent: 85,
                state: 'warning',
              },
              {
                id: 4,
                categoryId: 4,
                categoryName: 'D',
                categoryIcon: 'tag',
                amount: 100,
                spent: 10,
                remaining: 90,
                percent: 10,
                state: 'ok',
              },
            ],
          },
        }),
        FORMAT,
        {budgetRowLimit: 2},
      );

      const budgetRows = rows.filter(
        row => row.kind === 'budgetExceeded' || row.kind === 'budgetWarning',
      );
      expect(budgetRows.map(row => row.kind)).toEqual([
        'budgetExceeded',
        'budgetWarning',
      ]);
      expect(budgetRows[0]).toMatchObject({
        title: 'B budget exceeded',
        detail: 'Rs120 of Rs100 · 120% used',
      });
    });

    it('renders no budget rows when every budget is on track', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          budgetPerformance: {
            overall: null,
            topCategories: [],
            categoryBudgets: [
              {
                id: 1,
                categoryId: 1,
                categoryName: 'A',
                categoryIcon: 'tag',
                amount: 100,
                spent: 10,
                remaining: 90,
                percent: 10,
                state: 'ok',
              },
            ],
          },
        }),
        FORMAT,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('income direction rows', () => {
    it('reports a surplus when income exceeds expenses', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          income: 100_000,
          expenses: 40_000,
          balance: 60_000,
          incomeVsExpense: {income: 100_000, expenses: 40_000, balance: 60_000},
        }),
        FORMAT,
      );
      expect(rows.find(row => row.kind === 'incomeSurplus')).toMatchObject({
        detail: 'Rs60000 left over this period',
      });
    });

    it('reports an overspend when expenses exceed income', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          income: 10_000,
          expenses: 50_000,
          balance: -40_000,
          incomeVsExpense: {income: 10_000, expenses: 50_000, balance: -40_000},
        }),
        FORMAT,
      );
      expect(rows.find(row => row.kind === 'incomeDeficit')).toMatchObject({
        detail: 'Rs40000 overspent this period',
      });
    });

    it('stays silent on a perfectly balanced period', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          income: 50_000,
          expenses: 50_000,
          balance: 0,
          incomeVsExpense: {income: 50_000, expenses: 50_000, balance: 0},
        }),
        FORMAT,
      );
      expect(
        rows.filter(
          row => row.kind === 'incomeSurplus' || row.kind === 'incomeDeficit',
        ),
      ).toEqual([]);
    });
  });

  describe('spending trend row', () => {
    it('describes an increase against the labelled previous period', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          previousPeriodComparison: {
            currentTotal: 1_845_000,
            previousTotal: 1_520_000,
            difference: 325_000,
            percentChange: 21.4,
            direction: 'up',
          },
        }),
        FORMAT,
        {previousLabel: 'August 2026'},
      );
      expect(rows.find(row => row.kind === 'spendingTrend')).toMatchObject({
        detail: 'Up 21.4% vs August 2026',
      });
    });

    it('omits the trend row when the previous period had zero spending', () => {
      const rows = buildReportInsights(
        makeSnapshot({
          previousPeriodComparison: {
            currentTotal: 500_000,
            previousTotal: 0,
            difference: 500_000,
            percentChange: null,
            direction: 'up',
          },
        }),
        FORMAT,
        {previousLabel: 'August 2026'},
      );
      expect(rows.find(row => row.kind === 'spendingTrend')).toBeUndefined();
    });

    it('omits the trend row for a flat period or a missing label', () => {
      const flat = buildReportInsights(
        makeSnapshot({
          previousPeriodComparison: {
            currentTotal: 500,
            previousTotal: 500,
            difference: 0,
            percentChange: 0,
            direction: 'flat',
          },
        }),
        FORMAT,
        {previousLabel: 'August 2026'},
      );
      expect(flat.find(row => row.kind === 'spendingTrend')).toBeUndefined();

      const noLabel = buildReportInsights(
        makeSnapshot({
          previousPeriodComparison: {
            currentTotal: 900,
            previousTotal: 500,
            difference: 400,
            percentChange: 80,
            direction: 'up',
          },
        }),
        FORMAT,
      );
      expect(noLabel.find(row => row.kind === 'spendingTrend')).toBeUndefined();
    });
  });
});
