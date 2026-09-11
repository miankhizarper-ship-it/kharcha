import {
  buildRecurringDraft,
  buildRecurringPatch,
  initialRecurringFormValues,
  isRecurringFormValid,
  validateRecurringForm,
} from './form';

/**
 * Recurring form validation — mirrors the database guards (migration 004
 * CHECK constraints + repository validation) and reuses the shared money
 * helpers, exactly like the expense/income forms do.
 */

const NOW = new Date(2026, 8, 8, 12, 0, 0, 0).getTime();
const LATER = new Date(2026, 11, 31, 12, 0, 0, 0).getTime();

function validExpenseValues() {
  return {
    ...initialRecurringFormValues(NOW, 'expense'),
    amount: '12000',
    title: 'Hostel rent',
    categoryId: 4,
    frequency: 'monthly' as const,
    hasEndDate: true,
    endDate: LATER,
  };
}

function validIncomeValues() {
  return {
    ...initialRecurringFormValues(NOW, 'income'),
    amount: '85000.50',
    title: 'Salary',
    frequency: 'monthly' as const,
  };
}

describe('validateRecurringForm', () => {
  it('accepts a valid expense rule', () => {
    const errors = validateRecurringForm(validExpenseValues(), 'expense');
    expect(errors).toEqual({});
    expect(isRecurringFormValid(errors)).toBe(true);
  });

  it('accepts a valid income rule without category or end date', () => {
    const errors = validateRecurringForm(validIncomeValues(), 'income');
    expect(errors).toEqual({});
  });

  it('rejects missing, malformed and non-positive amounts', () => {
    for (const amount of ['', 'abc', '0', '0.00', '1.234']) {
      const values = {...validExpenseValues(), amount};
      const errors = validateRecurringForm(values, 'expense');
      expect(errors.amount).toBeTruthy();
    }
  });

  it('rejects an empty title for expenses and sources for income', () => {
    const expense = {...validExpenseValues(), title: '   '};
    expect(validateRecurringForm(expense, 'expense').title).toBeTruthy();

    const income = {...validIncomeValues(), title: ''};
    expect(validateRecurringForm(income, 'income').title).toBeTruthy();
  });

  it('requires a category for expense rules only', () => {
    const missing = {...validExpenseValues(), categoryId: null};
    expect(validateRecurringForm(missing, 'expense').categoryId).toBeTruthy();

    // Income rules never need one.
    const income = {...validIncomeValues(), categoryId: null};
    expect(validateRecurringForm(income, 'income').categoryId).toBeUndefined();
  });

  it('rejects an end date before the next occurrence', () => {
    const values = {
      ...validExpenseValues(),
      hasEndDate: true,
      endDate: NOW - 24 * 60 * 60 * 1000,
    };
    expect(validateRecurringForm(values, 'expense').endDate).toBeTruthy();
  });

  it('accepts an end date equal to the next occurrence (inclusive)', () => {
    const values = {...validExpenseValues(), endDate: NOW};
    expect(validateRecurringForm(values, 'expense').endDate).toBeUndefined();
  });
});

describe('buildRecurringDraft (create mode)', () => {
  it('converts the amount to exact minor units and starts due on day one', () => {
    const draft = buildRecurringDraft(validExpenseValues(), 'expense');
    expect(draft).toEqual({
      type: 'expense',
      amount: 1_200_000, // 12000.00 — integer paisa
      title: 'Hostel rent',
      categoryId: 4,
      frequency: 'monthly',
      startDate: NOW,
      nextOccurrenceAt: NOW,
      endDate: LATER,
      paymentMethod: 'cash',
      note: null,
    });
  });

  it('builds income rules without category or payment method', () => {
    const draft = buildRecurringDraft(
      {...validIncomeValues(), note: '  Monthly pay  '},
      'income',
    );
    expect(draft.type).toBe('income');
    expect(draft.amount).toBe(8_500_050); // 85000.50 — exact, no float drift
    expect(draft.categoryId).toBeNull();
    expect(draft.paymentMethod).toBeNull();
    expect(draft.endDate).toBeNull();
    expect(draft.note).toBe('Monthly pay');
  });

  it('throws when called on an invalid form (defensive contract)', () => {
    const invalid = {...validExpenseValues(), amount: ''};
    expect(() => buildRecurringDraft(invalid, 'expense')).toThrow();
    const noCategory = {...validExpenseValues(), categoryId: null};
    expect(() => buildRecurringDraft(noCategory, 'expense')).toThrow();
  });
});

describe('buildRecurringPatch (edit mode)', () => {
  it('carries the editable next occurrence and clears the end date', () => {
    const values = {
      ...validExpenseValues(),
      nextOccurrenceAt: LATER,
      hasEndDate: false,
    };
    const patch = buildRecurringPatch(values, 'expense');
    expect(patch.nextOccurrenceAt).toBe(LATER);
    expect(patch.endDate).toBeNull();
    expect(patch.amount).toBe(1_200_000);
    expect('startDate' in patch).toBe(false); // start date is not editable
  });

  it('omits expense-only fields for income rules', () => {
    const patch = buildRecurringPatch(validIncomeValues(), 'income');
    expect(patch.categoryId).toBeUndefined();
    expect(patch.paymentMethod).toBeUndefined();
  });
});
