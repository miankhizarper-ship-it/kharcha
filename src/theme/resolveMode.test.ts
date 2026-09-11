import {describe, expect, it} from '@jest/globals';
import {isThemeMode, resolveThemeMode} from './resolveMode';

describe('resolveThemeMode', () => {
  it('passes explicit light/dark through untouched', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
    expect(resolveThemeMode('light', null)).toBe('light');
    expect(resolveThemeMode('dark', null)).toBe('dark');
  });

  it('follows the system color scheme in system mode', () => {
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
    expect(resolveThemeMode('system', 'light')).toBe('light');
  });

  it('defaults system mode to light when the scheme is unavailable', () => {
    expect(resolveThemeMode('system', null)).toBe('light');
    expect(resolveThemeMode('system', undefined)).toBe('light');
  });
});

describe('isThemeMode', () => {
  it('accepts only the three known modes', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('blue')).toBe(false);
    expect(isThemeMode('')).toBe(false);
    expect(isThemeMode('LIGHT')).toBe(false);
  });
});
