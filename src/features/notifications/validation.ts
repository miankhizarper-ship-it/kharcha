import {HOUR_MAX, HOUR_MIN, MINUTE_MAX, MINUTE_MIN} from './config';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type NotificationStateV1,
  type ReminderTime,
} from './types';

/**
 * Pure coercion of persisted notification values.
 *
 * Same contract as the settings feature's coercion (spec §15 there): a
 * missing OR hand-corrupted stored value falls back to the default instead
 * of propagating garbage — preferences can never crash the feature.
 */

function isReminderTime(value: unknown): value is ReminderTime {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.hour === 'number' &&
    Number.isInteger(candidate.hour) &&
    candidate.hour >= HOUR_MIN &&
    candidate.hour <= HOUR_MAX &&
    typeof candidate.minute === 'number' &&
    Number.isInteger(candidate.minute) &&
    candidate.minute >= MINUTE_MIN &&
    candidate.minute <= MINUTE_MAX
  );
}

/** '1' → true, '0' → false, anything else → fallback. */
export function coerceEnabled(value: string | null): boolean {
  return value === '1';
}

/** Parses `{"hour":H,"minute":M}` JSON; falls back to the default time. */
export function coerceReminderTime(value: string | null): ReminderTime {
  if (value === null || value.trim() === '') {
    return DEFAULT_NOTIFICATION_PREFERENCES.dailyReminderTime;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isReminderTime(parsed)
      ? parsed
      : DEFAULT_NOTIFICATION_PREFERENCES.dailyReminderTime;
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES.dailyReminderTime;
  }
}

/** Merges raw stored strings (KV rows) into a complete preferences object. */
export function coercePreferences(
  values: Map<string, string>,
): NotificationPreferences {
  return {
    dailyReminderEnabled: coerceEnabled(
      values.get('dailyEnabled') ?? null,
    ),
    dailyReminderTime: coerceReminderTime(values.get('dailyTime') ?? null),
    budgetAlertsEnabled: coerceEnabled(values.get('budgetAlerts') ?? null),
    recurringReminderEnabled: coerceEnabled(
      values.get('recurringReminder') ?? null,
    ),
    monthlySummaryEnabled: coerceEnabled(values.get('monthlySummary') ?? null),
  };
}

/** Parses the persisted dedupe state; anything invalid → empty v1 state. */
export function coerceNotificationState(
  value: string | null,
): NotificationStateV1 {
  const empty: NotificationStateV1 = {schemaVersion: 1, budgetNotifiedKeys: []};
  if (value === null || value.trim() === '') {
    return empty;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) {
      return empty;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.schemaVersion !== 1) {
      return empty;
    }
    if (!Array.isArray(candidate.budgetNotifiedKeys)) {
      return empty;
    }
    const keys = candidate.budgetNotifiedKeys.filter(
      (key): key is string => typeof key === 'string' && key.length > 0,
    );
    return {schemaVersion: 1, budgetNotifiedKeys: Array.from(new Set(keys))};
  } catch {
    return empty;
  }
}

/** True when the two preference snapshots are deeply equal. */
export function preferencesEqual(
  a: NotificationPreferences,
  b: NotificationPreferences,
): boolean {
  return (
    a.dailyReminderEnabled === b.dailyReminderEnabled &&
    a.dailyReminderTime.hour === b.dailyReminderTime.hour &&
    a.dailyReminderTime.minute === b.dailyReminderTime.minute &&
    a.budgetAlertsEnabled === b.budgetAlertsEnabled &&
    a.recurringReminderEnabled === b.recurringReminderEnabled &&
    a.monthlySummaryEnabled === b.monthlySummaryEnabled
  );
}
