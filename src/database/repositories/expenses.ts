import type {DatabaseDriver, SqlParam} from '../driver';
import {DatabaseError, NotFoundError} from '../errors';
import type {
  Expense,
  ExpenseCategoryAggregate,
  ExpenseCategoryTotal,
  ExpenseDayTotal,
  ExpenseDraft,
  ExpenseFilter,
  ExpensePatch,
  ExpenseWithCategory,
} from '../models';
import {PAYMENT_METHODS} from '../models';
import {assertCategoryOfType} from './categoryChecks';
import {escapeLike, isSearchActive, normalizeSearchTerm} from './like';
import {
  optionalText,
  requireEnum,
  requireInt,
  requirePositiveInt,
  requireText,
} from './validate';

/** Column list with camelCase aliases so rows map straight onto `Expense`.
 *  Every column is qualified with the `e` alias so the same list stays
 *  usable whether or not the query joins categories (search needs the
 *  category name; `id`/timestamps would otherwise be ambiguous). */
const EXPENSE_COLUMNS = `
  e.id,
  e.amount,
  e.title,
  e.category_id AS categoryId,
  e.date,
  e.payment_method AS paymentMethod,
  e.note,
  e.created_at AS createdAt,
  e.updated_at AS updatedAt,
  e.recurring_rule_id AS recurringRuleId
`;

/** Joined columns so rows map straight onto `ExpenseWithCategory`. */
const EXPENSE_WITH_CATEGORY_COLUMNS = `
  e.id,
  e.amount,
  e.title,
  e.category_id AS categoryId,
  e.date,
  e.payment_method AS paymentMethod,
  e.note,
  e.created_at AS createdAt,
  e.updated_at AS updatedAt,
  e.recurring_rule_id AS recurringRuleId,
  c.name AS categoryName,
  c.icon AS categoryIcon
`;

const EXPENSE_ORDER: Record<NonNullable<ExpenseFilter['order']>, string> = {
  // Aliased as `e` in every query built by `buildListQuery`, so the ordering
  // columns stay unambiguous in the joined variant too.
  dateDesc: 'e.date DESC, e.id DESC',
  dateAsc: 'e.date ASC, e.id ASC',
  // Oldest-row tie-break keeps "largest transaction" deterministic.
  amountDesc: 'e.amount DESC, e.id ASC',
  // Phase 11: lowest-first browsing; same oldest-row tie-break.
  amountAsc: 'e.amount ASC, e.id ASC',
};

/** FROM clause that also exposes the joined category as `c`. */
const JOINED_CATEGORY_FROM =
  ' FROM expenses e JOIN categories c ON c.id = e.category_id';

/** Max length constants shared by create/update/list guards. */
const TITLE_MAX = 200;
const NOTE_MAX = 2000;

/**
 * CRUD + query access to the `expenses` table.
 *
 * All methods throw `ValidationError` for caller mistakes, `NotFoundError`
 * when an update target is missing, and `DatabaseError` (wrapping the SQLite
 * error) for engine-level failures such as FK/CHECK violations.
 */
export class ExpenseRepository {
  constructor(private readonly db: DatabaseDriver) {}

  async create(draft: ExpenseDraft): Promise<Expense> {
    const amount = requirePositiveInt(draft.amount, 'amount');
    const title = requireText(draft.title, 'title', TITLE_MAX);
    const categoryId = requirePositiveInt(draft.categoryId, 'categoryId');
    const date = requirePositiveInt(draft.date, 'date');
    const paymentMethod = requireEnum(
      draft.paymentMethod,
      PAYMENT_METHODS,
      'paymentMethod',
    );
    const note = optionalText(draft.note, 'note', NOTE_MAX);

    await assertCategoryOfType(this.db, categoryId, 'expense');

    const now = Date.now();
    // RETURNING keeps id capture atomic with the insert (supported by every
    // SQLite engine this project targets).
    const rows = await this.db.query<{id: number}>(
      `INSERT INTO expenses
        (amount, title, category_id, date, payment_method, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [amount, title, categoryId, date, paymentMethod, note, now, now],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'number') {
      throw new DatabaseError('Inserting an expense did not return an id');
    }
    return this.requireById(id, 'after insert');
  }

  async getById(id: number): Promise<Expense | null> {
    requirePositiveInt(id, 'id');
    const rows = await this.db.query<Expense>(
      `SELECT ${EXPENSE_COLUMNS} FROM expenses AS e WHERE e.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(filter: ExpenseFilter = {}): Promise<Expense[]> {
    // When a search term is active the category-name clause needs the join;
    // INNER JOIN on the NOT NULL FK cannot change which expense rows match.
    const searchActive = isSearchActive(filter.search);
    const {sql, params} = this.buildListQuery(
      EXPENSE_COLUMNS,
      searchActive ? JOINED_CATEGORY_FROM : ' FROM expenses AS e',
      filter,
      searchActive,
    );
    return this.db.query<Expense>(sql, params);
  }

  /**
   * Same as `list`, but each row is joined with its category's name and
   * icon so list screens never need a second query per row.
   */
  async listWithCategory(
    filter: ExpenseFilter = {},
  ): Promise<ExpenseWithCategory[]> {
    const {sql, params} = this.buildListQuery(
      EXPENSE_WITH_CATEGORY_COLUMNS,
      JOINED_CATEGORY_FROM,
      filter,
      true,
    );
    return this.db.query<ExpenseWithCategory>(sql, params);
  }

  /**
   * Spending aggregated per category. Ordered by total descending.
   * Accepts the same filters as `list` (except ordering/pagination, which
   * are meaningless for an aggregate).
   */
  async sumByCategory(
    filter: ExpenseFilter = {},
  ): Promise<ExpenseCategoryTotal[]> {
    const {where, params} = buildExpenseWhere(filter);
    const rows = await this.db.query<ExpenseCategoryTotal>(
      `SELECT category_id AS categoryId, COALESCE(SUM(amount), 0) AS total
       FROM expenses${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}
       GROUP BY category_id
       ORDER BY total DESC, categoryId ASC`,
      params,
    );
    return rows;
  }

  /**
   * Spending AND transaction frequency per category in ONE grouped query
   * (Phase 9). Same ordering contract as `sumByCategory`; callers build
   * category comparisons/insights from this instead of looping per-category
   * count queries (no N+1).
   */
  async sumCountByCategory(
    filter: ExpenseFilter = {},
  ): Promise<ExpenseCategoryAggregate[]> {
    const {where, params} = buildExpenseWhere(filter);
    const rows = await this.db.query<ExpenseCategoryAggregate>(
      `SELECT category_id AS categoryId,
              COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS transactionCount
       FROM expenses${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}
       GROUP BY category_id
       ORDER BY total DESC, categoryId ASC`,
      params,
    );
    return rows;
  }

  async count(filter: ExpenseFilter = {}): Promise<number> {
    // Joins categories under an active search so the count always matches
    // what `list` / `listWithCategory` return for the same filter.
    const searchActive = isSearchActive(filter.search);
    const {where, params} = buildExpenseWhere(filter, searchActive);
    const rows = await this.db.query<{count: number}>(
      `SELECT COUNT(*) AS count FROM expenses${
        searchActive ? ' e JOIN categories c ON c.id = e.category_id' : ''
      }${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}`,
      params,
    );
    return rows[0]?.count ?? 0;
  }

  async sumAmount(filter: ExpenseFilter = {}): Promise<number> {
    const {where, params} = buildExpenseWhere(filter);
    const rows = await this.db.query<{total: number}>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses${
        where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
      }`,
      params,
    );
    return rows[0]?.total ?? 0;
  }

  /**
   * Spending aggregated per calendar day within the given window.
   *
   * SQLite has no notion of the user's timezone, so buckets are computed
   * relative to the `fromDate` anchor: `dayIndex = (date - fromDate) / one
   * day`, truncated. Callers MUST pass `fromDate` as local midnight (see
   * `startOfDay` / `monthBounds` / `weekBounds`) — the app commits record
   * dates at local noon (shared `CalendarSheet`), which keeps every bucket
   * aligned with the calendar day it was recorded on.
   *
   * Days without expenses are absent from the result; compose with the
   * period's own day list to render complete series.
   *
   * Phase 9: an optional `categoryId` scopes the series to one category
   * (report drill-down). The bucket math is unchanged — `dayIndex` stays
   * anchored to the same `fromDate` local midnight.
   */
  async sumByDay(filter: {
    fromDate: number;
    toDate: number;
    categoryId?: number;
  }): Promise<ExpenseDayTotal[]> {
    const fromDate = requirePositiveInt(filter.fromDate, 'fromDate');
    const toDate = requirePositiveInt(filter.toDate, 'toDate');

    const where = ['date >= ?', 'date <= ?'];
    const params: SqlParam[] = [fromDate, toDate];
    if (filter.categoryId !== undefined) {
      where.push('category_id = ?');
      params.push(requirePositiveInt(filter.categoryId, 'categoryId'));
    }

    const rows = await this.db.query<{dayIndex: number; total: number}>(
      `SELECT CAST((date - ?) / 86400000 AS INTEGER) AS dayIndex,
              COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE ${where.join(' AND ')}
       GROUP BY dayIndex
       ORDER BY dayIndex ASC`,
      [fromDate, ...params],
    );
    return rows;
  }

  async update(id: number, patch: ExpensePatch): Promise<Expense> {
    requirePositiveInt(id, 'id');
    const sets: string[] = [];
    const params: SqlParam[] = [];

    if (patch.amount !== undefined) {
      sets.push('amount = ?');
      params.push(requirePositiveInt(patch.amount, 'amount'));
    }
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(requireText(patch.title, 'title', TITLE_MAX));
    }
    if (patch.categoryId !== undefined) {
      const categoryId = requirePositiveInt(patch.categoryId, 'categoryId');
      await assertCategoryOfType(this.db, categoryId, 'expense');
      sets.push('category_id = ?');
      params.push(categoryId);
    }
    if (patch.date !== undefined) {
      sets.push('date = ?');
      params.push(requirePositiveInt(patch.date, 'date'));
    }
    if (patch.paymentMethod !== undefined) {
      sets.push('payment_method = ?');
      params.push(
        requireEnum(patch.paymentMethod, PAYMENT_METHODS, 'paymentMethod'),
      );
    }
    if (patch.note !== undefined) {
      sets.push('note = ?');
      params.push(optionalText(patch.note, 'note', NOTE_MAX));
    }

    if (sets.length === 0) {
      // Empty patch is a no-op, but we still verify the row exists.
      const current = await this.getById(id);
      if (!current) {
        throw new NotFoundError('Expense', id);
      }
      return current;
    }

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    const {rowsAffected} = await this.db.run(
      `UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Expense', id);
    }
    return this.requireById(id, 'after update');
  }

  /** @returns true when a row was deleted, false when the id did not exist. */
  async delete(id: number): Promise<boolean> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM expenses WHERE id = ?',
      [id],
    );
    return rowsAffected > 0;
  }

  private async requireById(id: number, when: string): Promise<Expense> {
    const expense = await this.getById(id);
    if (!expense) {
      throw new DatabaseError(`Expense ${id} could not be read back ${when}`);
    }
    return expense;
  }

  private buildListQuery(
    columns: string,
    fromClause: string,
    filter: ExpenseFilter,
    joinedCategory: boolean,
  ): {
    sql: string;
    params: SqlParam[];
  } {
    const {where, params} = buildExpenseWhere(filter, joinedCategory);

    let limitClause = '';
    if (filter.limit !== undefined) {
      limitClause = ' LIMIT ?';
      params.push(requirePositiveInt(filter.limit, 'limit'));
      if (filter.offset !== undefined) {
        limitClause += ' OFFSET ?';
        params.push(requireInt(filter.offset, 'offset'));
      }
    } else if (filter.offset !== undefined) {
      // SQLite idiom for OFFSET without LIMIT.
      limitClause = ' LIMIT -1 OFFSET ?';
      params.push(requireInt(filter.offset, 'offset'));
    }

    const order = filter.order ?? 'dateDesc';
    const sql =
      `SELECT ${columns}${fromClause}` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY ${EXPENSE_ORDER[order]}` +
      limitClause;
    return {sql, params};
  }
}

/**
 * Builds the WHERE clauses shared by every expense read query.
 *
 * All values are parameterized; user-provided search terms are escaped and
 * whitespace-normalized (`normalizeSearchTerm`), never interpolated.
 *
 * The category-name search clause references the joined category alias `c`,
 * so callers WITHOUT the join (`sumAmount` / `sumByCategory` /
 * `sumCountByCategory` — none of which receive a search today) pass
 * `joinedCategory: false` and get title/note/payment matching only.
 */
function buildExpenseWhere(
  filter: ExpenseFilter,
  joinedCategory = false,
): {
  where: string[];
  params: SqlParam[];
} {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.categoryId !== undefined) {
    where.push('category_id = ?');
    params.push(requirePositiveInt(filter.categoryId, 'categoryId'));
  }
  if (filter.paymentMethod !== undefined) {
    where.push('payment_method = ?');
    params.push(
      requireEnum(filter.paymentMethod, PAYMENT_METHODS, 'paymentMethod'),
    );
  }
  if (filter.fromDate !== undefined) {
    where.push('date >= ?');
    params.push(requirePositiveInt(filter.fromDate, 'fromDate'));
  }
  if (filter.toDate !== undefined) {
    where.push('date <= ?');
    params.push(requirePositiveInt(filter.toDate, 'toDate'));
  }
  if (filter.minAmount !== undefined) {
    where.push('amount >= ?');
    params.push(requirePositiveInt(filter.minAmount, 'minAmount'));
  }
  if (filter.maxAmount !== undefined) {
    where.push('amount <= ?');
    params.push(requirePositiveInt(filter.maxAmount, 'maxAmount'));
  }
  if (filter.recurring !== undefined) {
    // Phase 11: the provenance column is the ONLY recurrence signal —
    // never inferred from title or date.
    where.push(
      filter.recurring
        ? 'recurring_rule_id IS NOT NULL'
        : 'recurring_rule_id IS NULL',
    );
  }
  if (filter.search !== undefined) {
    const term = normalizeSearchTerm(filter.search);
    if (term.length > 0) {
      // LIKE is case-insensitive for ASCII by default in SQLite. Spaces map
      // to underscores for the payment-method clause so "bank transfer"
      // matches the stored `bank_transfer` enum value.
      const paymentPattern = `%${escapeLike(term.replace(/\s+/g, '_'))}%`;
      const clauses = [`title LIKE ? ESCAPE '\\'`, `note LIKE ? ESCAPE '\\'`];
      params.push(`%${escapeLike(term)}%`, `%${escapeLike(term)}%`);
      if (joinedCategory) {
        clauses.push(`c.name LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(term)}%`);
      }
      clauses.push(`payment_method LIKE ? ESCAPE '\\'`);
      params.push(paymentPattern);
      where.push(`(${clauses.join(' OR ')})`);
    }
  }

  return {where, params};
}
