/**
 * @jest-environment node
 */
import {
  buildExpenseDraft,
  initialExpenseFormValues,
  isExpenseFormValid,
  validateExpenseForm,
} from './form';
import {DAY_MS} from '@/utils/date';

const NOW = new Date(2026, 8, 7, 12).getTime();

const VALID = {
  amount: '12.50',
  title: 'Lunch',
  categoryId: 3,
  date: NOW,
  paymentMethod: 'cash' as const,
  note: '',
};

describe('validateExpenseForm', () => {
  it('accepts a fully valid form', () => {
    expect(validateExpenseForm(VALID)).toEqual({});
    expect(isExpenseFormValid(validateExpenseForm(VALID))).toBe(true);
  });

  it('requires an amount', () => {
    const errors = validateExpenseForm({...VALID, amount: ''});
    expect(errors.amount).toMatch(/required/i);
  });

  it.each([
    ['abc', /valid amount/i],
    ['12.', /valid amount/i],
    ['1.234', /valid amount/i],
  ])('rejects malformed amount %p', (amount, pattern) => {
    const errors = validateExpenseForm({...VALID, amount});
    expect(errors.amount).toMatch(pattern);
  });

  it.each([
    ['0', /greater than 0/i],
    ['0.00', /greater than 0/i],
    ['0.001', /valid amount/i],
  ])('rejects non-positive amount %p', (amount, pattern) => {
    const errors = validateExpenseForm({...VALID, amount});
    expect(errors.amount).toMatch(pattern);
  });

  it('requires a title', () => {
    expect(validateExpenseForm({...VALID, title: ''}).title).toMatch(
      /required/i,
    );
    expect(validateExpenseForm({...VALID, title: '   '}).title).toMatch(
      /required/i,
    );
  });

  it('requires a category', () => {
    const errors = validateExpenseForm({...VALID, categoryId: null});
    expect(errors.categoryId).toMatch(/category/i);
  });

  it('accepts a whitespace-padded note and title (trimmed at draft time)', () => {
    const errors = validateExpenseForm({
      ...VALID,
      title: '  Bus  ',
      note: '   ',
    });
    expect(errors).toEqual({});
  });
});

describe('buildExpenseDraft', () => {
  it('maps valid values onto repository draft fields', () => {
    const draft = buildExpenseDraft({
      ...VALID,
      title: '  Lunch  ',
      note: ' with rice ',
    });
    expect(draft).toEqual({
      amount: 1_250,
      title: 'Lunch',
      categoryId: 3,
      date: NOW,
      paymentMethod: 'cash',
      note: 'with rice',
    });
  });

  it('stores a blank note as null', () => {
    const draft = buildExpenseDraft({...VALID, note: '   '});
    expect(draft.note).toBeNull();
  });

  it('throws when called with an invalid form (programming error)', () => {
    expect(() =>
      buildExpenseDraft({...VALID, amount: '0', categoryId: null}),
    ).toThrow(/invalid form/i);
  });

  it('keeps the date the user picked', () => {
    const yesterday = NOW - DAY_MS;
    const draft = buildExpenseDraft({...VALID, date: yesterday});
    expect(draft.date).toBe(yesterday);
  });
});

describe('initialExpenseFormValues', () => {
  it('defaults to cash, no category and the given date', () => {
    expect(initialExpenseFormValues(NOW)).toEqual({
      amount: '',
      title: '',
      categoryId: null,
      date: NOW,
      paymentMethod: 'cash',
      note: '',
    });
  });
});
