import {
  buildCategoryDraft,
  buildCategoryPatch,
  initialCategoryFormValues,
  isCategoryFormValid,
  isDuplicateName,
  isSameCategoryName,
  validateCategoryForm,
  validateCategoryName,
  CATEGORY_NAME_MAX,
} from './form';
import type {CategoryFormValues} from './types';

function values(
  overrides: Partial<CategoryFormValues> = {},
): CategoryFormValues {
  return {...initialCategoryFormValues('expense'), ...overrides};
}

describe('validateCategoryName', () => {
  it('accepts a normal name', () => {
    expect(validateCategoryName('Groceries')).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateCategoryName('   Fuel   ')).toBeNull();
  });

  it('rejects empty and whitespace-only names', () => {
    expect(validateCategoryName('')).toBe('Enter a category name.');
    expect(validateCategoryName('    ')).toBe('Enter a category name.');
  });

  it('rejects names above the reasonable maximum length', () => {
    const longName = 'x'.repeat(CATEGORY_NAME_MAX + 1);
    expect(validateCategoryName(longName)).toContain('under 40');
    expect(validateCategoryName('x'.repeat(CATEGORY_NAME_MAX))).toBeNull();
  });
});

describe('validateCategoryForm', () => {
  it('returns no errors for a valid form', () => {
    const errors = validateCategoryForm(values({name: 'Fuel', icon: 'car'}));
    expect(errors).toEqual({});
    expect(isCategoryFormValid(errors)).toBe(true);
  });

  it('requires a name', () => {
    const errors = validateCategoryForm(values({name: '   '}));
    expect(errors.name).toBeDefined();
    expect(isCategoryFormValid(errors)).toBe(false);
  });

  it('requires an icon', () => {
    const errors = validateCategoryForm(values({icon: ''}));
    expect(errors.icon).toBe('Pick an icon.');
  });
});

describe('duplicate detection', () => {
  const existing = [
    {id: 1, name: 'Food & Dining', type: 'expense'},
    {id: 2, name: 'Salary', type: 'income'},
    {id: 3, name: 'fuel', type: 'expense'},
  ];

  it('matches names case-insensitively within the same type', () => {
    expect(isSameCategoryName(' Food ', 'food')).toBe(true);
    expect(isSameCategoryName('Food', 'Fuel')).toBe(false);
  });

  it('flags duplicates of the same type regardless of case', () => {
    expect(isDuplicateName('food & dining', 'expense', existing)).toBe(true);
    expect(isDuplicateName('FUEL', 'expense', existing)).toBe(true);
  });

  it('ignores the same name under a different type', () => {
    expect(isDuplicateName('Salary', 'expense', existing)).toBe(false);
    expect(isDuplicateName('Fuel', 'income', existing)).toBe(false);
  });

  it('allows keeping own name while editing (excludeId)', () => {
    expect(isDuplicateName('fuel', 'expense', existing, 3)).toBe(false);
    expect(isDuplicateName('  Fuel  ', 'expense', existing, 3)).toBe(false);
    // But another row's name is still a duplicate.
    expect(isDuplicateName('fuel', 'expense', existing, 1)).toBe(true);
  });
});

describe('draft/patch builders', () => {
  it('builds a trimmed create draft', () => {
    expect(
      buildCategoryDraft(values({name: '  Fuel  ', icon: ' car '})),
    ).toEqual({name: 'Fuel', icon: 'car', type: 'expense'});
  });

  it('refuses to build a draft from an invalid form', () => {
    expect(() => buildCategoryDraft(values({name: '   '}))).toThrow(
      /validateCategoryForm/,
    );
  });

  it('builds a minimal patch with only changed fields', () => {
    const original = values({name: 'Fuel', icon: 'car', isActive: true});
    const patch = buildCategoryPatch(
      values({name: 'Fuel ', icon: 'car', isActive: false}),
      original,
    );
    expect(patch).toEqual({isActive: false});
  });

  it('reports no changes when nothing differs after trimming', () => {
    const original = values({name: 'Fuel', icon: 'car'});
    const patch = buildCategoryPatch(
      values({name: ' Fuel ', icon: 'car'}),
      original,
    );
    expect(patch).toEqual({});
  });

  it('captures name, icon and active changes together', () => {
    const original = values({name: 'Old', icon: 'tag', isActive: true});
    const patch = buildCategoryPatch(
      values({name: 'New', icon: 'car', isActive: false}),
      original,
    );
    expect(patch).toEqual({name: 'New', icon: 'car', isActive: false});
  });
});
