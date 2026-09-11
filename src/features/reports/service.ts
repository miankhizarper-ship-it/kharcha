import type {ExpenseWithCategory, Income} from '@/database/models';
import type {DatabaseService} from '@/database/service';
import {createBudgetFeature} from '@/features/budgets/service';
import type {TransactionItem} from '@/features/transactions/types';
import {monthBounds, previousMonth} from '@/utils/date';
import {
  buildBucketedSeries,
  buildDailySeries,
  computeAverageDailySpend,
  computeAverageTransaction,
  computeBalance,
  computeCategoryBreakdown,
  computePercentChange,
  computeTopCategory,
  findHighestSpendingDay,
  trendBucketDaysFor,
} from './calculate';
import {CategoryReportScopeError} from './errors';
import {
  dayCountBetween,
  resolvePreviousPeriod,
  resolveReportPeriod,
} from './period';
import type {
  CategoryReportDetail,
  CategoryReportScope,
  IncomeSourceSummary,
  ReportBudgetPerformance,
  ReportLargestTransaction,
  ReportSelection,
  ReportSnapshot,
} from './types';
import {
  INCOME_FALLBACK_ICON,
  expenseToTransactionItem,
  incomeToTransactionItem,
} from '@/features/transactions/service';

/**
 * Feature-level service for the Reports vertical slice.
 *
 * One `getReportSnapshot` call assembles the complete analytics model for a
 * selection — totals, daily series, category breakdown, insights, month
 * comparison and budget performance — straight from SQLite. Screens never
 * build SQL, and nothing is cached: every load reflects the current rows,
 * so focus-triggered refetches pick up new/edited/deleted transactions and
 * budget changes automatically.
 *
 * Budget performance reuses `createBudgetFeature` (the same service the
 * Budget screen uses) instead of duplicating any budget math — the same
 * composition pattern the combined transactions feature applies to
 * expenses.
 *
 * Phase 9 adds category drill-down: `getCategoryReportDetail` recomputes
 * everything for ONE scope (an expense category or an income source) from
 * focused queries — explicitly allowed because it represents one category —
 * while the overview snapshot keeps using grouped aggregation only (no
 * per-category query loops anywhere).
 *
 * Created via `createReportFeature(db)` — the injected `DatabaseService`
 * makes the whole feature testable on the `node:sqlite` driver.
 */
export interface ReportFeature {
  /** Complete analytics snapshot for the selected period. */
  getReportSnapshot(
    selection: ReportSelection,
    now?: number,
  ): Promise<ReportSnapshot>;

  /**
   * Drill-down model for one category or income source over the Reports
   * screen's current window (`bounds` are the resolved period bounds the
   * overview rendered with — the screen passes them through so the drill-
   * down always shows exactly the period the user came from).
   */
  getCategoryReportDetail(
    scope: CategoryReportScope,
    selection: ReportSelection,
    bounds: {fromDate: number; toDate: number},
  ): Promise<CategoryReportDetail>;

  /**
   * One page of the drill-down's transaction list, newest first (Phase 9).
   * Keeps the list from loading an unnecessarily large dataset — pages are
   * fetched on demand while the metrics above stay aggregate-driven.
   */
  getCategoryTransactionPage(
    scope: CategoryReportScope,
    bounds: {fromDate: number; toDate: number},
    page: number,
    pageSize?: number,
  ): Promise<{items: TransactionItem[]; hasMore: boolean}>;
}

/** How many category-budget statuses the compact budget card shows. */
const BUDGET_TOP_CATEGORY_LIMIT = 3;

/** Default page size for the category detail transaction list. */
export const CATEGORY_PAGE_SIZE = 20;

/** Fallback icon for rows whose category vanished between queries. */
const FALLBACK_ICON = 'pricetag';

export function createReportFeature(db: DatabaseService): ReportFeature {
  const budgetFeature = createBudgetFeature(db);

  async function loadBudgetPerformance(
    year: number,
    month: number,
  ): Promise<ReportBudgetPerformance> {
    const snapshot = await budgetFeature.getMonthSnapshot(year, month);
    const topCategories = [...snapshot.categories]
      .sort((a, b) => b.percent - a.percent || b.spent - a.spent)
      .slice(0, BUDGET_TOP_CATEGORY_LIMIT);
    return {
      overall: snapshot.overall,
      topCategories,
      categoryBudgets: snapshot.categories,
    };
  }

  /** Largest expense row of the window (amount desc, oldest-row ties). */
  async function findLargestExpense(
    filter: Parameters<typeof db.expenses.listWithCategory>[0],
  ): Promise<ReportLargestTransaction | null> {
    const rows = await db.expenses.listWithCategory({
      ...filter,
      order: 'amountDesc',
      limit: 1,
    });
    const row: ExpenseWithCategory | undefined = rows[0];
    return row
      ? {
          key: `expense-${row.id}`,
          type: 'expense',
          id: row.id,
          title: row.title,
          amount: row.amount,
          date: row.date,
          categoryName: row.categoryName,
        }
      : null;
  }

  /** Largest income row of the window (amount desc, oldest-row ties). */
  async function findLargestIncome(
    filter: Parameters<typeof db.income.list>[0],
  ): Promise<ReportLargestTransaction | null> {
    const rows = await db.income.list({
      ...filter,
      order: 'amountDesc',
      limit: 1,
    });
    const row: Income | undefined = rows[0];
    return row
      ? {
          key: `income-${row.id}`,
          type: 'income',
          id: row.id,
          title: row.source,
          amount: row.amount,
          date: row.date,
          categoryName: null,
        }
      : null;
  }

  return {
    async getReportSnapshot(
      selection: ReportSelection,
      now: number = Date.now(),
    ): Promise<ReportSnapshot> {
      const period = resolveReportPeriod(selection, now);
      const {fromDate, toDate} = period;

      const [
        income,
        expenses,
        dayTotals,
        categoryAggregates,
        categories,
        incomeSourcesRaw,
        incomeCategories,
        largestExpense,
        largestIncome,
      ] = await Promise.all([
        db.income.sumAmount({fromDate, toDate}),
        db.expenses.sumAmount({fromDate, toDate}),
        db.expenses.sumByDay({fromDate, toDate}),
        db.expenses.sumCountByCategory({fromDate, toDate}),
        db.categories.list('expense'),
        db.income.sumBySource({fromDate, toDate}),
        db.categories.list('income'),
        findLargestExpense({fromDate, toDate}),
        findLargestIncome({fromDate, toDate}),
      ]);

      const categoryById = new Map(categories.map(row => [row.id, row]));
      const breakdown = computeCategoryBreakdown(
        categoryAggregates.map(row => {
          const category = categoryById.get(row.categoryId);
          return {
            categoryId: row.categoryId,
            name: category?.name ?? 'Unknown category',
            icon: category?.icon ?? FALLBACK_ICON,
            total: row.total,
            transactionCount: row.transactionCount,
          };
        }),
        expenses,
      );

      // Frequency aggregates come from the SAME grouped query as the
      // totals — no extra COUNT queries (Phase 9, no N+1).
      const expenseCount = categoryAggregates.reduce(
        (sum, row) => sum + row.transactionCount,
        0,
      );
      const incomeCount = incomeSourcesRaw.reduce(
        (sum, row) => sum + row.transactionCount,
        0,
      );

      // Most transactions wins; ties resolve to more money, then lower id
      // (the aggregate rows already arrive ordered by total desc, id asc).
      const mostFrequent = [...categoryAggregates]
        .filter(row => row.transactionCount > 0)
        .sort(
          (a, b) =>
            b.transactionCount - a.transactionCount ||
            b.total - a.total ||
            a.categoryId - b.categoryId,
        )[0];
      const mostFrequentCategory = mostFrequent
        ? {
            categoryId: mostFrequent.categoryId,
            name:
              categoryById.get(mostFrequent.categoryId)?.name ??
              'Unknown category',
            icon:
              categoryById.get(mostFrequent.categoryId)?.icon ?? FALLBACK_ICON,
            transactionCount: mostFrequent.transactionCount,
            total: mostFrequent.total,
          }
        : null;

      // Income grouped by exact source text, largest first. Icons reuse the
      // transactions feature's convention: match income CATEGORIES by name.
      const iconBySource = new Map(
        incomeCategories.map(category => [category.name, category.icon]),
      );
      const incomeSources: IncomeSourceSummary[] = incomeSourcesRaw.map(
        row => ({
          source: row.source,
          icon: iconBySource.get(row.source) ?? INCOME_FALLBACK_ICON,
          total: row.total,
          percent:
            income > 0 ? Math.round((row.total / income) * 1000) / 10 : 0,
          transactionCount: row.transactionCount,
        }),
      );

      const dailySpending = buildDailySeries(
        fromDate,
        period.dayCount,
        new Map(dayTotals.map(row => [row.dayIndex, row.total])),
      );

      const balance = computeBalance(income, expenses);
      const largestTransaction = pickLargestTransaction(
        largestExpense,
        largestIncome,
      );

      // Month comparisons and budget performance are month-window concepts;
      // week/custom reports get null sections instead of wrong math.
      let previousPeriodComparison: ReportSnapshot['previousPeriodComparison'] =
        null;
      let budgetPerformance: ReportBudgetPerformance | null = null;
      if (selection.kind === 'month') {
        const previous = previousMonth(selection.year, selection.month);
        const previousBounds = monthBounds(previous.year, previous.month);
        const previousExpenses = await db.expenses.sumAmount({
          fromDate: previousBounds.fromDate,
          toDate: previousBounds.toDate,
        });
        previousPeriodComparison = computePercentChange(
          expenses,
          previousExpenses,
        );

        budgetPerformance = await loadBudgetPerformance(
          selection.year,
          selection.month,
        );
      }

      return {
        period,
        income,
        expenses,
        balance,
        averageDailySpend: computeAverageDailySpend(expenses, period.dayCount),
        dailySpending,
        categoryBreakdown: breakdown,
        incomeVsExpense: {income, expenses, balance},
        topCategory: computeTopCategory(breakdown),
        highestSpendingDay: findHighestSpendingDay(dailySpending),
        previousPeriodComparison,
        budgetPerformance,

        expenseCount,
        incomeCount,
        averageTransaction: computeAverageTransaction(expenses, expenseCount),
        largestTransaction,
        mostFrequentCategory,
        incomeSources,
      };
    },

    async getCategoryReportDetail(
      scope: CategoryReportScope,
      selection: ReportSelection,
      bounds: {fromDate: number; toDate: number},
    ): Promise<CategoryReportDetail> {
      const fromDate = bounds.fromDate;
      const toDate = bounds.toDate;
      const dayCount = dayCountBetween(fromDate, toDate);
      const period = {
        fromDate,
        toDate,
        dayCount,
      };

      const previousPeriod = resolvePreviousPeriod(selection, {
        fromDate,
        toDate,
        dayCount,
      });

      const isExpenseScope = scope.kind === 'expense';
      const scopeFilter = isExpenseScope
        ? {categoryId: scope.categoryId}
        : {source: scope.source};

      // One batch of focused queries for THIS scope (never a per-category
      // loop — that would be N+1; this path represents a single category).
      const [
        scopeTotal,
        periodTotal,
        transactionCount,
        largestRows,
        dayTotals,
        previousTotal,
        category,
        incomeCategories,
        budgetMonthSnapshot,
      ] = await Promise.all([
        isExpenseScope
          ? db.expenses.sumAmount({fromDate, toDate, ...scopeFilter})
          : db.income.sumAmount({fromDate, toDate, ...scopeFilter}),
        isExpenseScope
          ? db.expenses.sumAmount({fromDate, toDate})
          : db.income.sumAmount({fromDate, toDate}),
        isExpenseScope
          ? db.expenses.count({fromDate, toDate, ...scopeFilter})
          : db.income.count({fromDate, toDate, ...scopeFilter}),
        isExpenseScope
          ? db.expenses.listWithCategory({
              fromDate,
              toDate,
              categoryId: scope.categoryId,
              order: 'amountDesc',
              limit: 1,
            })
          : db.income.list({
              fromDate,
              toDate,
              source: scope.source,
              order: 'amountDesc',
              limit: 1,
            }),
        isExpenseScope
          ? db.expenses.sumByDay({
              fromDate,
              toDate,
              categoryId: scope.categoryId,
            })
          : db.income.sumByDay({fromDate, toDate}),
        isExpenseScope
          ? db.expenses.sumAmount({
              fromDate: previousPeriod.fromDate,
              toDate: previousPeriod.toDate,
              ...scopeFilter,
            })
          : db.income.sumAmount({
              fromDate: previousPeriod.fromDate,
              toDate: previousPeriod.toDate,
              ...scopeFilter,
            }),
        isExpenseScope
          ? db.categories.getById(scope.categoryId)
          : Promise.resolve(null),
        isExpenseScope ? Promise.resolve([]) : db.categories.list('income'),
        // Budgets are a monthly concept; only month selections have one.
        isExpenseScope && selection.kind === 'month'
          ? budgetFeature.getMonthSnapshot(selection.year, selection.month)
          : Promise.resolve(null),
      ]);

      if (isExpenseScope && !category) {
        // The category vanished (deleted between Reports and the drill-
        // down). Fail with a typed, user-explainable error — not raw SQL.
        throw new CategoryReportScopeError(
          `Category ${scope.categoryId} not found`,
        );
      }

      const iconBySource = new Map(
        incomeCategories.map(row => [row.name, row.icon]),
      );

      const largestRow = largestRows[0];
      const largestTransaction = largestRow
        ? isExpenseScope
          ? expenseToTransactionItem(largestRow as ExpenseWithCategory)
          : incomeToTransactionItem(largestRow as Income, iconBySource)
        : null;

      const largest: ReportLargestTransaction | null = largestTransaction
        ? {
            key: largestTransaction.key,
            type: largestTransaction.type,
            id: largestTransaction.id,
            title: largestTransaction.title,
            amount: largestTransaction.amount,
            date: largestTransaction.date,
            categoryName: largestTransaction.category,
          }
        : null;

      // Long custom ranges bucket into readable bars; short ones stay daily.
      const bucketDays = trendBucketDaysFor(dayCount);
      const totalByDayIndex = new Map(
        dayTotals.map(row => [row.dayIndex, row.total]),
      );
      const trend = bucketDays
        ? buildBucketedSeries(fromDate, dayCount, totalByDayIndex, bucketDays)
        : buildDailySeries(fromDate, dayCount, totalByDayIndex);

      const budget =
        budgetMonthSnapshot?.categories.find(
          row =>
            row.categoryId ===
            (scope.kind === 'expense' ? scope.categoryId : -1),
        ) ?? null;

      const budgetStatus: CategoryReportDetail['budgetStatus'] =
        scope.kind === 'income'
          ? 'notMonthly'
          : selection.kind === 'month'
            ? budget
              ? 'set'
              : 'notSet'
            : 'notMonthly';

      return {
        scope,
        name:
          scope.kind === 'expense'
            ? (category?.name ?? 'Unknown category')
            : scope.source,
        icon:
          scope.kind === 'expense'
            ? (category?.icon ?? FALLBACK_ICON)
            : (iconBySource.get(scope.source) ?? INCOME_FALLBACK_ICON),
        isActive:
          scope.kind === 'expense' ? (category?.isActive ?? false) : null,
        period,
        total: scopeTotal,
        percent:
          periodTotal > 0
            ? Math.round((scopeTotal / periodTotal) * 1000) / 10
            : null,
        transactionCount,
        averageTransaction: computeAverageTransaction(
          scopeTotal,
          transactionCount,
        ),
        largestTransaction: largest,
        trend,
        trendBucketDays: bucketDays,
        budget,
        budgetStatus,
        previousComparison: computePercentChange(scopeTotal, previousTotal),
      };
    },

    async getCategoryTransactionPage(
      scope: CategoryReportScope,
      bounds: {fromDate: number; toDate: number},
      page: number,
      pageSize: number = CATEGORY_PAGE_SIZE,
    ): Promise<{items: TransactionItem[]; hasMore: boolean}> {
      const safePage = Math.max(0, Math.floor(page));
      const safeSize = Math.max(1, Math.floor(pageSize));
      // Fetch one probe row past the page to learn whether another exists
      // (same trick as the combined ledger's window-merge pagination).
      const probe = (safePage + 1) * safeSize + 1;
      const filter = {
        fromDate: bounds.fromDate,
        toDate: bounds.toDate,
        limit: probe,
        offset: safePage * safeSize,
        order: 'dateDesc' as const,
      };

      const isExpenseScope = scope.kind === 'expense';
      const [rows, incomeCategories] = await Promise.all([
        isExpenseScope
          ? db.expenses.listWithCategory({
              ...filter,
              categoryId: scope.categoryId,
            })
          : db.income.list({
              ...filter,
              source: scope.source,
            }),
        isExpenseScope ? Promise.resolve([]) : db.categories.list('income'),
      ]);

      const iconBySource = new Map(
        incomeCategories.map(category => [category.name, category.icon]),
      );

      const items = rows.map(row =>
        isExpenseScope
          ? expenseToTransactionItem(row as ExpenseWithCategory)
          : incomeToTransactionItem(row as Income, iconBySource),
      );

      // The SQL already skipped past rows (OFFSET page*size); trimming to
      // the page size leaves exactly this page — the probe row only tells
      // us whether another page exists.
      return {
        items: items.slice(0, safeSize),
        hasMore: items.length > safeSize,
      };
    },
  };
}

/** Deterministic overall-largest pick: the bigger amount wins, expense ties. */
function pickLargestTransaction(
  expense: ReportLargestTransaction | null,
  income: ReportLargestTransaction | null,
): ReportLargestTransaction | null {
  if (!expense) {
    return income;
  }
  if (!income) {
    return expense;
  }
  return income.amount > expense.amount ? income : expense;
}
