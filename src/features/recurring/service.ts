import type {
  Category,
  CategoryType,
  RecurringTransaction,
  RecurringTransactionDraft,
  RecurringTransactionPatch,
} from '@/database/models';
import type {DatabaseService} from '@/database/service';
import {firstOccurrenceAfter} from './date';
import {processDueRecurringTransactions} from './processing';
import type {RecurringProcessingResult, RecurringRuleItem} from './types';

/**
 * Feature-level service for recurring transaction rules.
 *
 * Same contract style as the other features: the ONLY layer screens talk
 * to, injectable `DatabaseService` for `node:sqlite` tests, business logic
 * outside React components. Rule persistence funnels through the
 * `RecurringTransactionRepository`; generated transactions are created by
 * the processing engine (`./processing`) as NORMAL rows in the regular
 * `expenses` / `income` tables.
 */
export interface RecurringFeature {
  /** Active categories for the form's pickers (spec §8). */
  listCategories(type: CategoryType): Promise<Category[]>;

  /** Single category by id (any active state) — edit-flow resolution. */
  getCategory(id: number): Promise<Category | null>;

  /** Rules of one type, joined with category, soonest occurrence first. */
  listRules(type: CategoryType): Promise<RecurringRuleItem[]>;

  /** Single rule, or null when the id does not exist. */
  getRule(id: number): Promise<RecurringTransaction | null>;

  /** Creates a rule from a validated draft. */
  addRule(draft: RecurringTransactionDraft): Promise<RecurringTransaction>;

  /** Updates a rule; never touches already-generated transactions. */
  editRule(
    id: number,
    patch: RecurringTransactionPatch,
  ): Promise<RecurringTransaction>;

  /**
   * Pauses a rule: stays stored, never generates, keeps its next
   * occurrence untouched.
   */
  pauseRule(id: number): Promise<RecurringTransaction>;

  /**
   * Resumes a paused rule. The next occurrence moves to the FIRST
   * occurrence strictly after today — missed occurrences while paused are
   * deliberately SKIPPED so resuming never dumps a backlog on the user
   * (spec §10).
   */
  resumeRule(id: number, now?: number): Promise<RecurringTransaction>;

  /**
   * Deletes ONLY the rule; generated transactions are untouched (the FK's
   * ON DELETE SET NULL clears their reference).
   */
  removeRule(id: number): Promise<boolean>;

  /** Processes due rules (see `./processing`); idempotent and atomic. */
  processDue(now?: number): Promise<RecurringProcessingResult>;
}

/** Fallback icon for income rules whose source has no matching category. */
const INCOME_FALLBACK_ICON = 'cash';

/**
 * Builds the list-screen items for one rule type. Expense rules are
 * flagged `needsAttention` when their category is missing or archived —
 * generation must not create invalid transactions (spec §8/§25), and the
 * list surfaces that state instead of silently skipping.
 */
async function buildRuleItems(
  db: DatabaseService,
  type: CategoryType,
): Promise<RecurringRuleItem[]> {
  const [rules, incomeCategories] = await Promise.all([
    db.recurring.listWithCategory({type}),
    // Income rules resolve their icon by matching source NAME against the
    // income categories (the same rule TransactionRow applies).
    type === 'income'
      ? db.categories.list('income')
      : Promise.resolve([] as Category[]),
  ]);

  const iconByName = new Map(
    incomeCategories.map(category => [category.name, category.icon]),
  );

  const items: RecurringRuleItem[] = [];
  for (const rule of rules) {
    if (rule.type !== 'expense') {
      items.push({
        ...rule,
        categoryIcon: iconByName.get(rule.title) ?? INCOME_FALLBACK_ICON,
        needsAttention: false,
      });
      continue;
    }

    // The LEFT JOIN resolves archived categories too; re-read the active
    // flag to decide whether generation is currently blocked.
    let needsAttention = true;
    if (rule.categoryId !== null) {
      const category = await db.categories.getById(rule.categoryId);
      needsAttention = !category?.isActive;
    }
    items.push({...rule, needsAttention});
  }
  return items;
}

async function requireRule(
  db: DatabaseService,
  id: number,
): Promise<RecurringTransaction> {
  const rule = await db.recurring.getById(id);
  if (!rule) {
    throw new Error(`Recurring rule ${id} does not exist`);
  }
  return rule;
}

export function createRecurringFeature(db: DatabaseService): RecurringFeature {
  return {
    listCategories(type: CategoryType) {
      return db.categories.list(type, {activeOnly: true});
    },

    getCategory(id: number) {
      return db.categories.getById(id);
    },

    listRules(type: CategoryType) {
      return buildRuleItems(db, type);
    },

    getRule(id: number) {
      return db.recurring.getById(id);
    },

    addRule(draft: RecurringTransactionDraft) {
      return db.recurring.create(draft);
    },

    editRule(id: number, patch: RecurringTransactionPatch) {
      return db.recurring.update(id, patch);
    },

    async pauseRule(id: number) {
      await db.recurring.setActive(id, false);
      return requireRule(db, id);
    },

    async resumeRule(id: number, now: number = Date.now()) {
      const rule = await db.recurring.getById(id);
      if (!rule) {
        throw new Error(`Recurring rule ${id} does not exist`);
      }
      if (!rule.isActive) {
        // Skip every occurrence up to and including today, then reactivate.
        const next = firstOccurrenceAfter(
          rule.nextOccurrenceAt,
          rule.frequency,
          now,
        );
        await db.recurring.update(id, {nextOccurrenceAt: next});
        await db.recurring.setActive(id, true);
      }
      return requireRule(db, id);
    },

    removeRule(id: number) {
      return db.recurring.delete(id);
    },

    processDue(now?: number) {
      return processDueRecurringTransactions(db, now);
    },
  };
}
