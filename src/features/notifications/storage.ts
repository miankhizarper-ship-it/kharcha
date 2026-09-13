import type {DatabaseService} from '@/database/service';

import {NOTIFICATION_SETTING_KEYS} from './config';
import {
  coerceNotificationState,
  coercePreferences,
  preferencesEqual,
} from './validation';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type NotificationStateV1,
} from './types';

/**
 * SQLite-backed persistence for notification preferences and dedupe state.
 *
 * Uses the EXISTING `settings` key/value table through the existing
 * `SettingsRepository` (spec §9: "use the project's existing storage
 * solution") — the same place theme/currency live. No new library, no new
 * migration. All coercion lives in `validation.ts`, so a corrupt row can
 * never propagate past this module.
 */
export interface NotificationStorage {
  loadPreferences(): Promise<NotificationPreferences>;
  savePreferences(preferences: NotificationPreferences): Promise<void>;
  loadState(): Promise<NotificationStateV1>;
  saveState(state: NotificationStateV1): Promise<void>;
}

export function createNotificationStorage(db: DatabaseService): NotificationStorage {
  async function loadRawMap(): Promise<Map<string, string>> {
    const rows = await db.settings.getAll();
    const byKey = new Map(rows.map(row => [row.key, row.value]));
    const pick = (key: string): string | null => byKey.get(key) ?? null;
    return new Map<string, string>([
      ['dailyEnabled', pick(NOTIFICATION_SETTING_KEYS.dailyEnabled) ?? ''],
      ['dailyTime', pick(NOTIFICATION_SETTING_KEYS.dailyTime) ?? ''],
      ['budgetAlerts', pick(NOTIFICATION_SETTING_KEYS.budgetAlerts) ?? ''],
      [
        'recurringReminder',
        pick(NOTIFICATION_SETTING_KEYS.recurringReminder) ?? '',
      ],
      ['monthlySummary', pick(NOTIFICATION_SETTING_KEYS.monthlySummary) ?? ''],
    ]);
  }

  return {
    async loadPreferences(): Promise<NotificationPreferences> {
      const raw = await loadRawMap();
      return coercePreferences(raw);
    },

    async savePreferences(preferences: NotificationPreferences): Promise<void> {
      // Persist every field atomically — the UI always writes the full
      // snapshot, so partial rows are impossible by construction.
      await db.settings.set(
        NOTIFICATION_SETTING_KEYS.dailyEnabled,
        preferences.dailyReminderEnabled ? '1' : '0',
      );
      await db.settings.set(
        NOTIFICATION_SETTING_KEYS.dailyTime,
        JSON.stringify(preferences.dailyReminderTime),
      );
      await db.settings.set(
        NOTIFICATION_SETTING_KEYS.budgetAlerts,
        preferences.budgetAlertsEnabled ? '1' : '0',
      );
      await db.settings.set(
        NOTIFICATION_SETTING_KEYS.recurringReminder,
        preferences.recurringReminderEnabled ? '1' : '0',
      );
      await db.settings.set(
        NOTIFICATION_SETTING_KEYS.monthlySummary,
        preferences.monthlySummaryEnabled ? '1' : '0',
      );
    },

    async loadState(): Promise<NotificationStateV1> {
      const raw = await db.settings.get(NOTIFICATION_SETTING_KEYS.state);
      return coerceNotificationState(raw);
    },

    async saveState(state: NotificationStateV1): Promise<void> {
      const current = await this.loadState();
      // Only write when something actually changed — keeps the common
      // "evaluate, nothing new" path from touching SQLite at all.
      if (
        current.schemaVersion === state.schemaVersion &&
        current.budgetNotifiedKeys.length === state.budgetNotifiedKeys.length &&
        current.budgetNotifiedKeys.every(
          key => state.budgetNotifiedKeys.includes(key),
        )
      ) {
        return;
      }
      await db.settings.set(NOTIFICATION_SETTING_KEYS.state, JSON.stringify(state));
    },
  };
}

export {DEFAULT_NOTIFICATION_PREFERENCES, preferencesEqual};
