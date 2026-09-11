import type {CategoryType} from '@/database/models';

/** Form values for the add/edit category sheet, in raw (on-screen) form. */
export interface CategoryFormValues {
  name: string;
  icon: string;
  /** Rendered as a read-only field — a category's type never changes. */
  type: CategoryType;
  /** true = offered in new-transaction pickers; false = archived. */
  isActive: boolean;
}

/** Field-keyed validation messages; an empty object means the form is valid. */
export type CategoryFormErrors = Partial<Record<'name' | 'icon', string>>;

/**
 * What currently references a category. Expenses block deletion outright
 * (FK RESTRICT); budgets would be CASCADE-deleted by SQLite, so they block
 * too — history is never destroyed silently.
 */
export interface CategoryUsage {
  expenseCount: number;
  budgetCount: number;
}

/** Result of a delete attempt through the categories feature service. */
export type CategoryDeleteResult =
  {deleted: true} | {deleted: false; blocker: 'expenses' | 'budgets'};
