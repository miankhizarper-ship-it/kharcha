import type {DatabaseDriver} from '../driver';
import {ValidationError} from '../errors';
import type {CategoryType} from '../models';

/**
 * Shared FK-style guard for relationships SQLite itself cannot enforce:
 * `expenses.category_id` and `budgets.category_id` must point at a category
 * of the matching `type` (an expense must never reference an income
 * category). Existence is also checked for a readable error, even though the
 * FK constraint would catch it.
 */
export async function assertCategoryOfType(
  db: DatabaseDriver,
  categoryId: number,
  expected: CategoryType,
): Promise<void> {
  const rows = await db.query<{type: string}>(
    'SELECT type FROM categories WHERE id = ?',
    [categoryId],
  );
  const row = rows[0];
  if (!row) {
    throw new ValidationError(
      'categoryId',
      `Category ${categoryId} does not exist`,
    );
  }
  if (row.type !== expected) {
    throw new ValidationError(
      'categoryId',
      `Category ${categoryId} is not an ${expected} category`,
    );
  }
}
