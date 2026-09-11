import type {
  Category,
  ExpenseFilter,
  ExpenseWithCategory,
  Income,
  IncomeFilter,
} from '@/database/models';
import type {DatabaseService} from '@/database/service';
import {startOfDay, endOfDay, startOfMonth, endOfMonth} from '@/utils/date';
import {createExpenseFeature} from '@/features/expenses/service';
import {DASHBOARD_RECENT_LIMIT} from '@/features/expenses/types';
import type {
  DashboardSnapshot,
  TransactionItem,
  TransactionPage,
  TransactionQuery,
  TransactionRecurringFilter,
  TransactionSort,
  TransactionTypeFilter,
} from './types';
import {TRANSACTION_PAGE_SIZE} from './types';
import {transactionPeriodToBounds} from './filters';

/**
 * Combined read layer over expenses + income.
 *
 * Expenses and income stay separate tables; this feature composes the
 * expense feature service with the income repository and normalizes both
 * into the shared `TransactionItem` view model. It is the ONLY layer the
 * Transactions screen and the dashboard talk to — no raw SQL reaches the
 * UI, and SQLite remains the single source of truth.
 *
 * Every filter (search, type, category, payment method, recurring, date
 * window, amount bounds) is applied INSIDE the SQL queries (Phase 11);
 * the JS-side merge below only stitches the two already-filtered, already
 * ordered streams into one paginated ledger — no loading of whole tables.
 *
 * Created via `createTransactionsFeature(db)` so tests run on the
 * `node:sqlite` driver.
 */
export interface TransactionsFeature {
  /**
   * EVERY expense category (archived included) for the filter sheet —
   * historical transactions must stay discoverable under archived
   * categories. New-transaction pickers use the expense feature's
   * active-only listing instead.
   */
  listFilterCategories(): Promise<Category[]>;

  /** One page of the mixed ledger under the given filters and sort. */
  getTransactionPage(query: TransactionQuery): Promise<TransactionPage>;

  /**
   * SQL COUNT of the rows matching the same filters, for the compact
   * result summary. Runs two lightweight aggregate queries — never loads
   * rows.
   */
  getTransactionCount(query: TransactionQuery): Promise<number>;

  /** Dashboard aggregates (income, spending, balance) for day/month. */
  getDashboardSnapshot(now?: number): Promise<DashboardSnapshot>;
}

/** Fallback icon for income rows whose source has no matching category. */
export const INCOME_FALLBACK_ICON = 'cash';

/** Maps an expense row (with category join) onto the shared view model. */
export function expenseToTransactionItem(
  row: ExpenseWithCategory,
): TransactionItem {
  return {
    key: `expense-${row.id}`,
    type: 'expense',
    id: row.id,
    date: row.date,
    amount: row.amount,
    title: row.title,
    category: row.categoryName,
    icon: row.categoryIcon,
    note: row.note,
    paymentMethod: row.paymentMethod,
    recurringRuleId: row.recurringRuleId ?? null,
  };
}

/** Maps an income row onto the shared view model (icon via source match). */
export function incomeToTransactionItem(
  row: Income,
  iconBySource: Map<string, string>,
): TransactionItem {
  return {
    key: `income-${row.id}`,
    type: 'income',
    id: row.id,
    date: row.date,
    amount: row.amount,
    title: row.source,
    category: null,
    icon: iconBySource.get(row.source) ?? INCOME_FALLBACK_ICON,
    note: row.note,
    recurringRuleId: row.recurringRuleId ?? null,
  };
}

/**
 * Sort order per source, whitelisted per repository — sort values never
 * reach SQL as strings built from user input (spec §27).
 */
const SORT_TO_ORDER: Record<
  TransactionSort,
  {expense: ExpenseFilter['order']; income: IncomeFilter['order']}
> = {
  newest: {expense: 'dateDesc', income: 'dateDesc'},
  oldest: {expense: 'dateAsc', income: 'dateAsc'},
  highest: {expense: 'amountDesc', income: 'amountDesc'},
  lowest: {expense: 'amountAsc', income: 'amountAsc'},
};

/**
 * The merge comparator matches the SQL ordering's PRIMARY key only; ties
 * keep a stable expense-then-income order (each stream already arrives
 * id-tie-broken from SQL), so the merged ledger is deterministic.
 */
function mergeComparatorFor(
  sort: TransactionSort,
): (a: TransactionItem, b: TransactionItem) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.date - b.date;
    case 'highest':
      return (a, b) => b.amount - a.amount;
    case 'lowest':
      return (a, b) => a.amount - b.amount;
    default:
      return (a, b) => b.date - a.date;
  }
}

/** Resolves the recurring filter into the repositories' boolean contract. */
function recurringFlag(
  filter: TransactionRecurringFilter | undefined,
): boolean | undefined {
  if (filter === 'recurring') {
    return true;
  }
  if (filter === 'manual') {
    return false;
  }
  return undefined;
}

/** Options shared by the page query and the count query. */
interface ResolvedQuery {
  includeExpense: boolean;
  includeIncome: boolean;
  expenseFilter: ExpenseFilter;
  incomeFilter: IncomeFilter;
  sort: TransactionSort;
}

function resolveQuery(query: TransactionQuery): ResolvedQuery {
  const type: TransactionTypeFilter = query.type ?? 'all';
  const sort: TransactionSort = query.sort ?? 'newest';
  const now = Date.now();
  const {fromDate, toDate} = transactionPeriodToBounds(
    query.period,
    query.customRange,
    now,
  );

  // Income has no category FK and no payment method, so either filter can
  // only match expenses — income rows are excluded while one is active.
  const expenseConstrained =
    query.categoryId != null || query.paymentMethod != null;
  const includeExpense = type !== 'income';
  const includeIncome = type !== 'expense' && !expenseConstrained;

  const expenseFilter: ExpenseFilter = {
    search: query.search,
    categoryId: query.categoryId ?? undefined,
    paymentMethod: query.paymentMethod ?? undefined,
    recurring: recurringFlag(query.recurring),
    fromDate,
    toDate,
    minAmount: query.minAmount ?? undefined,
    maxAmount: query.maxAmount ?? undefined,
  };
  const incomeFilter: IncomeFilter = {
    search: query.search,
    recurring: recurringFlag(query.recurring),
    fromDate,
    toDate,
    minAmount: query.minAmount ?? undefined,
    maxAmount: query.maxAmount ?? undefined,
  };

  return {includeExpense, includeIncome, expenseFilter, incomeFilter, sort};
}

export function createTransactionsFeature(
  db: DatabaseService,
): TransactionsFeature {
  // Reuse the expense feature for expense-side dashboard aggregates
  // (today/month totals + per-category ranking) instead of duplicating them.
  const expenseFeature = createExpenseFeature(db);

  async function getTransactionPage(
    query: TransactionQuery,
  ): Promise<TransactionPage> {
    const pageSize = query.pageSize ?? TRANSACTION_PAGE_SIZE;
    const page = Math.max(0, query.page ?? 0);
    const resolved = resolveQuery(query);

    /*
     * Window-merge pagination: to return rows [page*size, (page+1)*size) of
     * the merged stream, fetch `(page+1)*size + 1` rows from EACH active
     * source (from the top, ordered by the SAME sort key). Any single
     * source can contribute at most that many rows to the merged prefix
     * (pigeonhole), so the merge below always contains the true global
     * prefix — and `merged.length > (page+1)*size` is exactly "another
     * page exists".
     *
     * This stays correct for every sort order and even when one table
     * vastly outnumbers the other, where independent per-source page
     * offsets would silently skip rows.
     */
    const wantCount = (page + 1) * pageSize;
    const probe = wantCount + 1;

    const [expenseRows, incomeRows, incomeCategories] = await Promise.all([
      resolved.includeExpense
        ? db.expenses.listWithCategory({
            ...resolved.expenseFilter,
            limit: probe,
            order: SORT_TO_ORDER[resolved.sort].expense,
          })
        : Promise.resolve([] as ExpenseWithCategory[]),
      resolved.includeIncome
        ? db.income.list({
            ...resolved.incomeFilter,
            limit: probe,
            order: SORT_TO_ORDER[resolved.sort].income,
          })
        : Promise.resolve([] as Income[]),
      resolved.includeIncome
        ? db.categories.list('income')
        : Promise.resolve([] as Awaited<ReturnType<typeof db.categories.list>>),
    ]);

    const iconBySource = new Map(
      incomeCategories.map(category => [category.name, category.icon]),
    );

    // Stable sort keeps equal-key ties deterministic (expenses first, then
    // income, each already id-ordered by SQL).
    const merged = [
      ...expenseRows.map(expenseToTransactionItem),
      ...incomeRows.map(row => incomeToTransactionItem(row, iconBySource)),
    ].sort(mergeComparatorFor(resolved.sort));

    return {
      items: merged.slice(page * pageSize, wantCount),
      hasMore: merged.length > wantCount,
    };
  }

  async function getTransactionCount(query: TransactionQuery): Promise<number> {
    const resolved = resolveQuery(query);
    const [expenseCount, incomeCount] = await Promise.all([
      resolved.includeExpense
        ? db.expenses.count(resolved.expenseFilter)
        : Promise.resolve(0),
      resolved.includeIncome
        ? db.income.count(resolved.incomeFilter)
        : Promise.resolve(0),
    ]);
    return expenseCount + incomeCount;
  }

  return {
    listFilterCategories() {
      // Archived categories INCLUDED — historical records keep resolving.
      return db.categories.list('expense');
    },

    getTransactionPage,

    getTransactionCount,

    async getDashboardSnapshot(now: number = Date.now()) {
      const todayFrom = startOfDay(now);
      const todayTo = endOfDay(now);
      const monthFrom = startOfMonth(now);
      const monthTo = endOfMonth(now);

      const [expenseSnapshot, todayIncome, monthIncome] = await Promise.all([
        expenseFeature.getDashboardSnapshot(now),
        db.income.sumAmount({fromDate: todayFrom, toDate: todayTo}),
        db.income.sumAmount({fromDate: monthFrom, toDate: monthTo}),
      ]);

      const recentPage = await getTransactionPage({
        page: 0,
        pageSize: DASHBOARD_RECENT_LIMIT,
      });

      return {
        todayIncome,
        todayExpense: expenseSnapshot.todayTotal,
        todayBalance: todayIncome - expenseSnapshot.todayTotal,
        monthIncome,
        monthExpense: expenseSnapshot.monthTotal,
        monthBalance: monthIncome - expenseSnapshot.monthTotal,
        categoryTotals: expenseSnapshot.categoryTotals,
        recent: recentPage.items,
      };
    },
  };
}
