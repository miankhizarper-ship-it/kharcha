import {DatabaseError} from '@/database/errors';

/**
 * Feature-level errors for category management. The form sheet catches
 * these to put the message on the right field; everything else falls back
 * to the generic describers. Raw SQL and engine details never reach the
 * screen (data-safety rule §17).
 */

/** Name collides with another category of the same type (case-insensitive). */
export class DuplicateCategoryError extends Error {
  constructor() {
    super('A category with this name already exists.');
    this.name = 'DuplicateCategoryError';
  }
}

/** The category being edited/deleted no longer exists. */
export class MissingCategoryError extends Error {
  constructor() {
    super('This category no longer exists.');
    this.name = 'MissingCategoryError';
  }
}

/** Save (create/update) failures — includes the UNIQUE (name, type) backstop. */
export function describeCategorySaveError(error: unknown): string {
  if (error instanceof DuplicateCategoryError) {
    return error.message;
  }
  if (error instanceof DatabaseError) {
    const message = error.message.toLowerCase();
    if (
      message.includes('unique') ||
      message.includes('idx_categories_name_type')
    ) {
      return 'A category with this name already exists.';
    }
    return 'Could not save the category. Please try again.';
  }
  return 'Could not save the category. Please try again.';
}

/** Delete failures — FK RESTRICT and engine errors. */
export function describeCategoryDeleteError(_error: unknown): string {
  return 'Could not delete the category. Please try again.';
}

/** Load failures for the management screen. */
export function describeCategoryLoadError(_error: unknown): string {
  return 'Could not load categories. Please try again.';
}
