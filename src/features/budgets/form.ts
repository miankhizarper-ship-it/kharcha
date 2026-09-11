import type {BudgetDraft, MonthlyBudgetDraft} from '@/database/models';
import {
  MONTH_MAX,
  MONTH_MIN,
  YEAR_MAX,
  YEAR_MIN,
} from '@/database/repositories/budgets';
import {parseAmountToMinor} from '@/utils/money';
import {formatMinorAsDecimal} from '@/utils/format';

/**
 * Budget form state and validation (shared by the overall-budget form and
 * the category-budget form).
 *
 * Validation mirrors the database guards (`repositories/budgets.ts`,
 * `repositories/monthlyBudgets.ts` + the CHECK/UNIQUE constraints from
 * migrations 001/002) but runs client-side first so the user gets friendly,
 * field-level errors before anything touches SQLite.
 */

/** Which budget the form is editing. Drives whether a category is required. */
export type BudgetFormMode = 'overall' | 'category';

/** Editable fields of the budget form, in their raw (on-screen) form. */
export interface BudgetFormValues {
  /** Raw amount text, e.g. "30000" or "1250.50". */
  amount: string;
  /** Selected expense category; required in `category` mode. */
  categoryId: number | null;
}

/** Field-keyed validation messages; an empty object means the form is valid. */
export type BudgetFormErrors = Partial<Record<'amount' | 'categoryId', string>>;

/** Extra facts the validator needs that the raw values cannot express. */
export interface BudgetFormContext {
  mode: BudgetFormMode;
  /**
   * Category ids that already have a budget for the target month. Used to
   * block duplicate category budgets. When EDITING a row, pass the list
   * WITHOUT that row's own category so keeping the category is allowed.
   */
  budgetedCategoryIds?: readonly number[];
}

export function initialBudgetFormValues(): BudgetFormValues {
  return {amount: '', categoryId: null};
}

/**
 * Validates the period itself. Months come from the month navigator, not
 * free input, but the guard keeps invalid state from reaching SQLite.
 */
export function validateBudgetPeriod(
  month: number,
  year: number,
): string | null {
  if (!Number.isInteger(month) || month < MONTH_MIN || month > MONTH_MAX) {
    return 'The selected month is invalid.';
  }
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    return 'The selected year is invalid.';
  }
  return null;
}

/** Validates the form; returns one message per invalid field. */
export function validateBudgetForm(
  values: BudgetFormValues,
  context: BudgetFormContext,
): BudgetFormErrors {
  const errors: BudgetFormErrors = {};

  const amountText = values.amount.trim();
  if (amountText.length === 0) {
    errors.amount = 'Amount is required.';
  } else {
    const minor = parseAmountToMinor(amountText);
    if (minor === null) {
      errors.amount = 'Enter a valid amount, e.g. 30000 or 1250.50.';
    } else if (minor <= 0) {
      errors.amount = 'Amount must be greater than 0.';
    }
  }

  if (context.mode === 'category') {
    if (values.categoryId === null) {
      errors.categoryId = 'Select a category.';
    } else if (
      context.budgetedCategoryIds?.includes(values.categoryId) === true
    ) {
      errors.categoryId =
        'This category already has a budget for this month. Edit it instead.';
    }
  }

  return errors;
}

/** True when the errors object has no entries. */
export function isBudgetFormValid(errors: BudgetFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Builds the repository draft for a category budget. Only call after
 * `validateBudgetForm` returned no errors and the period validated.
 */
export function buildCategoryBudgetDraft(
  values: BudgetFormValues,
  month: number,
  year: number,
): BudgetDraft {
  const amount = parseAmountToMinor(values.amount.trim());
  const categoryId = values.categoryId;
  if (amount === null || amount <= 0 || categoryId === null) {
    throw new Error(
      'Cannot build a category budget draft from an invalid form. Run validateBudgetForm first.',
    );
  }
  return {categoryId, amount, month, year};
}

/**
 * Builds the repository draft for the overall monthly budget. Only call
 * after `validateBudgetForm` returned no errors and the period validated.
 */
export function buildOverallBudgetDraft(
  values: BudgetFormValues,
  month: number,
  year: number,
): MonthlyBudgetDraft {
  const amount = parseAmountToMinor(values.amount.trim());
  if (amount === null || amount <= 0) {
    throw new Error(
      'Cannot build a monthly budget draft from an invalid form. Run validateBudgetForm first.',
    );
  }
  return {amount, month, year};
}

/** Converts a stored minor-unit amount to editable text ("3000000" -> "30000.00"). */
export function minorToAmountText(minor: number): string {
  return formatMinorAsDecimal(minor);
}
