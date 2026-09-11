import {
  buildIncomeDraft,
  initialIncomeFormValues,
  isIncomeFormValid,
  validateIncomeForm,
  type IncomeFormValues,
} from './form';

const NOW = new Date(2026, 8, 8, 10, 0).getTime();

function validValues(
  overrides: Partial<IncomeFormValues> = {},
): IncomeFormValues {
  return {
    amount: '30000',
    source: 'Salary',
    date: NOW,
    note: '',
    ...overrides,
  };
}

describe('income form', () => {
  describe('initialIncomeFormValues', () => {
    it('defaults the date to today and leaves the rest blank', () => {
      expect(initialIncomeFormValues(NOW)).toEqual({
        amount: '',
        source: '',
        date: NOW,
        note: '',
      });
    });
  });

  describe('validateIncomeForm', () => {
    it('accepts a fully valid form', () => {
      expect(validateIncomeForm(validValues())).toEqual({});
      expect(isIncomeFormValid(validateIncomeForm(validValues()))).toBe(true);
    });

    it('requires an amount', () => {
      expect(validateIncomeForm(validValues({amount: ''})).amount).toBe(
        'Amount is required.',
      );
      expect(validateIncomeForm(validValues({amount: '   '})).amount).toBe(
        'Amount is required.',
      );
    });

    it('rejects malformed amounts', () => {
      expect(validateIncomeForm(validValues({amount: 'abc'})).amount).toBe(
        'Enter a valid amount, e.g. 250 or 12.50.',
      );
      expect(validateIncomeForm(validValues({amount: '1.234'})).amount).toBe(
        'Enter a valid amount, e.g. 250 or 12.50.',
      );
    });

    it.each(['0', '0.00'])('rejects amount %p', amount => {
      const errors = validateIncomeForm(validValues({amount}));
      expect(errors.amount).toBe('Amount must be greater than 0.');
    });

    it('rejects negative amounts as malformed', () => {
      // The input sanitizer prevents typing a minus sign, but if one arrives
      // anyway it fails the shape check, not the positivity check.
      expect(validateIncomeForm(validValues({amount: '-5'})).amount).toBe(
        'Enter a valid amount, e.g. 250 or 12.50.',
      );
    });

    it('requires a source', () => {
      expect(validateIncomeForm(validValues({source: ''})).source).toBe(
        'Select a source.',
      );
      expect(validateIncomeForm(validValues({source: '  '})).source).toBe(
        'Select a source.',
      );
    });

    it('does not require a note', () => {
      expect(validateIncomeForm(validValues({note: ''}))).toEqual({});
      expect(validateIncomeForm(validValues({note: 'September pay'}))).toEqual(
        {},
      );
    });
  });

  describe('buildIncomeDraft', () => {
    it('converts the amount to minor units and trims fields', () => {
      const draft = buildIncomeDraft(
        validValues({amount: '30000.50', source: '  Freelance  ', note: '  '}),
      );
      expect(draft).toEqual({
        amount: 3_000_050,
        source: 'Freelance',
        date: NOW,
        note: null,
      });
    });

    it('keeps a non-blank note', () => {
      const draft = buildIncomeDraft(validValues({note: ' September pay '}));
      expect(draft.note).toBe('September pay');
    });

    it('refuses to build from an invalid form', () => {
      expect(() => buildIncomeDraft(validValues({amount: '0'}))).toThrow(
        /validateIncomeForm/,
      );
      expect(() => buildIncomeDraft(validValues({source: ''}))).toThrow(
        /validateIncomeForm/,
      );
      expect(() => buildIncomeDraft(validValues({amount: ''}))).toThrow(
        /validateIncomeForm/,
      );
    });
  });
});
