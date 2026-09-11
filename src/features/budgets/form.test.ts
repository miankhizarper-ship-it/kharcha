/**
 * @jest-environment node
 */
import {
  buildCategoryBudgetDraft,
  buildOverallBudgetDraft,
  initialBudgetFormValues,
  isBudgetFormValid,
  minorToAmountText,
  validateBudgetForm,
  validateBudgetPeriod,
} from './form';

const VALID_OVERALL = {amount: '30000', categoryId: null};
const VALID_CATEGORY = {amount: '10000', categoryId: 3};

describe('validateBudgetForm', () => {
  it('accepts a valid overall budget form', () => {
    const errors = validateBudgetForm(VALID_OVERALL, {mode: 'overall'});
    expect(errors).toEqual({});
    expect(isBudgetFormValid(errors)).toBe(true);
  });

  it('accepts a valid category budget form', () => {
    const errors = validateBudgetForm(VALID_CATEGORY, {mode: 'category'});
    expect(errors).toEqual({});
  });

  it('requires an amount', () => {
    const errors = validateBudgetForm(
      {...VALID_CATEGORY, amount: ''},
      {mode: 'category'},
    );
    expect(errors.amount).toBe('Amount is required.');
  });

  it('rejects amounts that are not valid numbers', () => {
    const errors = validateBudgetForm(
      {...VALID_CATEGORY, amount: '12.3.4a'},
      {mode: 'category'},
    );
    expect(errors.amount).toMatch(/valid amount/i);
  });

  it.each(['0', '0.00'])('rejects amount %s (must be > 0)', amount => {
    const errors = validateBudgetForm(
      {...VALID_CATEGORY, amount},
      {mode: 'category'},
    );
    expect(errors.amount).toBe('Amount must be greater than 0.');
  });

  it('rejects a negative amount as unparseable (input sanitizer blocks "-")', () => {
    const errors = validateBudgetForm(
      {...VALID_CATEGORY, amount: '-5'},
      {mode: 'category'},
    );
    expect(errors.amount).toMatch(/valid amount/i);
  });

  it('requires a category in category mode', () => {
    const errors = validateBudgetForm(
      {...VALID_CATEGORY, categoryId: null},
      {mode: 'category'},
    );
    expect(errors.categoryId).toBe('Select a category.');
  });

  it('does not require a category in overall mode', () => {
    const errors = validateBudgetForm(
      {amount: '500', categoryId: null},
      {mode: 'overall'},
    );
    expect(errors.categoryId).toBeUndefined();
  });

  it('blocks duplicate category budgets for the month', () => {
    const errors = validateBudgetForm(VALID_CATEGORY, {
      mode: 'category',
      budgetedCategoryIds: [3, 7],
    });
    expect(errors.categoryId).toMatch(/already has a budget/i);
  });

  it('allows the edited row to keep its own category', () => {
    // Edit flow: the row under edit is removed from the occupied list.
    const errors = validateBudgetForm(VALID_CATEGORY, {
      mode: 'category',
      budgetedCategoryIds: [7],
    });
    expect(errors).toEqual({});
  });

  it('ignores the duplicate list in overall mode', () => {
    const errors = validateBudgetForm(VALID_OVERALL, {
      mode: 'overall',
      budgetedCategoryIds: [3],
    });
    expect(errors).toEqual({});
  });

  it('trims the amount before validating', () => {
    const errors = validateBudgetForm(
      {...VALID_CATEGORY, amount: '  10000  '},
      {mode: 'category'},
    );
    expect(errors).toEqual({});
  });
});

describe('validateBudgetPeriod', () => {
  it.each([1, 6, 12])('accepts month %i with a valid year', month => {
    expect(validateBudgetPeriod(month, 2026)).toBeNull();
  });

  it.each([0, 13, -1])('rejects month %i', month => {
    expect(validateBudgetPeriod(month, 2026)).toMatch(/month is invalid/i);
  });

  it('rejects non-integer months', () => {
    expect(validateBudgetPeriod(6.5, 2026)).toMatch(/month is invalid/i);
  });

  it.each([1999, 2101])('rejects year %i', year => {
    expect(validateBudgetPeriod(9, year)).toMatch(/year is invalid/i);
  });
});

describe('buildCategoryBudgetDraft', () => {
  it('converts the raw amount to exact minor units', () => {
    const draft = buildCategoryBudgetDraft(
      {amount: '1250.50', categoryId: 4},
      9,
      2026,
    );
    expect(draft).toEqual({
      categoryId: 4,
      amount: 125_050,
      month: 9,
      year: 2026,
    });
  });

  it('refuses to build from an invalid form', () => {
    expect(() =>
      buildCategoryBudgetDraft({amount: '', categoryId: null}, 9, 2026),
    ).toThrow(/invalid form/i);
  });
});

describe('buildOverallBudgetDraft', () => {
  it('converts the raw amount to exact minor units', () => {
    const draft = buildOverallBudgetDraft(
      {amount: '30000', categoryId: null},
      9,
      2026,
    );
    expect(draft).toEqual({amount: 3_000_000, month: 9, year: 2026});
  });

  it('refuses to build from an invalid form', () => {
    expect(() =>
      buildOverallBudgetDraft({amount: 'abc', categoryId: null}, 9, 2026),
    ).toThrow(/invalid form/i);
  });
});

describe('helpers', () => {
  it('initialBudgetFormValues starts empty', () => {
    expect(initialBudgetFormValues()).toEqual({amount: '', categoryId: null});
  });

  it('minorToAmountText round-trips through parseAmountToMinor', () => {
    expect(minorToAmountText(3_000_000)).toBe('30000.00');
    expect(minorToAmountText(125_050)).toBe('1250.50');
  });
});
