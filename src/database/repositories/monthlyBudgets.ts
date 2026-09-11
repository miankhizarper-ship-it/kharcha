import type {DatabaseDriver} from '../driver';
import {DatabaseError, NotFoundError} from '../errors';
import type {
  MonthlyBudget,
  MonthlyBudgetDraft,
  MonthlyBudgetPatch,
} from '../models';
import {withTransaction} from '../transaction';
import {requireMonth, requireYear} from './budgets';
import {requirePositiveInt} from './validate';

const MONTHLY_BUDGET_COLUMNS = `
  id,
  amount,
  month,
  year,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

/**
 * CRUD + upsert access to the `monthly_budgets` table (migration 002) —
 * the OVERALL budget for a month, independent of any category.
 *
 * One row per (year, month) — enforced by the unique index
 * `idx_monthly_budgets_period`. Prefer `upsert` over `create` when the UI
 * sets/edits a month's budget in place; `create` rejects duplicates with a
 * `DatabaseError` wrapping the UNIQUE violation.
 *
 * Mirrors `BudgetRepository` conventions (same validators, same error
 * types, amount stored in minor units).
 */
export class MonthlyBudgetRepository {
  constructor(private readonly db: DatabaseDriver) {}

  async create(draft: MonthlyBudgetDraft): Promise<MonthlyBudget> {
    const amount = requirePositiveInt(draft.amount, 'amount');
    const month = requireMonth(draft.month);
    const year = requireYear(draft.year);

    const now = Date.now();
    const rows = await this.db.query<{id: number}>(
      `INSERT INTO monthly_budgets (amount, month, year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [amount, month, year, now, now],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'number') {
      throw new DatabaseError(
        'Inserting a monthly budget did not return an id',
      );
    }
    return this.requireById(id, 'after insert');
  }

  /**
   * Creates the budget for (year, month) or updates its amount when one
   * already exists. Returns the resulting row.
   */
  async upsert(input: MonthlyBudgetDraft): Promise<MonthlyBudget> {
    const month = requireMonth(input.month);
    const year = requireYear(input.year);
    const amount = requirePositiveInt(input.amount, 'amount');

    return withTransaction(this.db, async () => {
      const existing = await this.find(month, year);
      if (existing) {
        return this.update(existing.id, {amount});
      }
      return this.create({amount, month, year});
    });
  }

  async getById(id: number): Promise<MonthlyBudget | null> {
    requirePositiveInt(id, 'id');
    const rows = await this.db.query<MonthlyBudget>(
      `SELECT ${MONTHLY_BUDGET_COLUMNS} FROM monthly_budgets WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** The overall budget for a month, or null when none is set. */
  async find(month: number, year: number): Promise<MonthlyBudget | null> {
    requireMonth(month);
    requireYear(year);
    const rows = await this.db.query<MonthlyBudget>(
      `SELECT ${MONTHLY_BUDGET_COLUMNS} FROM monthly_budgets
       WHERE month = ? AND year = ?`,
      [month, year],
    );
    return rows[0] ?? null;
  }

  /**
   * Every monthly budget across all periods, ordered deterministically.
   * Added for the backup/export feature (Phase 7B) — pure read.
   */
  async listAll(): Promise<MonthlyBudget[]> {
    return this.db.query<MonthlyBudget>(
      `SELECT ${MONTHLY_BUDGET_COLUMNS} FROM monthly_budgets
       ORDER BY year ASC, month ASC, id ASC`,
    );
  }

  async update(id: number, patch: MonthlyBudgetPatch): Promise<MonthlyBudget> {
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
        throw new NotFoundError('Monthly budget', id);
      }
      return current;
    }

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    const {rowsAffected} = await this.db.run(
      'UPDATE monthly_budgets SET ' + sets.join(', ') + ' WHERE id = ?',
      params,
    );
    if (rowsAffected === 0) {
      throw new NotFoundError('Monthly budget', id);
    }
    return this.requireById(id, 'after update');
  }

  /** @returns true when a row was deleted, false when the id did not exist. */
  async delete(id: number): Promise<boolean> {
    requirePositiveInt(id, 'id');
    const {rowsAffected} = await this.db.run(
      'DELETE FROM monthly_budgets WHERE id = ?',
      [id],
    );
    return rowsAffected > 0;
  }

  private async requireById(id: number, when: string): Promise<MonthlyBudget> {
    const budget = await this.getById(id);
    if (!budget) {
      throw new DatabaseError(
        `Monthly budget ${id} could not be read back ${when}`,
      );
    }
    return budget;
  }
}
