import {DatabaseError, ValidationError} from '@/database/errors';

/**
 * Translates database-layer errors into short, actionable, user-facing
 * messages. Technical details (SQL, constraint names, stack traces) never
 * reach the UI — same contract as the expense/income error modules.
 */

const FIELD_MESSAGES: Record<string, string> = {
  amount: 'Enter a valid amount greater than 0.',
  title: 'Check the title and try again.',
  categoryId: 'The selected category is no longer available.',
  frequency: 'Choose a valid recurrence.',
  nextOccurrenceAt: 'The selected date is invalid.',
  startDate: 'The selected date is invalid.',
  endDate: 'The end date cannot be before the start date.',
  paymentMethod: 'Choose a valid payment method.',
  note: 'The note is too long.',
};

/** Message for a failed create/update. */
export function describeSaveError(error: unknown): string {
  if (error instanceof ValidationError) {
    return FIELD_MESSAGES[error.field] ?? 'Some fields need attention.';
  }
  if (error instanceof DatabaseError) {
    return 'Could not save the recurring transaction. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

/** Message for a failed delete. */
export function describeDeleteError(error: unknown): string {
  if (error instanceof DatabaseError) {
    return 'Could not delete the recurring transaction. Please try again.';
  }
  return 'Something went wrong while deleting. Please try again.';
}

/** Message for a failed list load. */
export function describeLoadError(): string {
  return 'Could not load your recurring transactions. Please try again.';
}

/** Message for a failed generation run (list screen + app bootstrap). */
export function describeProcessingError(error: unknown): string {
  if (error instanceof DatabaseError) {
    return 'Could not process due recurring transactions. Your data is unchanged — please try again.';
  }
  return 'Something went wrong while processing recurring transactions. Please try again.';
}
