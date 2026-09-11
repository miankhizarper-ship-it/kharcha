/**
 * @jest-environment node
 */
import {
  budgetStateLabel,
  computeBudgetProgress,
  formatBudgetPercent,
} from './progress';
import {BUDGET_WARNING_RATIO} from './types';

describe('computeBudgetProgress', () => {
  it('computes remaining and percent for a normal case', () => {
    const progress = computeBudgetProgress(300_000, 184_500); // Rs. 3,000 / spent 1,845
    expect(progress).toEqual({
      amount: 300_000,
      spent: 184_500,
      remaining: 115_500,
      percent: 61.5,
      state: 'ok',
    });
  });

  it('reports zero spent and full remaining with no expenses', () => {
    const progress = computeBudgetProgress(300_000, 0);
    expect(progress).toEqual({
      amount: 300_000,
      spent: 0,
      remaining: 300_000,
      percent: 0,
      state: 'ok',
    });
  });

  it('flags warning at exactly 80% (threshold inclusive)', () => {
    // 80% of 10_000_00 minor = 800_00
    const progress = computeBudgetProgress(100_000, 80_000);
    expect(progress.percent).toBe(80);
    expect(progress.state).toBe('warning');
  });

  it('keeps warning just under 100%', () => {
    const progress = computeBudgetProgress(100_000, 99_900);
    expect(progress.percent).toBe(99.9);
    expect(progress.state).toBe('warning');
  });

  it('flags exceeded at exactly 100%', () => {
    const progress = computeBudgetProgress(100_000, 100_000);
    expect(progress.percent).toBe(100);
    expect(progress.remaining).toBe(0);
    expect(progress.state).toBe('exceeded');
  });

  it('exceeded budget: negative remaining and >100% usage', () => {
    // Spec example: budget Rs. 1,000, spent Rs. 1,250 -> -250 / 125%
    const progress = computeBudgetProgress(100_000, 125_000);
    expect(progress.remaining).toBe(-25_000);
    expect(progress.percent).toBe(125);
    expect(progress.state).toBe('exceeded');
  });

  it('rounds percent to one decimal without float drift', () => {
    const progress = computeBudgetProgress(30_000, 18_450);
    expect(progress.percent).toBe(61.5);

    const thirds = computeBudgetProgress(300, 100);
    expect(thirds.percent).toBe(33.3);
  });

  it('handles a zero budget without dividing by zero', () => {
    const progress = computeBudgetProgress(0, 5_000);
    expect(progress).toEqual({
      amount: 0,
      spent: 5_000,
      remaining: -5_000,
      percent: 0,
      state: 'zero',
    });
  });

  it('treats a negative budget as the zero state (defensive)', () => {
    expect(computeBudgetProgress(-100, 0).state).toBe('zero');
  });

  it('warning threshold constant matches the 80% spec', () => {
    expect(BUDGET_WARNING_RATIO).toBe(0.8);
  });

  it('classifies the boundary between ok and warning', () => {
    expect(computeBudgetProgress(100_000, 79_999).state).toBe('ok');
    expect(computeBudgetProgress(100_000, 80_001).state).toBe('warning');
  });
});

describe('formatBudgetPercent', () => {
  it('renders whole numbers without decimals', () => {
    expect(formatBudgetPercent(82)).toBe('82');
    expect(formatBudgetPercent(125)).toBe('125');
  });

  it('keeps one decimal when present', () => {
    expect(formatBudgetPercent(61.5)).toBe('61.5');
    expect(formatBudgetPercent(99.9)).toBe('99.9');
  });
});

describe('budgetStateLabel', () => {
  it('maps every state to a friendly label', () => {
    expect(budgetStateLabel('ok')).toBe('On track');
    expect(budgetStateLabel('warning')).toBe('Approaching budget');
    expect(budgetStateLabel('exceeded')).toBe('Budget exceeded');
    expect(budgetStateLabel('zero')).toBe('Budget is 0');
  });
});
