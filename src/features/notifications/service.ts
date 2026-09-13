import {DEFAULT_CURRENCY, isSupportedCurrency} from '@/store/settingsStore';
import type {DatabaseService} from '@/database/service';
import {createBudgetFeature} from '@/features/budgets/service';

import {evaluateBudgetSnapshot} from './budgetThresholds';
import {budgetAlertContent} from './content';
import type {
  NotificationScheduler,
  RecurringReminderScheduleItem,
} from './scheduler';
import {createNotificationScheduler} from './scheduler';
import {createNotificationStorage, type NotificationStorage} from './storage';
import {periodKeyFor} from './time';
import type {
  NotificationPermissionStatus,
  NotificationPreferences,
  ReminderTime,
} from './types';

/**
 * Feature-level service for Smart Notifications.
 *
 * Contract style matches every other Kharcha feature: injectable
 * `DatabaseService` + injectable scheduler (for tests), business logic
 * outside React, SQLite as the single source of truth for preferences.
 *
 * Financial math is NEVER duplicated: budget statuses come from the budget
 * feature's own `getMonthSnapshot` (the same numbers the Budget screen
 * renders), recurring due dates from the rules' stored `nextOccurrenceAt`
 * (maintained by the existing generation engine).
 *
 * All scheduler failures are swallowed at this boundary — a notification
 * problem can never surface as an app error.
 */
export interface NotificationFeature {
  loadPreferences(): Promise<NotificationPreferences>;
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  /** Only ever called from an explicit user gesture in Settings. */
  requestPermission(): Promise<NotificationPermissionStatus>;

  /** Toggle + (re)schedule the daily reminder in one step. */
  setDailyReminder(enabled: boolean, time?: ReminderTime): Promise<NotificationPreferences>;
  setBudgetAlerts(enabled: boolean): Promise<NotificationPreferences>;
  setRecurringReminder(enabled: boolean): Promise<NotificationPreferences>;
  setMonthlySummary(enabled: boolean): Promise<NotificationPreferences>;

  /**
   * Full idempotent resync of every schedule from current preferences +
   * live data. Safe to call on EVERY launch/foreground — this is the
   * duplicate-prevention backbone (cancel-with-stable-id → replace).
   */
  syncAll(nowMs?: number): Promise<void>;

  /**
   * Budget-only evaluation (cheap; runs on the active-app cadence and
   * right after enabling Budget Alerts). Presents at most one notification
   * per (period, budget scope) and latches it durably.
   */
  evaluateBudgetAlerts(nowMs?: number): Promise<number>;
}

export function createNotificationFeature(
  db: DatabaseService,
  scheduler: NotificationScheduler = createNotificationScheduler(),
  storage: NotificationStorage = createNotificationStorage(db),
): NotificationFeature {
  async function currencyCode(): Promise<string> {
    try {
      const stored = await db.settings.get('currency');
      return stored !== null && isSupportedCurrency(stored)
        ? stored
        : DEFAULT_CURRENCY;
    } catch {
      return DEFAULT_CURRENCY;
    }
  }

  async function activeRecurringItems(
    nowMs: number,
  ): Promise<RecurringReminderScheduleItem[]> {
    try {
      const rules = await db.recurring.list({
        type: 'expense',
        isActive: true,
      });
      // Only rules with a real upcoming occurrence get a reminder; the
      // generation engine keeps `nextOccurrenceAt` current even across
      // month lengths and month-end clamping.
      return rules
        .filter(
          rule =>
            rule.nextOccurrenceAt > nowMs &&
            (rule.endDate === null || rule.endDate >= rule.nextOccurrenceAt),
        )
        .map(rule => ({
          ruleId: rule.id,
          ruleTitle: rule.title,
          amountMinor: rule.amount,
          nextOccurrenceAt: rule.nextOccurrenceAt,
        }));
    } catch {
      return [];
    }
  }

  return {
    loadPreferences() {
      return storage.loadPreferences();
    },

    getPermissionStatus() {
      return scheduler.getPermissionStatus();
    },

    requestPermission() {
      return scheduler.requestPermission();
    },

    async setDailyReminder(enabled, time) {
      const current = await storage.loadPreferences();
      const next: NotificationPreferences = {
        ...current,
        dailyReminderEnabled: enabled,
        dailyReminderTime: time ?? current.dailyReminderTime,
      };
      await storage.savePreferences(next);
      // Changing the time or toggling OFF replaces/cancels the stable
      // schedule — no duplicates, no stale time (spec §2).
      try {
        if (enabled) {
          await scheduler.ensureAndroidChannels();
          await scheduler.scheduleDailyReminder(next.dailyReminderTime);
        } else {
          await scheduler.cancelDailyReminder();
        }
      } catch {
        // Preference stays saved; next launch sync retries the schedule.
      }
      return next;
    },

    async setBudgetAlerts(enabled) {
      const current = await storage.loadPreferences();
      const next = {...current, budgetAlertsEnabled: enabled};
      await storage.savePreferences(next);
      if (enabled) {
        // Immediate feedback when the current status already crossed a
        // threshold; otherwise this is a cheap no-op (dedupe via latch).
        await this.evaluateBudgetAlerts().catch(() => undefined);
      }
      return next;
    },

    async setRecurringReminder(enabled) {
      const current = await storage.loadPreferences();
      const next = {...current, recurringReminderEnabled: enabled};
      await storage.savePreferences(next);
      try {
        await scheduler.ensureAndroidChannels();
        if (enabled) {
          await scheduler.syncRecurringReminders(
            await activeRecurringItems(Date.now()),
            await currencyCode(),
            Date.now(),
          );
        } else {
          // Empty set → schedules nothing and sweeps every rule reminder.
          await scheduler.syncRecurringReminders([], await currencyCode(), Date.now());
        }
      } catch {
        // Saved; retried by the next sync.
      }
      return next;
    },

    async setMonthlySummary(enabled) {
      const current = await storage.loadPreferences();
      const next = {...current, monthlySummaryEnabled: enabled};
      await storage.savePreferences(next);
      try {
        await scheduler.ensureAndroidChannels();
        if (enabled) {
          await scheduler.scheduleMonthlySummary();
        } else {
          await scheduler.cancelMonthlySummary();
        }
      } catch {
        // Saved; retried by the next sync.
      }
      return next;
    },

    async syncAll(nowMs = Date.now()) {
      try {
        const preferences = await storage.loadPreferences();
        await scheduler.ensureAndroidChannels();

        // Every branch is replace-by-stable-id or cancel — re-running this
        // on every launch/foreground can never duplicate anything (§11).
        if (preferences.dailyReminderEnabled) {
          await scheduler.scheduleDailyReminder(preferences.dailyReminderTime);
        } else {
          await scheduler.cancelDailyReminder();
        }

        if (preferences.monthlySummaryEnabled) {
          await scheduler.scheduleMonthlySummary();
        } else {
          await scheduler.cancelMonthlySummary();
        }

        await scheduler.syncRecurringReminders(
          preferences.recurringReminderEnabled
            ? await activeRecurringItems(nowMs)
            : [],
          await currencyCode(),
          nowMs,
        );

        if (preferences.budgetAlertsEnabled) {
          await this.evaluateBudgetAlerts(nowMs).catch(() => undefined);
        }
      } catch {
        // Never let a sync failure reach the UI.
      }
    },

    async evaluateBudgetAlerts(nowMs = Date.now()): Promise<number> {
      try {
        const preferences = await storage.loadPreferences();
        if (!preferences.budgetAlertsEnabled) {
          return 0;
        }

        const state = await storage.loadState();
        const periodKey = periodKeyFor(nowMs);
        const snapshot = await createBudgetFeature(db).getMonthSnapshot(
          new Date(nowMs).getFullYear(),
          new Date(nowMs).getMonth() + 1,
        );
        const result = evaluateBudgetSnapshot(snapshot, periodKey, state);

        const currency = await currencyCode();
        for (const event of result.events) {
          // Fire-and-forget per event: one OS failure must not block the
          // others or the latch write.
          await scheduler
            .presentBudgetAlert(budgetAlertContent(event, currency))
            .catch(() => undefined);
        }

        if (result.nextLatchKeys.length !== state.budgetNotifiedKeys.length ||
          result.nextLatchKeys.some(
            key => !state.budgetNotifiedKeys.includes(key),
          )) {
          await storage.saveState({
            schemaVersion: 1,
            budgetNotifiedKeys: result.nextLatchKeys,
          });
        }
        return result.events.length;
      } catch {
        return 0;
      }
    },
  };
}

// Convenience re-exports for the orchestrator/hooks.
export {createNotificationScheduler} from './scheduler';
export type {NotificationScheduler} from './scheduler';
export {createNotificationStorage} from './storage';
