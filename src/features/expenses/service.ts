import type {DatabaseService} from '@/database/service';
import type {
  Category,
  CategoryType,
  Expense,
  ExpenseDraft,
  ExpenseFilter,
  ExpensePatch,
} from '@/database/models';
import {endOfDay, endOfMonth, startOfDay, startOfMonth} from '@/utils/date';
import {
  DASHBOARD_CATEGORY_LIMIT,
  DASHBOARD_RECENT_LIMIT,
  TRANSACTION_PAGE_SIZE,
  type CategoryTotal,
  type DashboardSnapshot,
  type PeriodFilter,
  type TransactionPage,
  type TransactionQuery,
} from './types';

/**
 * Feature-level service for the expenses vertical slice.
 *
 * This is the ONLY layer screens talk to; it funnels everything through the
 * repositories (`DatabaseService`), so SQLite stays the single source of
 * truth. Screens never build SQL and never cache full datasets in Zustand.
 *
 * Created via `createExpenseFeature(db)` — the injected `DatabaseService`
 * makes the whole feature testable on the `node:sqlite` driver.
 */
export interface ExpenseFeature {
  /**
   * Categories for pickers (`type` defaults to 'expense'). ACTIVE only —
   * archived categories must not be selectable for new transactions. Edit
   * flows re-resolve a record's legacy category via `getCategory` and
   * append it with `appendMissingCategory` so history stays editable.
   */
  listCategories(type?: CategoryType): Promise<Category[]>;

  /** Single category by id (any active state) — legacy-edit resolution. */
  getCategory(id: number): Promise<Category | null>;

  /** Single expense, or null when the id does not exist. */
  getExpense(id: number): Promise<Expense | null>;

  /** Creates an expense from a validated draft. */
  addExpense(draft: ExpenseDraft): Promise<Expense>;

  /** Updates an expense; the repository preserves `createdAt`. */
  editExpense(id: number, patch: ExpensePatch): Promise<Expense>;

  /** Deletes an expense; resolves false when the id did not exist. */
  removeExpense(id: number): Promise<boolean>;

  /** One page of the transactions list, newest first. */
  getTransactionPage(query: TransactionQuery): Promise<TransactionPage>;

  /** Dashboard aggregates for the current day/month. */
  getDashboardSnapshot(now?: number): Promise<DashboardSnapshot>;
}

/**
 * Maps a coarse period filter to inclusive epoch-millis bounds. Exported so
 * the combined transactions feature (`features/transactions`) applies
 * exactly the same date windows to income — one source of truth for period
 * boundaries.
 */
export function periodToBounds(
  period: PeriodFilter | undefined,
  now: number,
): {fromDate?: number; toDate?: number} {
  switch (period) {
    case 'thisMonth':
      return {fromDate: startOfMonth(now), toDate: endOfMonth(now)};
    case 'last7Days':
      return {fromDate: startOfDay(now - 6 * 24 * 60 * 60 * 1000)};
    default:
      return {};
  }
}

export function createExpenseFeature(db: DatabaseService): ExpenseFeature {
  return {
    listCategories(type: CategoryType = 'expense') {
      return db.categories.list(type, {activeOnly: true});
    },

    getCategory(id: number) {
      return db.categories.getById(id);
    },

    getExpense(id: number) {
      return db.expenses.getById(id);
    },

    addExpense(draft: ExpenseDraft) {
      return db.expenses.create(draft);
    },

    editExpense(id: number, patch: ExpensePatch) {
      return db.expenses.update(id, patch);
    },

    removeExpense(id: number) {
      return db.expenses.delete(id);
    },

    async getTransactionPage(
      query: TransactionQuery,
    ): Promise<TransactionPage> {
      const pageSize = query.pageSize ?? TRANSACTION_PAGE_SIZE;
      const page = Math.max(0, query.page ?? 0);
      const now = Date.now();
      const {fromDate, toDate} = periodToBounds(query.period, now);

      const filter: ExpenseFilter = {
        search: query.search,
        categoryId: query.categoryId ?? undefined,
        fromDate,
        toDate,
        // One extra row tells us whether a next page exists.
        limit: pageSize + 1,
        offset: page * pageSize,
        order: 'dateDesc',
      };

      const rows = await db.expenses.listWithCategory(filter);
      const hasMore = rows.length > pageSize;
      return {items: rows.slice(0, pageSize), hasMore};
    },

    async getDashboardSnapshot(
      now: number = Date.now(),
    ): Promise<DashboardSnapshot> {
      const todayFrom = startOfDay(now);
      const todayTo = endOfDay(now);
      const monthFrom = startOfMonth(now);
      const monthTo = endOfMonth(now);

      const [todayTotal, monthTotal, categoryRows, recent] = await Promise.all([
        db.expenses.sumAmount({fromDate: todayFrom, toDate: todayTo}),
        db.expenses.sumAmount({fromDate: monthFrom, toDate: monthTo}),
        db.expenses.sumByCategory({fromDate: monthFrom, toDate: monthTo}),
        db.expenses.listWithCategory({
          limit: DASHBOARD_RECENT_LIMIT,
          order: 'dateDesc',
        }),
      ]);

      const categories = await db.categories.list('expense');
      const byId = new Map(categories.map(category => [category.id, category]));

      const categoryTotals: CategoryTotal[] = categoryRows
        .map(row => {
          const category = byId.get(row.categoryId);
          return {
            categoryId: row.categoryId,
            name: category?.name ?? 'Unknown category',
            icon: category?.icon ?? 'pricetag',
            total: row.total,
          };
        })
        .slice(0, DASHBOARD_CATEGORY_LIMIT);

      return {todayTotal, monthTotal, categoryTotals, recent};
    },
  };
}
