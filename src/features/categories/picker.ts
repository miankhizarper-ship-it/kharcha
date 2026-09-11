import type {Category} from '@/database/models';

/**
 * Edit-flow helper for transaction forms.
 *
 * Forms list ACTIVE categories only (spec §7). When editing a historical
 * record whose category has since been archived, the current category is
 * appended to the picker list so the record still displays correctly and
 * can be saved without forcing a re-categorization — historical data is
 * never altered, and the archived chip renders muted (see
 * CategoryChipPicker's `inactiveIds`).
 *
 * Pure so the merge rule is testable without a database.
 */
export function appendMissingCategory(
  active: readonly Category[],
  current: Category | null | undefined,
): Category[] {
  if (!current) {
    return [...active];
  }
  const exists = active.some(category => category.id === current.id);
  return exists ? [...active] : [...active, current];
}
