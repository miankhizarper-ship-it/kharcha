import type {
  RecurringFrequency,
  RecurringWithCategory,
} from '@/database/models';

/**
 * UI-facing view models for the recurring feature.
 *
 * Recurring RULES are separate database records (migration 004); the rows
 * they generate are NORMAL transactions in `expenses` / `income`. These
 * types describe the rules themselves plus their display state.
 */

/** Human labels for the stored frequency enum, in display order. */
export const FREQUENCY_OPTIONS: {value: RecurringFrequency; label: string}[] = [
  {value: 'daily', label: 'Daily'},
  {value: 'weekly', label: 'Weekly'},
  {value: 'monthly', label: 'Monthly'},
];

export function frequencyLabel(frequency: RecurringFrequency): string {
  return (
    FREQUENCY_OPTIONS.find(option => option.value === frequency)?.label ??
    frequency
  );
}

/**
 * One rule in the list screen, joined with its category and enriched with
 * the generation-blocked state: an expense rule whose category has been
 * archived (or is missing) must not silently generate invalid transactions
 * (spec §8/§25) — the list surfaces it as "Needs attention" instead.
 */
export interface RecurringRuleItem extends RecurringWithCategory {
  /** Expense rule whose category is missing or inactive. */
  needsAttention: boolean;
}

/** Summary returned by one processing run (also used for tests). */
export interface RecurringProcessingResult {
  /** Normal expense rows created. */
  generatedExpenses: number;
  /** Normal income rows created. */
  generatedIncome: number;
  /** Rules deactivated because their end date passed. */
  completedRules: number;
  /** Rules skipped because their category is missing or archived. */
  blockedRuleIds: number[];
}
