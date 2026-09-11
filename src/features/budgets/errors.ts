import {DatabaseError, ValidationError} from '@/database/errors';

/**
 * Translates database-layer errors into short, actionable, user-facing
 * messages. Technical details (SQL, stack traces) never reach the UI.
 */

const FIELD_MESSAGES: Record<string, string> = {
  amount: 'Enter a valid amount greater than 0.',
  categoryId: 'The selected category is no longer available.',
  month: 'The selected month is invalid.',
  year: 'The selected year is invalid.',
};

/** Message for a failed budget create/update. */
export function describeBudgetSaveError(error: unknown): string {
  if (error instanceof ValidationError) {
    return FIELD_MESSAGES[error.field] ?? 'Some fields need attention.';
  }
  if (error instanceof DatabaseError) {
    return 'Could not save the budget. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

/** Message for a failed budget delete. */
export function describeBudgetDeleteError(error: unknown): string {
  if (error instanceof DatabaseError) {
    return 'Could not delete the budget. Please try again.';
  }
  return 'Something went wrong while deleting. Please try again.';
}

/** Message for a failed snapshot/summary load. */
export function describeBudgetLoadError(): string {
  return 'Could not load your budgets. Please try again.';
}
