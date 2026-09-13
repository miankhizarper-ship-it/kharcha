/**
 * @jest-environment node
 */
import {DEFAULT_NOTIFICATION_PREFERENCES} from './types';
import {
  coerceEnabled,
  coerceNotificationState,
  coercePreferences,
  coerceReminderTime,
  preferencesEqual,
} from './validation';

describe('coerceEnabled', () => {
  it.each([
    ['1', true],
    ['0', false],
    [null, false],
    ['true', false],
    ['', false],
  ])('coerces %p → %p', (value, expected) => {
    expect(coerceEnabled(value)).toBe(expected);
  });
});

describe('coerceReminderTime', () => {
  it('parses a stored JSON time', () => {
    expect(coerceReminderTime('{"hour":21,"minute":30}')).toEqual({
      hour: 21,
      minute: 30,
    });
  });

  it.each([
    ['null value', null],
    ['empty value', ''],
    ['broken json', '{oops'],
    ['wrong shape', '"20:00"'],
    ['out-of-range hour', '{"hour":24,"minute":0}'],
    ['negative minute', '{"hour":20,"minute":-5}'],
    ['float values', '{"hour":8.5,"minute":0}'],
  ])('falls back to the default on %s', (_label, value) => {
    expect(coerceReminderTime(value as string | null)).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES.dailyReminderTime,
    );
  });
});

describe('coercePreferences', () => {
  it('returns full defaults for an empty map', () => {
    expect(coercePreferences(new Map())).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it('merges stored strings into a complete snapshot', () => {
    const preferences = coercePreferences(
      new Map<string, string>([
        ['dailyEnabled', '1'],
        ['dailyTime', '{"hour":7,"minute":15}'],
        ['budgetAlerts', '1'],
        ['recurringReminder', '0'],
        ['monthlySummary', '0'],
      ]),
    );
    expect(preferences).toEqual({
      dailyReminderEnabled: true,
      dailyReminderTime: {hour: 7, minute: 15},
      budgetAlertsEnabled: true,
      recurringReminderEnabled: false,
      monthlySummaryEnabled: false,
    });
  });
});

describe('coerceNotificationState', () => {
  it('parses a valid v1 state and dedupes keys', () => {
    expect(
      coerceNotificationState(
        '{"schemaVersion":1,"budgetNotifiedKeys":["a","a","b"]}',
      ),
    ).toEqual({schemaVersion: 1, budgetNotifiedKeys: ['a', 'b']});
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['broken json', '{'],
    ['future schema', '{"schemaVersion":2,"budgetNotifiedKeys":[]}'],
    ['missing keys array', '{"schemaVersion":1}'],
    ['non-string keys', '{"schemaVersion":1,"budgetNotifiedKeys":[1,2]}'],
  ])('returns an empty v1 state for %s', (_label, value) => {
    expect(coerceNotificationState(value as string | null)).toEqual({
      schemaVersion: 1,
      budgetNotifiedKeys: [],
    });
  });
});

describe('preferencesEqual', () => {
  const base = DEFAULT_NOTIFICATION_PREFERENCES;

  it('is true for identical snapshots', () => {
    expect(preferencesEqual(base, {...base})).toBe(true);
  });

  it.each([
    ['enabled flag', {...base, dailyReminderEnabled: true}],
    ['time hour', {...base, dailyReminderTime: {hour: 21, minute: 0}}],
    ['time minute', {...base, dailyReminderTime: {hour: 20, minute: 30}}],
    ['budget alerts', {...base, budgetAlertsEnabled: true}],
    ['recurring', {...base, recurringReminderEnabled: true}],
    ['monthly', {...base, monthlySummaryEnabled: true}],
  ])('detects a change in %s', (label, other) => {
    expect(preferencesEqual(base, other as typeof base)).toBe(false);
  });
});
