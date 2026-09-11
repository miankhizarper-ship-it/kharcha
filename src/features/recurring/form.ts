import type {
  CategoryType,
  PaymentMethod,
  RecurringFrequency,
  RecurringTransactionDraft,
  RecurringTransactionPatch,
} from '@/database/models';
import {parseAmountToMinor} from '@/utils/money';

/**
 * Add/Edit recurring-rule form state and validation.
 *
 * ONE reusable form covers both expense and income rules (spec §7): the
 * type only decides which fields are shown and how the title field is
 * labelled ("Title" for expenses, "Source" for income — income rules store
 * the source in `title` and copy it into every generated income row).
 *
 * Validation mirrors the database guards (`repositories/validate.ts` +
 * migration 004's CHECK constraints) and reuses the existing money helpers,
 * so the user gets friendly, field-level errors before anything touches
 * SQLite.
 */

/** Which mode the form is in — the end-date rule differs slightly. */
export type RecurringFormMode = 'create' | 'edit';

/** Editable fields of the form, in their raw (on-screen) representation. */
export interface RecurringFormValues {
  /** Raw amount text, e.g. "12000". */
  amount: string;
  /** Expense title, or income source. */
  title: string;
  /** `null` until the user picks one (expense rules only). */
  categoryId: number | null;
  /** First occurrence (epoch millis). Create mode only. */
  startDate: number;
  /** Next due occurrence (epoch millis). Edit mode only. */
  nextOccurrenceAt: number;
  frequency: RecurringFrequency;
  /** Whether the rule has an end date at all. */
  hasEndDate: boolean;
  /** Raw end date (epoch millis); meaningful only when `hasEndDate`. */
  endDate: number;
  /** Expense rules only. */
  paymentMethod: PaymentMethod;
  note: string;
}

/** Field-keyed validation messages; an empty object means the form is valid. */
export type RecurringFormErrors = Partial<
  Record<
    'amount' | 'title' | 'categoryId' | 'nextOccurrenceAt' | 'endDate',
    string
  >
>;

export function initialRecurringFormValues(
  now: number,
  type: CategoryType,
): RecurringFormValues {
  return {
    amount: '',
    title: '',
    categoryId: null,
    startDate: now,
    nextOccurrenceAt: now,
    frequency: 'monthly',
    hasEndDate: false,
    endDate: now,
    paymentMethod: type === 'expense' ? 'cash' : 'other',
    note: '',
  };
}

/**
 * Validates the form; returns one message per invalid field.
 *
 * End-date rule: the end date must be on or after the NEXT occurrence —
 * an end date in the past would deactivate the rule without ever
 * generating, which is almost certainly a user mistake.
 */
export function validateRecurringForm(
  values: RecurringFormValues,
  type: CategoryType,
): RecurringFormErrors {
  const errors: RecurringFormErrors = {};

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
    errors.title =
      type === 'expense' ? 'Title is required.' : 'Source is required.';
  }

  if (type === 'expense' && values.categoryId === null) {
    errors.categoryId = 'Select a category.';
  }

  if (
    values.nextOccurrenceAt < values.startDate &&
    values.nextOccurrenceAt !== values.startDate
  ) {
    // Only reachable when a caller hands us inconsistent state; the UI
    // derives the next occurrence from the start date in create mode.
    errors.nextOccurrenceAt =
      'The next occurrence cannot be before the start date.';
  }

  if (values.hasEndDate) {
    if (values.endDate < values.nextOccurrenceAt) {
      errors.endDate = 'The end date must be on or after the next occurrence.';
    }
  }

  return errors;
}

/** True when the values object has no validation errors. */
export function isRecurringFormValid(errors: RecurringFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Converts validated CREATE-mode values into a repository draft.
 * Only call this after `validateRecurringForm` returned no errors.
 *
 * A rule becomes due on its first occurrence: `nextOccurrenceAt` starts
 * equal to `startDate`. A start date in the past means the generation
 * engine backfills all occurrences up to today on the first run — the same
 * documented policy as missed occurrences (spec §13).
 */
export function buildRecurringDraft(
  values: RecurringFormValues,
  type: CategoryType,
): RecurringTransactionDraft {
  const amount = parseAmountToMinor(values.amount.trim());
  if (amount === null || amount <= 0) {
    throw new Error(
      'Cannot build a recurring draft from an invalid form. Run validateRecurringForm first.',
    );
  }
  if (type === 'expense' && values.categoryId === null) {
    throw new Error(
      'Cannot build an expense rule without a category. Run validateRecurringForm first.',
    );
  }

  const note = values.note.trim();
  return {
    type,
    amount,
    title: values.title.trim(),
    categoryId: type === 'expense' ? values.categoryId : null,
    frequency: values.frequency,
    startDate: values.startDate,
    nextOccurrenceAt: values.startDate,
    endDate: values.hasEndDate ? values.endDate : null,
    paymentMethod: type === 'expense' ? values.paymentMethod : null,
    note: note.length > 0 ? note : null,
  };
}

/**
 * Converts validated EDIT-mode values into a repository patch. The start
 * date is intentionally absent — it is an informational anchor (see
 * `RecurringTransactionPatch`); the schedule continues from the editable
 * next occurrence.
 */
export function buildRecurringPatch(
  values: RecurringFormValues,
  type: CategoryType,
): RecurringTransactionPatch {
  const amount = parseAmountToMinor(values.amount.trim());
  if (amount === null || amount <= 0) {
    throw new Error(
      'Cannot build a recurring patch from an invalid form. Run validateRecurringForm first.',
    );
  }
  if (type === 'expense' && values.categoryId === null) {
    throw new Error(
      'Cannot build an expense patch without a category. Run validateRecurringForm first.',
    );
  }

  const note = values.note.trim();
  return {
    amount,
    title: values.title.trim(),
    categoryId: type === 'expense' ? values.categoryId! : undefined,
    frequency: values.frequency,
    nextOccurrenceAt: values.nextOccurrenceAt,
    endDate: values.hasEndDate ? values.endDate : null,
    paymentMethod: type === 'expense' ? values.paymentMethod : undefined,
    note: note.length > 0 ? note : null,
  };
}
