import type {DatabaseDriver} from '../driver';
import {DatabaseError, NotFoundError, ValidationError} from '../errors';
import type {
  Budget,
  BudgetDraft,
  BudgetPatch,
  BudgetWithCategory,
} from '../models';
import {assertCategoryOfType} from './categoryChecks';
import {requirePositiveInt} from './validate';
import {withTransaction} from '../transaction';

export const MONTH_MIN = 1;
export const MONTH_MAX = 12;
export const YEAR_MIN = 2000;
export const YEAR_MAX = 2100;

const BUDGET_COLUMNS = `
  b.id,
  b.category_id AS categoryId,
  b.amount,
  b.month,
  b.year,
  b.created_at AS createdAt,
  b.updated_at AS updatedAt
`;

/**
 * Period guards shared with `monthlyBudgets.ts` (same 1-12 / 2000-2100
 * rules as the CHECK constraints in the migrations).
 */
export function requireMonth(value: unknown): number {
  const month = requirePositiveInt(value, 'month');
  if (month < MONTH_MIN || month > MONTH_MAX) {
    throw new ValidationError(
      'month',
      `must be between ${MONTH_MIN} and ${MONTH_MAX}`,
    );
  }
  return month;
}

export function requireYear(value: unknown): number {
  const year = requirePositiveInt(value, 'year');
  if (year < YEAR_MIN || year > YEAR_MAX) {
    throw new ValidationError(
      'year',
      `must be between ${YEAR_MIN} and ${YEAR_MAX}`,
    );
  }
  return year;
}

/**
 * CRUD + query access to the `budgets` table.
 *
 * One budget per (category, year, month) — enforced by the unique index
 * `idx_budgets_category_period`. Prefer `upsert` over `create` when the UI
 * allows editing an existing monthly budget in place; `create` rejects
 * duplicates with a `DatabaseError` wrapping the UNIQUE violation.
 *
 * Budgets are only meaningful for expense categories: `categoryId` must
 * reference a category of type 'expense'.
 */
export class BudgetRepository {
  constructor(private readonly db: DatabaseDriver) {}

  async create(draft: BudgetDraft): Promise<Budget> {
    const categoryId = requirePositiveInt(draft.categoryId, 'categoryId');
    const amount = requirePositiveInt(draft.amount, 'amount');
    const month = requireMonth(draft.month);
    const year = requireYear(draft.year);

    await assertCategoryOfType(this.db, categoryId, 'expense');

    const now = Date.now();
    const rows = await this.db.query<{id: number}>(
      `INSERT INTO budgets (category_id, amount, month, year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [categoryId, amount, month, year, now, now],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'number') {
      throw new DatabaseError('Inserting a budget did not return an id');
    }
    return this.requireById(id, 'after insert');
  }

  /**
   * Creates the budget for (categoryId, year, month) or updates its amount
   * when one already exists. Returns the resulting row.
   */
  async upsert(input: BudgetDraft): Promise<Budget> {
    const categoryId = requirePositiveInt(input.categoryId, 'categoryId');
    const month = requireMonth(input.month);
    const year = requireYear(input.year);
    const amount = requirePositiveInt(input.amount, 'amount');

    return withTransaction(this.db, async () => {
      const existing = await this.find(categoryId, month, year);
      if (existing) {
        return this.update(existing.id, {amount});
      }
      return this.create({categoryId, amount, month, year});
    });
  }

  async getById(id: number): Promise<Budget | null> {
    requirePositiveInt(id, 'id');
    const rows = await this.db.query<Budget>(
      `SELECT ${BUDGET_COLUMNS} FROM budgets b WHERE b.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async find(
    categoryId: number,
    month: number,
    year: number,
  ): Promise<Budget | null> {
    requirePositiveInt(categoryId, 'categoryId');
    requireMonth(month);
    requireYear(year);
    const rows = await this.db.query<Budget>(
      `SELECT ${BUDGET_COLUMNS} FROM budgets b
       WHERE b.category_id = ? AND b.month = ? AND b.year = ?`,
      [categoryId, month, year],
    );
    return rows[0] ?? null;
  }

  /** All budgets for a month, joined with category name/icon for list UIs. */
  async listByMonth(
    month: number,
    year: number,
  ): Promise<BudgetWithCategory[]> {
    requireMonth(month);
    requireYear(year);
    const rows = await this.db.query<BudgetWithCategory>(
      `SELECT ${BUDGET_COLUMNS},
              c.name AS categoryName,
              c.icon AS categoryIcon
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.month = ? AND b.year = ?
       ORDER BY c.name COLLATE NOCASE ASC`,
      [month, year],
    );
    return rows;
  }

  /**
   * Every budget across all periods, ordered deterministically. Added for
   * the backup/export feature (Phase 7B) — pure read, no behavior change.
   */
  async listAll(): Promise<Budget[]> {
    return this.db.query<Budget>(
      `SELECT ${BUDGET_COLUMNS} FROM budgets b
       ORDER BY b.year ASC, b.month ASC, b.category_id ASC, b.id ASC`,
    );
  }

  async update(id: number, patch: BudgetPatch): Promise<Budget> {
    requirePositiveInt(id, 'id');
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if (patch.amount !== undefined) {
      sets.push('amount = ?');
      params.push(requirePositiveInt(patch.amount, 'amount'));
    }
    if (patch.month !== undefined) {
      sets.push('month = ?');
      params.push(requireMonth(patch.month));
    }
    if (patch.year !== undefined) {
      sets.push('year = ?');
      params.push(requireYear(patch.year));
    }

    if (sets.length === 0) {
      const current = await this.getById(id);
      if (!current) {
        throw new NotFoundError('Budget', id);
      }
      return current;
    }

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    // NB: SQLite does not allow table-qualified names in SET, so this
    // statement cannot reuse the `b.` aliases used by the SELECTs above.
    const {rowsAffected} = await this.db.run(
      `UPDATE budgets SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Budget', id);
    }
    return this.requireById(id, 'after update');
  }

  /** @returns true when a row was deleted, false when the id did not exist. */
  async delete(id: number): Promise<boolean> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM budgets WHERE id = ?',
      [id],
    );
    return rowsAffected > 0;
  }

  /** Removes every budget of a category. @returns number of rows removed. */
  async deleteByCategory(categoryId: number): Promise<number> {
    requirePositiveInt(categoryId, 'categoryId');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM budgets WHERE category_id = ?',
      [categoryId],
    );
    return rowsAffected;
  }

  /**
   * Counts budgets that reference a category, across ALL months. Used by the
   * categories feature to refuse deleting a category whose budgets SQLite
   * would otherwise CASCADE away silently.
   */
  async countByCategory(categoryId: number): Promise<number> {
    requirePositiveInt(categoryId, 'categoryId');
    const rows = await this.db.query<{count: number}>(
      'SELECT COUNT(*) AS count FROM budgets WHERE category_id = ?',
      [categoryId],
    );
    return rows[0]?.count ?? 0;
  }

  private async requireById(id: number, when: string): Promise<Budget> {
    const budget = await this.getById(id);
    if (!budget) {
      throw new DatabaseError(`Budget ${id} could not be read back ${when}`);
    }
    return budget;
  }
}
