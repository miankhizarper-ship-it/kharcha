import type {DatabaseDriver, SqlParam} from '../driver';
import {DatabaseError, NotFoundError, ValidationError} from '../errors';
import type {
  CategoryType,
  PaymentMethod,
  RecurringFilter,
  RecurringFrequency,
  RecurringTransaction,
  RecurringTransactionDraft,
  RecurringTransactionPatch,
  RecurringWithCategory,
} from '../models';
import {PAYMENT_METHODS, RECURRING_FREQUENCIES} from '../models';
import {assertCategoryOfType} from './categoryChecks';
import {
  optionalText,
  requireEnum,
  requirePositiveInt,
  requireText,
} from './validate';

/** Column list with camelCase aliases so rows map straight onto the model. */
const RECURRING_COLUMNS = `
  id,
  type,
  amount,
  title,
  category_id AS categoryId,
  frequency,
  start_date AS startDate,
  next_occurrence_at AS nextOccurrenceAt,
  end_date AS endDate,
  payment_method AS paymentMethod,
  note,
  is_active AS isActive,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

/** Joined columns for list screens (LEFT JOIN: income rules have no category). */
const RECURRING_WITH_CATEGORY_COLUMNS = `
  r.id,
  r.type,
  r.amount,
  r.title,
  r.category_id AS categoryId,
  r.frequency,
  r.start_date AS startDate,
  r.next_occurrence_at AS nextOccurrenceAt,
  r.end_date AS endDate,
  r.payment_method AS paymentMethod,
  r.note,
  r.is_active AS isActive,
  r.created_at AS createdAt,
  r.updated_at AS updatedAt,
  c.name AS categoryName,
  c.icon AS categoryIcon
`;

/** Raw row shape coming back from SQLite (0/1 flags, nullable columns). */
interface RecurringRow {
  id: number;
  type: string;
  amount: number;
  title: string;
  categoryId: number | null;
  frequency: string;
  startDate: number;
  nextOccurrenceAt: number;
  endDate: number | null;
  paymentMethod: string | null;
  note: string | null;
  isActive: number;
  createdAt: number;
  updatedAt: number;
  categoryName?: string | null;
  categoryIcon?: string | null;
}

function toRule(row: RecurringRow): RecurringWithCategory {
  return {
    id: row.id,
    type: row.type as CategoryType,
    amount: row.amount,
    title: row.title,
    categoryId: row.categoryId,
    frequency: row.frequency as RecurringFrequency,
    startDate: row.startDate,
    nextOccurrenceAt: row.nextOccurrenceAt,
    endDate: row.endDate,
    paymentMethod: row.paymentMethod as PaymentMethod | null,
    note: row.note,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    categoryName: row.categoryName ?? null,
    categoryIcon: row.categoryIcon ?? null,
  };
}

const TITLE_MAX = 200;
const NOTE_MAX = 2000;

/**
 * CRUD + query access to the `recurring_transactions` table (migration 004).
 *
 * Guard conventions mirror the expense/income repositories: caller mistakes
 * throw `ValidationError`, missing targets throw `NotFoundError`, and
 * engine-level failures (FK/CHECK/UNIQUE) throw `DatabaseError`.
 *
 * Semantics enforced here and in migration 004:
 * - expense rules REQUIRE a category of type 'expense' and a payment method;
 * - income rules REQUIRE neither (income has no category FK) and reject both;
 * - `type` is immutable after creation;
 * - deleting a rule never deletes the transactions it generated — the FK's
 *   ON DELETE SET NULL merely clears the `recurring_rule_id` reference.
 */
export class RecurringTransactionRepository {
  constructor(private readonly db: DatabaseDriver) {}

  async create(
    draft: RecurringTransactionDraft,
  ): Promise<RecurringTransaction> {
    const type = requireEnum(draft.type, ['expense', 'income'], 'type');
    const amount = requirePositiveInt(draft.amount, 'amount');
    const title = requireText(draft.title, 'title', TITLE_MAX);
    const frequency = requireEnum(
      draft.frequency,
      RECURRING_FREQUENCIES,
      'frequency',
    );
    const startDate = requirePositiveInt(draft.startDate, 'startDate');
    const nextOccurrenceAt = requirePositiveInt(
      draft.nextOccurrenceAt ?? startDate,
      'nextOccurrenceAt',
    );
    const note = optionalText(draft.note, 'note', NOTE_MAX);
    const isActive = draft.isActive ?? true;

    if (draft.endDate !== undefined && draft.endDate !== null) {
      const end = requirePositiveInt(draft.endDate, 'endDate');
      if (end < startDate) {
        throw new ValidationError('endDate', 'must be on or after startDate');
      }
    }

    let categoryId: number | null = null;
    let paymentMethod: string | null = null;

    if (type === 'expense') {
      categoryId = requirePositiveInt(draft.categoryId, 'categoryId') as number;
      await assertCategoryOfType(this.db, categoryId, 'expense');
      paymentMethod = requireEnum(
        draft.paymentMethod,
        PAYMENT_METHODS,
        'paymentMethod',
      );
    } else {
      // Income rules must not carry expense-only fields — the CHECK
      // constraint would reject them; fail early with a readable error.
      if (draft.categoryId !== undefined && draft.categoryId !== null) {
        throw new ValidationError(
          'categoryId',
          'income rules have no category',
        );
      }
      if (draft.paymentMethod) {
        throw new ValidationError(
          'paymentMethod',
          'income rules have no payment method',
        );
      }
    }

    const now = Date.now();
    const rows = await this.db.query<{id: number}>(
      `INSERT INTO recurring_transactions
        (type, amount, title, category_id, frequency, start_date,
         next_occurrence_at, end_date, payment_method, note, is_active,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        type,
        amount,
        title,
        categoryId,
        frequency,
        startDate,
        nextOccurrenceAt,
        draft.endDate ?? null,
        paymentMethod,
        note,
        isActive ? 1 : 0,
        now,
        now,
      ],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'number') {
      throw new DatabaseError(
        'Inserting a recurring rule did not return an id',
      );
    }
    return this.requireById(id, 'after insert');
  }

  async getById(id: number): Promise<RecurringTransaction | null> {
    requirePositiveInt(id, 'id');
    const rows = await this.db.query<RecurringRow>(
      `SELECT ${RECURRING_COLUMNS} FROM recurring_transactions WHERE id = ?`,
      [id],
    );
    return rows[0] ? toRule(rows[0]) : null;
  }

  /**
   * Lists rules, optionally filtered by type and/or active state, ordered by
   * next occurrence (soonest first). Includes paused rules by default —
   * management screens need them.
   */
  async list(filter: RecurringFilter = {}): Promise<RecurringTransaction[]> {
    const {sql, params} = this.buildListQuery(RECURRING_COLUMNS, filter, false);
    const rows = await this.db.query<RecurringRow>(sql, params);
    return rows.map(toRule);
  }

  /** Same as `list`, joined with the category (LEFT JOIN) for display. */
  async listWithCategory(
    filter: RecurringFilter = {},
  ): Promise<RecurringWithCategory[]> {
    const {sql, params} = this.buildListQuery(
      RECURRING_WITH_CATEGORY_COLUMNS,
      filter,
      true,
    );
    const rows = await this.db.query<RecurringRow>(sql, params);
    return rows.map(toRule);
  }

  async update(
    id: number,
    patch: RecurringTransactionPatch,
  ): Promise<RecurringTransaction> {
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
      const current = await this.getById(id);
      if (current?.type !== 'expense') {
        throw new ValidationError(
          'categoryId',
          'income rules have no category',
        );
      }
      await assertCategoryOfType(this.db, categoryId, 'expense');
      sets.push('category_id = ?');
      params.push(categoryId);
    }
    if (patch.frequency !== undefined) {
      sets.push('frequency = ?');
      params.push(
        requireEnum(patch.frequency, RECURRING_FREQUENCIES, 'frequency'),
      );
    }
    if (patch.nextOccurrenceAt !== undefined) {
      sets.push('next_occurrence_at = ?');
      params.push(
        requirePositiveInt(patch.nextOccurrenceAt, 'nextOccurrenceAt'),
      );
    }
    if (patch.endDate !== undefined) {
      // Explicit `null` clears the end date (optionalPositiveInt).
      const end =
        patch.endDate === null
          ? null
          : requirePositiveInt(patch.endDate, 'endDate');
      sets.push('end_date = ?');
      params.push(end);
    }
    if (patch.paymentMethod !== undefined) {
      const current = await this.getById(id);
      if (current?.type !== 'expense') {
        throw new ValidationError(
          'paymentMethod',
          'income rules have no payment method',
        );
      }
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
      const current = await this.getById(id);
      if (!current) {
        throw new NotFoundError('Recurring rule', id);
      }
      return current;
    }

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    const {rowsAffected} = await this.db.run(
      `UPDATE recurring_transactions SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Recurring rule', id);
    }
    return this.requireById(id, 'after update');
  }

  /**
   * Flips ONLY the active flag (pause/resume storage semantics). The
   * resume side-effect — skipping missed occurrences by advancing
   * `next_occurrence_at` past today — is a policy decision owned by the
   * recurring feature service, which composes this with `update`.
   */
  async setActive(id: number, isActive: boolean): Promise<void> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'UPDATE recurring_transactions SET is_active = ?, updated_at = ? WHERE id = ?',
      [isActive ? 1 : 0, Date.now(), id],
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Recurring rule', id);
    }
  }

  /**
   * Deletes ONLY the rule. Generated transactions are untouched; SQLite's
   * ON DELETE SET NULL clears their `recurring_rule_id` reference.
   * @returns true when a row was deleted, false when the id did not exist.
   */
  async delete(id: number): Promise<boolean> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM recurring_transactions WHERE id = ?',
      [id],
    );
    return rowsAffected > 0;
  }

  private async requireById(
    id: number,
    when: string,
  ): Promise<RecurringTransaction> {
    const rule = await this.getById(id);
    if (!rule) {
      throw new DatabaseError(
        `Recurring rule ${id} could not be read back ${when}`,
      );
    }
    return rule;
  }

  private buildListQuery(
    columns: string,
    filter: RecurringFilter,
    joined: boolean,
  ): {sql: string; params: SqlParam[]} {
    const conditions: string[] = [];
    const params: SqlParam[] = [];
    // The joined variant aliases the rule table as `r`, so ordering columns
    // must be prefixed to stay unambiguous against `categories`.
    const orderPrefix = joined ? 'r.' : '';

    if (filter.type !== undefined) {
      requireEnum(filter.type, ['expense', 'income'], 'type');
      conditions.push(`${orderPrefix}type = ?`);
      params.push(filter.type);
    }
    if (filter.isActive !== undefined) {
      conditions.push(`${orderPrefix}is_active = ?`);
      params.push(filter.isActive ? 1 : 0);
    }

    const where =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const from = joined
      ? ' FROM recurring_transactions r LEFT JOIN categories c ON c.id = r.category_id'
      : ' FROM recurring_transactions';
    return {
      sql: `SELECT ${columns}${from}${where} ORDER BY ${orderPrefix}next_occurrence_at ASC, ${orderPrefix}id ASC`,
      params,
    };
  }
}
