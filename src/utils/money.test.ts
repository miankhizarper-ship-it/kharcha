/**
 * @jest-environment node
 */
import {parseAmountToMinor, sanitizeAmountInput} from './money';

describe('sanitizeAmountInput', () => {
  it.each([
    ['12.50', '12.50'],
    ['0', '0'],
    ['0.', '0.'],
    ['0.05', '0.05'],
  ])('keeps valid input %p', (input, expected) => {
    expect(sanitizeAmountInput(input)).toBe(expected);
  });

  it.each([
    ['abc', ''],
    ['1a2b3', '123'],
    ['1.2.3', '1.23'],
    ['1.999', '1.99'],
    ['00.5', '0.5'],
    ['007', '7'],
    ['-5', '5'],
    ['', ''],
  ])('normalizes %p to %p', (input, expected) => {
    expect(sanitizeAmountInput(input)).toBe(expected);
  });

  it('caps the raw length', () => {
    expect(sanitizeAmountInput('123456789012345')).toBe('12345678901');
  });
});

describe('parseAmountToMinor', () => {
  it.each([
    ['250', 25_000],
    ['12.5', 1_250],
    ['12.50', 1_250],
    ['0.01', 1],
    ['8.20', 820], // exact, no float drift
    ['0.10', 10],
    ['0', 0],
    ['0.00', 0],
  ])('parses %p to %p minor units', (input, expected) => {
    expect(parseAmountToMinor(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['12.', 'trailing dot'],
    ['1.234', 'three decimals'],
    ['abc', 'letters'],
    ['-5', 'negative'],
    ['1 000', 'spaces inside'],
    ['99999999999999999999', 'unsafe integer'],
  ])('rejects %p (%s)', input => {
    expect(parseAmountToMinor(input)).toBeNull();
  });
});
