import type {DatabaseService} from '@/database/service';
import type {Category, CategoryType} from '@/database/models';
import {NotFoundError} from '@/database/errors';
import {buildCategoryDraft, buildCategoryPatch, isDuplicateName} from './form';
import {
  DuplicateCategoryError,
  MissingCategoryError,
  describeCategorySaveError,
} from './errors';
import type {
  CategoryDeleteResult,
  CategoryFormValues,
  CategoryUsage,
} from './types';

/**
 * Feature-level service for category management.
 *
 * Same contract style as the other features (`features/expenses/service.ts`
 * etc.): the ONLY layer category screens talk to, funneled through the
 * repositories (`DatabaseService`), and injectable for `node:sqlite` tests.
 * SQLite stays the single source of truth — no category dataset is cached in
 * Zustand.
 *
 * Deletion policy (data safety): a category referenced by expenses is
 * protected by the FK RESTRICT of migration 001 and is reported as blocked
 * before SQLite even rejects. A category referenced only by category
 * budgets is ALSO reported as blocked — SQLite would CASCADE-delete those
 * budgets silently, and this app never destroys budgeting history without
 * an explicit user decision. Use the isActive flag to archive instead.
 */
export interface CategoriesFeature {
  /** Every category of a type (active + archived) for management screens. */
  listCategories(type?: CategoryType): Promise<Category[]>;

  /** Active categories only — what new-transaction pickers offer. */
  listActiveCategories(type: CategoryType): Promise<Category[]>;

  /** Single category, or null when the id does not exist. */
  getCategory(id: number): Promise<Category | null>;

  /**
   * Case-insensitive lookup by name within a type — used to re-resolve the
   * source/category of historical records during edits.
   */
  findCategoryByName(
    name: string,
    type: CategoryType,
  ): Promise<Category | null>;

  /** What references a category (expenses / budgets) across all time. */
  getUsage(id: number): Promise<CategoryUsage>;

  /** Creates a category; rejects with a friendly message on duplicates. */
  addCategory(values: CategoryFormValues): Promise<Category>;

  /** Updates name/icon/active state (never type) from validated form values. */
  editCategory(
    id: number,
    values: CategoryFormValues,
    original: CategoryFormValues,
  ): Promise<Category>;

  /**
   * Deletes a category ONLY when nothing references it. Otherwise resolves
   * with the blocker instead of deleting — callers explain and offer the
   * archive (isActive=false) path.
   */
  deleteCategory(id: number): Promise<CategoryDeleteResult>;
}

export function createCategoriesFeature(
  db: DatabaseService,
): CategoriesFeature {
  return {
    listCategories(type?: CategoryType) {
      return db.categories.list(type);
    },

    listActiveCategories(type: CategoryType) {
      return db.categories.list(type, {activeOnly: true});
    },

    getCategory(id: number) {
      return db.categories.getById(id);
    },

    async findCategoryByName(name: string, type: CategoryType) {
      // Exact match first (cheap, covers the common chip-picked case).
      const exact = await db.categories.findByName(name, type);
      if (exact) {
        return exact;
      }
      // Fall back to a case-insensitive scan for hand-entered history.
      const lowered = name.trim().toLowerCase();
      const all = await db.categories.list(type);
      return (
        all.find(category => category.name.toLowerCase() === lowered) ?? null
      );
    },

    async getUsage(id: number): Promise<CategoryUsage> {
      const [expenseCount, budgetCount] = await Promise.all([
        db.expenses.count({categoryId: id}),
        db.budgets.countByCategory(id),
      ]);
      return {expenseCount, budgetCount};
    },

    async addCategory(values: CategoryFormValues) {
      const existing = await db.categories.list(values.type);
      if (isDuplicateName(values.name, values.type, existing)) {
        throw new DuplicateCategoryError();
      }
      try {
        return await db.categories.create(buildCategoryDraft(values));
      } catch (error) {
        // Race-safe backstop: the UNIQUE (name, type) index.
        throw new Error(describeCategorySaveError(error), {cause: error});
      }
    },

    async editCategory(
      id: number,
      values: CategoryFormValues,
      original: CategoryFormValues,
    ) {
      const patch = buildCategoryPatch(values, original);
      if (patch.name !== undefined) {
        const existing = await db.categories.list(values.type);
        if (isDuplicateName(patch.name, values.type, existing, id)) {
          throw new DuplicateCategoryError();
        }
      }
      if (Object.keys(patch).length === 0) {
        const current = await db.categories.getById(id);
        if (!current) {
          throw new MissingCategoryError();
        }
        return current;
      }
      try {
        return await db.categories.update(id, patch);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new MissingCategoryError();
        }
        throw new Error(describeCategorySaveError(error), {cause: error});
      }
    },

    async deleteCategory(id: number): Promise<CategoryDeleteResult> {
      const usage = await this.getUsage(id);
      if (usage.expenseCount > 0) {
        return {deleted: false, blocker: 'expenses'};
      }
      if (usage.budgetCount > 0) {
        return {deleted: false, blocker: 'budgets'};
      }
      // Idempotent: deleting an already-missing row still leaves the app in
      // the state the user asked for (no such category).
      await db.categories.delete(id);
      return {deleted: true};
    },
  };
}
