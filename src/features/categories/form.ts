import type {CategoryDraft, CategoryPatch} from '@/database/models';
import type {CategoryFormErrors, CategoryFormValues} from './types';

/**
 * Add/Edit category form state and validation.
 *
 * Mirrors the expense/income/budget forms: client-side validation runs first
 * and mirrors the database guards (CategoryRepository's NAME_MAX/ICON_MAX and
 * the UNIQUE (name, type) index) so the user gets friendly field errors
 * before anything touches SQLite. Duplicate-name checks that need database
 * state live in the feature service; this module is pure.
 */

/**
 * Reasonable maximum for on-screen category names. The repository allows up
 * to 100 characters; the form is stricter so names stay readable on small
 * Android screens.
 */
export const CATEGORY_NAME_MAX = 40;

export function initialCategoryFormValues(
  type: CategoryFormValues['type'],
): CategoryFormValues {
  return {
    name: '',
    icon: 'pricetag',
    type,
    isActive: true,
  };
}

/** Trims and validates the raw name; returns a message or null. */
export function validateCategoryName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) {
    return 'Enter a category name.';
  }
  if (name.length > CATEGORY_NAME_MAX) {
    return `Keep the name under ${CATEGORY_NAME_MAX} characters.`;
  }
  return null;
}

/** Validates the form; returns one message per invalid field. */
export function validateCategoryForm(
  values: CategoryFormValues,
): CategoryFormErrors {
  const errors: CategoryFormErrors = {};

  const nameError = validateCategoryName(values.name);
  if (nameError) {
    errors.name = nameError;
  }

  if (values.icon.trim().length === 0) {
    errors.icon = 'Pick an icon.';
  }

  return errors;
}

/** True when the errors object has no validation messages. */
export function isCategoryFormValid(errors: CategoryFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** True when two category names collide case-insensitively. */
export function isSameCategoryName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * True when `name` collides with another category of the same type.
 * `excludeId` keeps the row being edited out of the check (renaming a
 * category to its own name — in any casing — is a no-op, not a duplicate).
 * Pure so the exact matching rule is testable without a database.
 */
export function isDuplicateName(
  name: string,
  type: CategoryFormValues['type'],
  existing: readonly {id: number; name: string; type: string}[],
  excludeId?: number,
): boolean {
  return existing.some(
    category =>
      category.type === type &&
      category.id !== excludeId &&
      isSameCategoryName(category.name, name),
  );
}

/**
 * Converts validated values into a repository draft. Only call after
 * `validateCategoryForm` returned no errors.
 */
export function buildCategoryDraft(values: CategoryFormValues): CategoryDraft {
  const name = values.name.trim();
  const icon = values.icon.trim();
  if (name.length === 0 || icon.length === 0) {
    throw new Error(
      'Cannot build a category draft from an invalid form. Run validateCategoryForm first.',
    );
  }
  return {name, icon, type: values.type};
}

/**
 * Builds the minimal update patch (only changed fields) so unchanged rows
 * are never rewritten. Type is never patched — it is immutable by design.
 */
export function buildCategoryPatch(
  values: CategoryFormValues,
  original: CategoryFormValues,
): CategoryPatch {
  const patch: CategoryPatch = {};

  const name = values.name.trim();
  if (name !== original.name.trim()) {
    patch.name = name;
  }
  const icon = values.icon.trim();
  if (icon !== original.icon.trim()) {
    patch.icon = icon;
  }
  if (values.isActive !== original.isActive) {
    patch.isActive = values.isActive;
  }

  return patch;
}
