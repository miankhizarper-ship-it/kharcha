import type {IncomeDraft, IncomePatch} from '@/database/models';
import {parseAmountToMinor} from '@/utils/money';

/**
 * Add/Edit income form state and validation.
 *
 * Mirrors the expense form (`features/expenses/form.ts`): validation runs
 * client-side first and mirrors the database guards (`repositories/validate.ts`
 * + the CHECK constraints of migration 001) so the user gets friendly,
 * field-level errors before anything touches SQLite.
 *
 * `source` is free text in the database (no FK); the UI fills it from the
 * database-backed income categories so records stay consistent with the
 * seeded presets while remaining flexible.
 */

/** Editable fields of the form, in their raw (on-screen) representation. */
export interface IncomeFormValues {
  /** Raw amount text, e.g. "30000". */
  amount: string;
  /** The income source, e.g. "Salary". */
  source: string;
  /** Epoch millis. */
  date: number;
  note: string;
}

/** Field-keyed validation messages; an empty object means the form is valid. */
export type IncomeFormErrors = Partial<Record<'amount' | 'source', string>>;

export function initialIncomeFormValues(now: number): IncomeFormValues {
  return {
    amount: '',
    source: '',
    date: now,
    note: '',
  };
}

/** Validates the form; returns one message per invalid field. */
export function validateIncomeForm(values: IncomeFormValues): IncomeFormErrors {
  const errors: IncomeFormErrors = {};

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

  if (values.source.trim().length === 0) {
    errors.source = 'Select a source.';
  }

  return errors;
}

/** True when the values object has no validation errors. */
export function isIncomeFormValid(errors: IncomeFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Converts validated form values into a repository draft/patch.
 * Only call this after `validateIncomeForm` returned no errors.
 */
export function buildIncomeDraft(
  values: IncomeFormValues,
): IncomeDraft & IncomePatch {
  const amount = parseAmountToMinor(values.amount.trim());
  if (amount === null || amount <= 0 || values.source.trim().length === 0) {
    throw new Error(
      'Cannot build an income draft from an invalid form. Run validateIncomeForm first.',
    );
  }

  const note = values.note.trim();
  return {
    amount,
    source: values.source.trim(),
    date: values.date,
    note: note.length > 0 ? note : null,
  };
}
