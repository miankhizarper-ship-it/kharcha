import type {DatabaseService} from '@/database/service';
import type {
  Category,
  CategoryType,
  Income,
  IncomeDraft,
  IncomePatch,
} from '@/database/models';

/**
 * Feature-level service for the income vertical slice.
 *
 * Same contract style as the expense feature (`features/expenses/service.ts`):
 * it is the ONLY layer income screens talk to, it funnels everything through
 * the repositories (`DatabaseService`), and the injected service makes the
 * whole feature testable on the `node:sqlite` driver. SQLite stays the
 * single source of truth — no income dataset is cached in Zustand.
 */
export interface IncomeFeature {
  /**
   * Categories for the source picker (`type` defaults to 'income'). ACTIVE
   * only — archived categories must not be offered for new records. Edit
   * flows re-resolve a record's legacy source via `findCategoryByName` and
   * append it with `appendMissingCategory` so history stays editable.
   */
  listCategories(type?: CategoryType): Promise<Category[]>;

  /**
   * Case-insensitive category lookup by name (any active state) — used to
   * re-resolve the source of a historical income during edits.
   */
  findCategoryByName(name: string): Promise<Category | null>;

  /** Single income record, or null when the id does not exist. */
  getIncome(id: number): Promise<Income | null>;

  /** Creates an income record from a validated draft. */
  addIncome(draft: IncomeDraft): Promise<Income>;

  /** Updates an income; the repository preserves `createdAt`. */
  editIncome(id: number, patch: IncomePatch): Promise<Income>;

  /** Deletes an income; resolves false when the id did not exist. */
  removeIncome(id: number): Promise<boolean>;
}

export function createIncomeFeature(db: DatabaseService): IncomeFeature {
  return {
    listCategories(type: CategoryType = 'income') {
      return db.categories.list(type, {activeOnly: true});
    },

    async findCategoryByName(name: string) {
      const exact = await db.categories.findByName(name, 'income');
      if (exact) {
        return exact;
      }
      const lowered = name.trim().toLowerCase();
      const all = await db.categories.list('income');
      return (
        all.find(category => category.name.toLowerCase() === lowered) ?? null
      );
    },

    getIncome(id: number) {
      return db.income.getById(id);
    },

    addIncome(draft: IncomeDraft) {
      return db.income.create(draft);
    },

    editIncome(id: number, patch: IncomePatch) {
      return db.income.update(id, patch);
    },

    removeIncome(id: number) {
      return db.income.delete(id);
    },
  };
}
