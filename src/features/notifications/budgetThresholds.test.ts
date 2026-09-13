/**
 * @jest-environment node
 */
import {evaluateBudgetSnapshot} from './budgetThresholds';
import type {BudgetMonthSnapshot} from '@/features/budgets/types';
import type {NotificationStateV1} from './types';

/** Minimal snapshot fixture — mirrors the budget feature's real shape. */
function snapshot(overrides: {
  overall?: {amount: number; spent: number} | null;
  categories?: {
    categoryId: number;
    categoryName: string;
    amount: number;
    spent: number;
  }[];
}): BudgetMonthSnapshot {
  const overall = overrides.overall;
  return {
    year: 2026,
    month: 9,
    spent:
      overrides.categories?.reduce((total, category) => total + category.spent, 0) ?? 0,
    overall:
      overall === undefined
        ? null
        : overall === null
          ? null
          : {
              id: 1,
              amount: overall.amount,
              spent: overall.spent,
              remaining: overall.amount - overall.spent,
              percent: Math.round((overall.spent / overall.amount) * 1000) / 10,
              state:
                overall.spent >= overall.amount
                  ? 'exceeded'
                  : overall.spent / overall.amount >= 0.8
                    ? 'warning'
                    : 'ok',
            },
    categories: (overrides.categories ?? []).map((category, index) => ({
      id: index + 100,
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      categoryIcon: 'tag',
      amount: category.amount,
      spent: category.spent,
      remaining: category.amount - category.spent,
      percent: Math.round((category.spent / category.amount) * 1000) / 10,
      state:
        category.spent >= category.amount
          ? 'exceeded'
          : category.spent / category.amount >= 0.8
            ? 'warning'
            : 'ok',
    })),
  };
}

const EMPTY_LATCH: NotificationStateV1 = {schemaVersion: 1, budgetNotifiedKeys: []};

describe('evaluateBudgetSnapshot', () => {
  it('reports nothing without budgets', () => {
    const result = evaluateBudgetSnapshot(
      snapshot({overall: null, categories: []}),
      '2026-09',
      EMPTY_LATCH,
    );
    expect(result.events).toEqual([]);
    expect(result.nextLatchKeys).toEqual([]);
  });

  it('stays silent below 80%', () => {
    const result = evaluateBudgetSnapshot(
      snapshot({overall: {amount: 100_000, spent: 79_000}}),
      '2026-09',
      EMPTY_LATCH,
    );
    expect(result.events).toEqual([]);
  });

  it('fires warning80 exactly at the 80% boundary', () => {
    const result = evaluateBudgetSnapshot(
      snapshot({
        categories: [{categoryId: 7, categoryName: 'Food', amount: 100_000, spent: 80_000}],
      }),
      '2026-09',
      EMPTY_LATCH,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].threshold).toBe('warning80');
    expect(result.events[0].eventKey).toBe('2026-09|category:7|warning80');
  });

  it('never repeats the same threshold for the same period (latch)', () => {
    const snap = snapshot({
      categories: [{categoryId: 7, categoryName: 'Food', amount: 100_000, spent: 85_000}],
    });
    const first = evaluateBudgetSnapshot(snap, '2026-09', EMPTY_LATCH);
    expect(first.events.map(event => event.threshold)).toEqual(['warning80']);

    const second = evaluateBudgetSnapshot(snap, '2026-09', {
      schemaVersion: 1,
      budgetNotifiedKeys: first.nextLatchKeys,
    });
    expect(second.events).toEqual([]);
  });

  it('announces only the MOST severe threshold on a big jump — and latches the lower ones', () => {
    const snap = snapshot({
      categories: [{categoryId: 7, categoryName: 'Food', amount: 100_000, spent: 95_000}],
    });
    const result = evaluateBudgetSnapshot(snap, '2026-09', EMPTY_LATCH);
    expect(result.events.map(event => event.threshold)).toEqual(['warning90']);
    expect(result.nextLatchKeys).toEqual([
      '2026-09|category:7|warning80',
      '2026-09|category:7|warning90',
    ]);

    // The latched 80% never fires later.
    const later = evaluateBudgetSnapshot(snap, '2026-09', {
      schemaVersion: 1,
      budgetNotifiedKeys: result.nextLatchKeys,
    });
    expect(later.events).toEqual([]);
  });

  it('fires exceeded at 100%+ including remaining going negative', () => {
    const result = evaluateBudgetSnapshot(
      snapshot({overall: {amount: 100_000, spent: 120_000}}),
      '2026-09',
      EMPTY_LATCH,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].scopeKey).toBe('overall');
    expect(result.events[0].threshold).toBe('exceeded');
    expect(result.events[0].remaining).toBe(-20_000);
  });

  it('keeps edits/deletes silent: once latched, a re-cross never re-notifies', () => {
    const latchKeys = ['2026-09|overall|warning80', '2026-09|overall|warning90'];
    // User deleted expenses — spend dropped to 82% (below the 90 latch).
    const dropped = evaluateBudgetSnapshot(
      snapshot({overall: {amount: 100_000, spent: 82_000}}),
      '2026-09',
      {schemaVersion: 1, budgetNotifiedKeys: latchKeys},
    );
    expect(dropped.events).toEqual([]);

    // Re-added expenses cross 90% again — STILL silent (same period).
    const recrossed = evaluateBudgetSnapshot(
      snapshot({overall: {amount: 100_000, spent: 93_000}}),
      '2026-09',
      {schemaVersion: 1, budgetNotifiedKeys: latchKeys},
    );
    expect(recrossed.events).toEqual([]);
  });

  it('resets naturally with a new budget period', () => {
    const snap = snapshot({overall: {amount: 100_000, spent: 85_000}});
    const september = evaluateBudgetSnapshot(snap, '2026-09', EMPTY_LATCH);
    expect(september.events).toHaveLength(1);

    // October: same 85% situation, fresh period → notify again.
    const october = evaluateBudgetSnapshot(snap, '2026-10', {
      schemaVersion: 1,
      budgetNotifiedKeys: september.nextLatchKeys,
    });
    expect(october.events).toHaveLength(1);
    expect(october.events[0].eventKey).toBe('2026-10|overall|warning80');
    // Old-period keys are pruned from the persisted set.
    expect(
      october.nextLatchKeys.every(key => key.startsWith('2026-10|')),
    ).toBe(true);
  });

  it('evaluates overall and every category independently', () => {
    const result = evaluateBudgetSnapshot(
      snapshot({
        overall: {amount: 200_000, spent: 190_000},
        categories: [
          {categoryId: 7, categoryName: 'Food', amount: 100_000, spent: 95_000},
          {categoryId: 8, categoryName: 'Transport', amount: 50_000, spent: 10_000},
        ],
      }),
      '2026-09',
      EMPTY_LATCH,
    );
    expect(result.events).toHaveLength(2);
    expect(result.events.map(event => event.scopeKey).sort()).toEqual([
      'category:7',
      'overall',
    ]);
  });

  it('skips zero-amount budgets defensively', () => {
    const result = evaluateBudgetSnapshot(
      snapshot({
        categories: [{categoryId: 9, categoryName: 'Zero', amount: 0, spent: 0}],
      }),
      '2026-09',
      EMPTY_LATCH,
    );
    expect(result.events).toEqual([]);
  });
});
