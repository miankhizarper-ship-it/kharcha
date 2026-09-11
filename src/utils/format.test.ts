import {formatCurrency, formatMinorAsDecimal} from './format';

describe('formatCurrency', () => {
  it('formats minor units as a currency string', () => {
    expect(formatCurrency(1050)).toBe('$10.50');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats negative amounts', () => {
    expect(formatCurrency(-250)).toBe('-$2.50');
  });

  it('always shows two fraction digits for PKR (the default currency)', () => {
    // Kharcha stores every currency x100, so CLDR's zero-decimal default
    // for PKR would silently round paisa away (regression: 500.50 -> 501).
    expect(formatCurrency(50050, 'PKR')).toMatch(/^PKR\s*500\.50$/);
    expect(formatCurrency(50000, 'PKR')).toMatch(/^PKR\s*500\.00$/);
  });

  it('keeps fraction digits for other zero-decimal CLDR currencies', () => {
    expect(formatCurrency(50050, 'JPY')).toMatch(/¥\s*500\.50$/);
  });

  it('keeps large amounts readable without losing precision', () => {
    expect(formatCurrency(9999999999, 'PKR')).toMatch(/^PKR\s*99,999,999\.99$/);
  });
});

describe('formatMinorAsDecimal', () => {
  it('renders stored minor units as an exact decimal string', () => {
    expect(formatMinorAsDecimal(0)).toBe('0.00');
    expect(formatMinorAsDecimal(5)).toBe('0.05');
    expect(formatMinorAsDecimal(50)).toBe('0.50');
    expect(formatMinorAsDecimal(125050)).toBe('1250.50');
    expect(formatMinorAsDecimal(9999999999)).toBe('99999999.99');
  });

  it('handles negatives without float drift', () => {
    expect(formatMinorAsDecimal(-250)).toBe('-2.50');
  });

  it('rejects non-integer inputs instead of rounding silently', () => {
    expect(() => formatMinorAsDecimal(10.5)).toThrow();
    expect(() => formatMinorAsDecimal(Number.NaN)).toThrow();
  });
});
