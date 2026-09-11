/**
 * @jest-environment node
 */
import {
  buildActiveFilterChips,
  buildTransactionSummary,
  defaultTransactionFilters,
  filtersToQuery,
  hasActiveFilters,
  removeFilterChip,
  transactionPeriodToBounds,
  validateAmountBound,
  validateAmountRange,
} from './filters';
import type {TransactionFilters} from './filters';
import {
  atNoon,
  endOfDay,
  monthBounds,
  startOfDay,
  weekBounds,
} from '@/utils/date';

/** Fixed "now": Sep 7 2026 (a Monday) 15:30 local. */
const NOW = new Date(2026, 8, 7, 15, 30).getTime();

describe('transactionPeriodToBounds', () => {
  it('resolves "all" to an unbounded window', () => {
    expect(transactionPeriodToBounds('all', null, NOW)).toEqual({});
    expect(transactionPeriodToBounds(undefined, null, NOW)).toEqual({});
  });

  it('resolves today to the exact local day', () => {
    const {fromDate, toDate} = transactionPeriodToBounds('today', null, NOW);
    expect(fromDate).toBe(startOfDay(NOW));
    expect(toDate).toBe(endOfDay(NOW));
  });

  it('resolves thisWeek to Monday..Sunday (ISO week, local)', () => {
    const {fromDate, toDate} = transactionPeriodToBounds('thisWeek', null, NOW);
    const expected = weekBounds(NOW);
    expect(fromDate).toBe(expected.fromDate);
    expect(toDate).toBe(expected.toDate);
  });

  it('resolves thisMonth through the shared month bounds', () => {
    const {fromDate, toDate} = transactionPeriodToBounds(
      'thisMonth',
      null,
      NOW,
    );
    const expected = monthBounds(2026, 9);
    expect(fromDate).toBe(expected.fromDate);
    expect(toDate).toBe(expected.toDate);
  });

  it('resolves lastMonth across the year boundary (Jan -> Dec)', () => {
    const JAN_15 = atNoon(2027, 0, 15);
    const {fromDate, toDate} = transactionPeriodToBounds(
      'lastMonth',
      null,
      JAN_15,
    );
    const expected = monthBounds(2026, 12);
    expect(fromDate).toBe(expected.fromDate);
    expect(toDate).toBe(expected.toDate);
  });

  it('normalizes a reversed custom range to full local days', () => {
    const from = atNoon(2026, 7, 3);
    const to = atNoon(2026, 7, 1);
    const bounds = transactionPeriodToBounds(
      'custom',
      {fromDate: from, toDate: to},
      NOW,
    );
    expect(bounds.fromDate).toBe(startOfDay(to));
    expect(bounds.toDate).toBe(endOfDay(from));
  });

  it('treats custom without a stored range as unbounded (defensive)', () => {
    expect(transactionPeriodToBounds('custom', null, NOW)).toEqual({});
  });
});

describe('validateAmountBound', () => {
  it('accepts an empty field as "not set"', () => {
    expect(validateAmountBound('', 'Minimum')).toEqual({
      minor: null,
      error: null,
    });
    expect(validateAmountBound('   ', 'Maximum')).toEqual({
      minor: null,
      error: null,
    });
  });

  it('parses exact minor units', () => {
    expect(validateAmountBound('500', 'Minimum')).toEqual({
      minor: 50_000,
      error: null,
    });
    expect(validateAmountBound('500.50', 'Maximum')).toEqual({
      minor: 50_050,
      error: null,
    });
    expect(validateAmountBound(' 0.01 ', 'Minimum')).toEqual({
      minor: 1,
      error: null,
    });
  });

  it('rejects malformed input', () => {
    expect(validateAmountBound('abc', 'Minimum')!.error).toMatch(/number/);
    expect(validateAmountBound('12.', 'Minimum')!.error).toMatch(/number/);
    // Negative input is malformed for this filter.
    expect(validateAmountBound('-5', 'Minimum')!.error).toMatch(/number/);
  });

  it('rejects excessive decimal precision (currency rules)', () => {
    expect(validateAmountBound('5.123', 'Maximum')!.error).toMatch(/number/);
  });

  it('rejects zero', () => {
    expect(validateAmountBound('0', 'Minimum')!.error).toMatch(
      /greater than zero/,
    );
    expect(validateAmountBound('0.00', 'Maximum')!.error).toMatch(
      /greater than zero/,
    );
  });

  it('names the field in every error', () => {
    expect(validateAmountBound('x', 'Minimum')!.error).toContain('Minimum');
    expect(validateAmountBound('x', 'Maximum')!.error).toContain('Maximum');
  });
});

describe('validateAmountRange', () => {
  it('accepts a min <= max and one-sided bounds', () => {
    expect(validateAmountRange(100, 200)).toBeNull();
    expect(validateAmountRange(200, 200)).toBeNull();
    expect(validateAmountRange(100, null)).toBeNull();
    expect(validateAmountRange(null, 200)).toBeNull();
    expect(validateAmountRange(null, null)).toBeNull();
  });

  it('rejects min > max with a human message', () => {
    expect(validateAmountRange(300, 200)).toMatch(/cannot be greater/);
  });
});

describe('active-filter chips', () => {
  const context = {categoryName: 'Food & Dining', currency: 'PKR'};

  it('produces no chips for defaults', () => {
    expect(
      buildActiveFilterChips(defaultTransactionFilters(), context),
    ).toEqual([]);
    expect(hasActiveFilters(defaultTransactionFilters())).toBe(false);
  });

  it('labels every constraint kind with remove hints', () => {
    const filters: TransactionFilters = {
      ...defaultTransactionFilters(),
      search: 'groceries',
      type: 'expense',
      categoryId: 3,
      paymentMethod: 'cash',
      recurring: 'recurring',
      period: 'thisMonth',
      minAmount: 50_000,
      maxAmount: 500_000,
      sort: 'highest',
    };
    const chips = buildActiveFilterChips(filters, context);
    expect(chips.map(c => c.kind)).toEqual([
      'search',
      'type',
      'category',
      'payment',
      'recurring',
      'period',
      'minAmount',
      'maxAmount',
      'sort',
    ]);
    for (const chip of chips) {
      expect(chip.accessibilityLabel).toMatch(/remove filter/i);
    }
    expect(chips[0].label).toBe('"groceries"');
    expect(chips[1].label).toBe('Expenses');
    expect(chips[2].label).toBe('Food & Dining');
    expect(chips[3].label).toBe('Cash');
    expect(chips[4].label).toBe('Recurring');
    expect(chips[5].label).toBe('This month');
    // Minor units rendered through the display currency.
    expect(chips[6].label).toContain('500');
    expect(chips[7].label).toContain('5,000');
    expect(chips[8].label).toBe('Highest amount');
    // hasActiveFilters ignores sort-only state, chips do not.
    expect(
      hasActiveFilters({
        ...filters,
        search: '',
        type: 'all',
        categoryId: null,
        paymentMethod: null,
        recurring: 'all',
        period: 'all',
        minAmount: null,
        maxAmount: null,
      }),
    ).toBe(false);
  });

  it('uses the date-range label for custom periods', () => {
    const chips = buildActiveFilterChips(
      {
        ...defaultTransactionFilters(),
        period: 'custom',
        customRange: {fromDate: atNoon(2026, 7, 1), toDate: atNoon(2026, 7, 7)},
      },
      context,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].kind).toBe('period');
    expect(chips[0].label).toMatch(/Aug 1/);
  });

  it('falls back to a generic category label when the name is unknown', () => {
    const chips = buildActiveFilterChips(
      {...defaultTransactionFilters(), categoryId: 9},
      {currency: 'PKR'},
    );
    expect(chips[0].label).toBe('Category');
  });
});

describe('buildTransactionSummary', () => {
  const context = {categoryName: 'Food & Dining', currency: 'PKR'};

  it('counts all transactions when only the count is interesting', () => {
    expect(
      buildTransactionSummary(24, defaultTransactionFilters(), context),
    ).toBe('24 transactions');
  });

  it('nouns the active type', () => {
    expect(
      buildTransactionSummary(
        7,
        {...defaultTransactionFilters(), type: 'expense'},
        context,
      ),
    ).toBe('7 expenses');
    expect(
      buildTransactionSummary(
        2,
        {...defaultTransactionFilters(), type: 'income'},
        context,
      ),
    ).toBe('2 income transactions');
  });

  it('appends the strongest constraints compactly', () => {
    expect(
      buildTransactionSummary(
        24,
        {
          ...defaultTransactionFilters(),
          type: 'expense',
          categoryId: 3,
          paymentMethod: 'cash',
          period: 'thisMonth',
        },
        context,
      ),
    ).toBe('24 expenses · Food & Dining · Cash · This month');
  });

  it('truncates long category names', () => {
    const summary = buildTransactionSummary(
      3,
      {...defaultTransactionFilters(), categoryId: 3},
      {
        categoryName: 'A very long category name that goes on and on',
        currency: 'PKR',
      },
    );
    expect(summary).toContain('…');
    expect(summary.length).toBeLessThan(45);
  });
});

describe('removeFilterChip', () => {
  it('resets exactly one kind and keeps the rest', () => {
    const base: TransactionFilters = {
      ...defaultTransactionFilters(),
      search: 'tea',
      type: 'expense',
      categoryId: 5,
      paymentMethod: 'card',
      recurring: 'manual',
      period: 'custom',
      customRange: {fromDate: 1, toDate: 2},
      minAmount: 100,
      maxAmount: 900,
      sort: 'lowest',
    };

    expect(removeFilterChip(base, 'search')).toMatchObject({
      search: '',
      type: 'expense',
      minAmount: 100,
    });
    expect(removeFilterChip(base, 'type')!.type).toBe('all');
    expect(removeFilterChip(base, 'category')!.categoryId).toBeNull();
    expect(removeFilterChip(base, 'payment')!.paymentMethod).toBeNull();
    expect(removeFilterChip(base, 'recurring')!.recurring).toBe('all');
    // Removing the period drops the stored custom range with it.
    const noPeriod = removeFilterChip(base, 'period');
    expect(noPeriod!.period).toBe('all');
    expect(noPeriod!.customRange).toBeNull();
    expect(removeFilterChip(base, 'minAmount')!.minAmount).toBeNull();
    expect(removeFilterChip(base, 'maxAmount')!.maxAmount).toBeNull();
    expect(removeFilterChip(base, 'sort')!.sort).toBe('newest');
  });
});

describe('filtersToQuery', () => {
  it('maps the full filter state onto the service query', () => {
    const filters: TransactionFilters = {
      ...defaultTransactionFilters(),
      search: 'rent',
      type: 'expense',
      categoryId: 11,
      paymentMethod: 'bank_transfer',
      recurring: 'recurring',
      period: 'custom',
      customRange: {fromDate: 10, toDate: 20},
      minAmount: 500,
      maxAmount: 5_000,
      sort: 'oldest',
    };
    expect(filtersToQuery(filters, 3)).toEqual({
      type: 'expense',
      search: 'rent',
      categoryId: 11,
      paymentMethod: 'bank_transfer',
      recurring: 'recurring',
      period: 'custom',
      customRange: {fromDate: 10, toDate: 20},
      minAmount: 500,
      maxAmount: 5_000,
      sort: 'oldest',
      page: 3,
    });
  });

  it('drops the search term and keeps defaults optional', () => {
    const query = filtersToQuery(defaultTransactionFilters(), 0);
    expect(query.search).toBeUndefined();
    expect(query.type).toBe('all');
    expect(query.sort).toBe('newest');
    expect(query.page).toBe(0);
  });
});
