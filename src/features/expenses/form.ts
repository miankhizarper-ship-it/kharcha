import type {
  ExpenseDraft,
  ExpensePatch,
  PaymentMethod,
} from '@/database/models';
import {parseAmountToMinor} from '@/utils/money';

/**
 * Add/Edit expense form state and validation.
 *
 * Validation mirrors the database guards (`repositories/validate.ts` +
 * CHECK constraints in migration 001) but runs client-side first so the user
 * gets friendly, field-level errors before anything touches SQLite.
 */

/** Editable fields of the form, in their raw (on-screen) representation. */
export interface ExpenseFormValues {
  /** Raw amount text, e.g. "12.50". */
  amount: string;
  title: string;
  /** `null` until the user picks one. */
  categoryId: number | null;
  /** Epoch millis. */
  date: number;
  paymentMethod: PaymentMethod;
  note: string;
}

/** Field-keyed validation messages; an empty object means the form is valid. */
export type ExpenseFormErrors = Partial<
  Record<'amount' | 'title' | 'categoryId', string>
>;

export function initialExpenseFormValues(now: number): ExpenseFormValues {
  return {
    amount: '',
    title: '',
    categoryId: null,
    date: now,
    paymentMethod: 'cash',
    note: '',
  };
}

/** Validates the form; returns one message per invalid field. */
export function validateExpenseForm(
  values: ExpenseFormValues,
): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {};

  const amountText = values.amount.trim();
  if (amountText.length === 0) {
    errors.amount = 'Amount is required.';
  } else {
    const minor = parseAmountToMinor(amountText);
    if (minor === null) {
      errors.amount = 'Enter a valid amount, e.g. 250 or 12.50.';
    } else if (minor <= 0) {
      errors.amount = 'Amount must be greater than 0.';
    }
  }

  if (values.title.trim().length === 0) {
    errors.title = 'Title is required.';
  }

  if (values.categoryId === null) {
    errors.categoryId = 'Select a category.';
  }

  return errors;
}

/** True when the values object has no validation errors. */
export function isExpenseFormValid(errors: ExpenseFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Converts validated form values into a repository draft/patch.
 * Only call this after `validateExpenseForm` returned no errors.
 */
export function buildExpenseDraft(
  values: ExpenseFormValues,
): ExpenseDraft & ExpensePatch {
  const amount = parseAmountToMinor(values.amount.trim());
  const categoryId = values.categoryId;
  if (amount === null || amount <= 0 || categoryId === null) {
    throw new Error(
      'Cannot build an expense draft from an invalid form. Run validateExpenseForm first.',
    );
  }

  const note = values.note.trim();
  return {
    amount,
    title: values.title.trim(),
    categoryId,
    date: values.date,
    paymentMethod: values.paymentMethod,
    note: note.length > 0 ? note : null,
  };
}
