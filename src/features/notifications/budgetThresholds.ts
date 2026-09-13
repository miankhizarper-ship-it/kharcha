import type {BudgetMonthSnapshot} from '@/features/budgets/types';

import type {
  BudgetThreshold,
  BudgetThresholdEvent,
  NotificationStateV1,
} from './types';

/**
 * Pure budget-threshold detection (spec §3).
 *
 * Input is the budget feature's OWN month snapshot — the exact numbers the
 * Budget screen shows, computed live from the `expenses` table. No financial
 * math is duplicated here: this module only compares the snapshot against
 * the 80% / 90% / 100% thresholds and the delivered-notification latch.
 *
 * Rules:
 * - A threshold "crosses" when spent / amount reaches it (>= 0.8, >= 0.9, >= 1).
 * - At most ONE notification per scope per evaluation — the MOST SEVERE
 *   newly-crossed threshold (jumping 70% → 95% announces the 90% message;
 *   a lower threshold never fires afterwards).
 * - Every crossed threshold is LATCHED for the (period, scope) so later
 *   evaluations, app restarts and re-crossings after edits/deletions stay
 *   silent — "never the same threshold twice in one budget period" (spec).
 * - A new period key (new month) makes all keys fresh by construction, so
 *   the latch resets without any explicit clearing step.
 */

/** Crossing points in spending order; `exceeded` also implies both below. */
const THRESHOLD_ORDER: {threshold: BudgetThreshold; ratio: number}[] = [
  {threshold: 'warning80', ratio: 0.8},
  {threshold: 'warning90', ratio: 0.9},
  {threshold: 'exceeded', ratio: 1},
];

/** `${periodKey}|${scopeKey}|${threshold}` — stable dedupe identity. */
export function budgetEventKey(
  periodKey: string,
  scopeKey: string,
  threshold: BudgetThreshold,
): string {
  return `${periodKey}|${scopeKey}|${threshold}`;
}

interface ScopeInput {
  scopeKey: string;
  budgetName: string;
  /** Minor units; <= 0 budgets are skipped (no meaningful ratio). */
  amount: number;
  spent: number;
}

function crossedThresholdsFor(
  scope: ScopeInput,
): BudgetThreshold[] {
  if (scope.amount <= 0) {
    return [];
  }
  const ratio = scope.spent / scope.amount;
  return THRESHOLD_ORDER.filter(step => ratio >= step.ratio).map(
    step => step.threshold,
  );
}

export interface BudgetEvaluationResult {
  /** At most one event per scope — the most severe new crossing. */
  events: BudgetThresholdEvent[];
  /**
   * The complete latch set to persist: previously-notified keys (filtered
   * to the current period) UNION every key crossed in this evaluation.
   */
  nextLatchKeys: string[];
}

/**
 * Compares this month's snapshot against the latch and returns what the
 * user should be notified about now.
 */
export function evaluateBudgetSnapshot(
  snapshot: BudgetMonthSnapshot,
  periodKey: string,
  latch: NotificationStateV1,
): BudgetEvaluationResult {
  const previouslyNotified = new Set(latch.budgetNotifiedKeys);

  const scopes: ScopeInput[] = [
    ...(snapshot.overall
      ? [
          {
            scopeKey: 'overall',
            budgetName: 'Monthly',
            amount: snapshot.overall.amount,
            spent: snapshot.overall.spent,
          },
        ]
      : []),
    ...snapshot.categories.map(category => ({
      scopeKey: `category:${category.categoryId}`,
      budgetName: category.categoryName,
      amount: category.amount,
      spent: category.spent,
    })),
  ];

  const events: BudgetThresholdEvent[] = [];
  const crossedNow = new Set<string>();

  for (const scope of scopes) {
    const crossed = crossedThresholdsFor(scope);
    if (crossed.length === 0) {
      continue;
    }

    // Latch EVERY crossed threshold; announce only the most severe one
    // that has not been announced for this period+scope yet.
    for (const threshold of crossed) {
      crossedNow.add(budgetEventKey(periodKey, scope.scopeKey, threshold));
    }

    const newest = [...crossed]
      .reverse()
      .find(
        threshold =>
          !previouslyNotified.has(
            budgetEventKey(periodKey, scope.scopeKey, threshold),
          ),
      );

    if (newest === undefined) {
      continue;
    }

    const remaining = scope.amount - scope.spent;
    events.push({
      eventKey: budgetEventKey(periodKey, scope.scopeKey, newest),
      scopeKey: scope.scopeKey,
      budgetName: scope.budgetName,
      threshold: newest,
      spent: scope.spent,
      remaining,
    });
  }

  return {
    events,
    nextLatchKeys: Array.from(
      new Set([...previouslyNotified, ...crossedNow]),
    ).filter(key => key.startsWith(`${periodKey}|`)),
  };
}
