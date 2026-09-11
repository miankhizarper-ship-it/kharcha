import {DatabaseError, ValidationError} from '@/database/errors';

/**
 * Translates database-layer errors into short, actionable, user-facing
 * messages. Technical details (SQL, stack traces) never reach the UI.
 */

const FIELD_MESSAGES: Record<string, string> = {
  amount: 'Enter a valid amount greater than 0.',
  title: 'Check the title and try again.',
  categoryId: 'The selected category is no longer available.',
  date: 'The selected date is invalid.',
  paymentMethod: 'Choose a valid payment method.',
  note: 'The note is too long.',
};

/** Message for a failed create/update. */
export function describeSaveError(error: unknown): string {
  if (error instanceof ValidationError) {
    return FIELD_MESSAGES[error.field] ?? 'Some fields need attention.';
  }
  if (error instanceof DatabaseError) {
    return 'Could not save the expense. Please try again.';
  }
  if (error instanceof Error && error.message.length > 0) {
    return 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

/** Message for a failed delete. */
export function describeDeleteError(error: unknown): string {
  if (error instanceof DatabaseError) {
    return 'Could not delete the expense. Please try again.';
  }
  return 'Something went wrong while deleting. Please try again.';
}

/** Message for a failed list/dashboard load. */
export function describeLoadError(): string {
  return 'Could not load your data. Please try again.';
}
