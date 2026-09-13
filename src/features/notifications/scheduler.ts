import * as Notifications from 'expo-notifications';
import {Platform} from 'react-native';

import {formatCurrency} from '@/utils/format';

import {
  MONTHLY_SUMMARY_TIME,
  NOTIFICATION_IDS,
  RECURRING_REMINDER_TIME,
  budgetAlertId,
  recurringReminderId,
} from './config';
import {
  dailyReminderContent,
  monthlySummaryContent,
  recurringReminderContent,
  type NotificationContent,
} from './content';
import {recurringReminderAt} from './time';
import {
  NOTIFICATION_CHANNEL_ALERTS,
  NOTIFICATION_CHANNEL_REMINDERS,
  type NotificationPermissionStatus,
  type ReminderTime,
} from './types';

/**
 * The ONE module that talks to expo-notifications.
 *
 * Everything above this layer (service, hooks, orchestrator) stays free of
 * native-API details, and the whole scheduling behavior is testable by
 * mocking this module's single dependency.
 *
 * Duplicate prevention (spec §11) is enforced at THREE levels here:
 * 1. STABLE IDENTIFIERS — scheduling with the same identifier replaces the
 *    previous notification.
 * 2. CANCEL-BEFORE-SCHEDULE — every scheduling function first cancels its
 *    identifier, so re-syncs can never accumulate duplicates even if a
 *    native layer ignored a replace.
 * 3. ORPHAN SWEEPS — resync cancels any Kharcha-scheduled notification that
 *    no longer corresponds to live data (e.g. a deleted recurring rule).
 */

/** All Kharcha identifiers start with this — used for sweeps/cancelAll. */
const ID_PREFIX = 'kharcha.';
/** Sub-prefix of per-rule recurring reminders. */
const RECURRING_ID_PREFIX = 'kharcha.recurring-expense.';

function isKharchaId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

/**
 * One recurring-expense rule flattened for scheduling.
 */
export interface RecurringReminderScheduleItem {
  ruleId: number;
  ruleTitle: string;
  /** Minor units — formatted with `currencyCode` at schedule time. */
  amountMinor: number;
  /** Rule's next due occurrence (local noon epoch ms). */
  nextOccurrenceAt: number;
}

export interface ScheduledNotificationSnapshot {
  id: string;
}

export interface NotificationScheduler {
  ensureAndroidChannels(): Promise<void>;
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  requestPermission(): Promise<NotificationPermissionStatus>;

  scheduleDailyReminder(time: ReminderTime): Promise<void>;
  cancelDailyReminder(): Promise<void>;

  scheduleMonthlySummary(): Promise<void>;
  cancelMonthlySummary(): Promise<void>;

  /**
   * Replaces the whole recurring-reminder set with `items` (idempotent).
   * Any previously scheduled `kharcha.recurring-expense.*` notification
   * whose rule id is absent from `items` is cancelled.
   */
  syncRecurringReminders(
    items: RecurringReminderScheduleItem[],
    currencyCode: string,
    nowMs: number,
  ): Promise<void>;

  /**
   * Fires a budget alert immediately (banner when the app is open, tray
   * when not). `content.data.key` must carry the dedupe event key — it
   * becomes the stable OS identifier.
   */
  presentBudgetAlert(content: NotificationContent): Promise<void>;

  /** All currently scheduled Kharcha notification ids (diagnostics/sweeps). */
  listScheduledIds(): Promise<ScheduledNotificationSnapshot[]>;

  cancelAllKarchaNotifications(): Promise<void>;
}

function toPermissionStatus(
  granted: boolean,
  canAskAgain: boolean | null,
): NotificationPermissionStatus {
  if (granted) {
    return 'granted';
  }
  // canAskAgain null = the platform cannot report it; a non-granted,
  // non-askable state means the user (or the OS) permanently declined.
  return canAskAgain === false ? 'denied' : 'undetermined';
}

export function createNotificationScheduler(): NotificationScheduler {
  async function cancelById(identifier: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {
      // A missing schedule must never break the scheduling path.
    }
  }

  function formatAmountLabel(amountMinor: number, currencyCode: string): string {
    return formatCurrency(amountMinor, currencyCode);
  }

  return {
    async ensureAndroidChannels(): Promise<void> {
      if (Platform.OS !== 'android') {
        return;
      }
      try {
        await Notifications.setNotificationChannelAsync(
          NOTIFICATION_CHANNEL_REMINDERS,
          {
            name: 'Kharcha reminders',
            importance: Notifications.AndroidImportance.HIGH,
            description: 'Daily, recurring and monthly reminders',
          },
        );
        await Notifications.setNotificationChannelAsync(
          NOTIFICATION_CHANNEL_ALERTS,
          {
            name: 'Budget alerts',
            importance: Notifications.AndroidImportance.HIGH,
            description: 'Alerts when a budget is close to its limit',
          },
        );
      } catch {
        // Channels are an Android 8+ nicety; scheduling still works.
      }
    },

    async getPermissionStatus(): Promise<NotificationPermissionStatus> {
      try {
        const settings = await Notifications.getPermissionsAsync();
        return toPermissionStatus(
          settings.granted,
          settings.canAskAgain ?? null,
        );
      } catch {
        // No native module (Expo Go quirks, unsupported platform) — the
        // feature must degrade, never crash.
        return 'unsupported';
      }
    },

    async requestPermission(): Promise<NotificationPermissionStatus> {
      try {
        const settings = await Notifications.requestPermissionsAsync();
        return toPermissionStatus(
          settings.granted,
          settings.canAskAgain ?? null,
        );
      } catch {
        return 'unsupported';
      }
    },

    async scheduleDailyReminder(time: ReminderTime): Promise<void> {
      const content = dailyReminderContent();
      await cancelById(NOTIFICATION_IDS.dailyReminder);
      await Notifications.scheduleNotificationAsync({
        identifier: NOTIFICATION_IDS.dailyReminder,
        content: {
          title: content.title,
          body: content.body,
          sound: true,
          data: {...content.data},
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          channelId: NOTIFICATION_CHANNEL_REMINDERS,
          hour: time.hour,
          minute: time.minute,
        },
      });
    },

    async cancelDailyReminder(): Promise<void> {
      await cancelById(NOTIFICATION_IDS.dailyReminder);
    },

    async scheduleMonthlySummary(): Promise<void> {
      const content = monthlySummaryContent();
      await cancelById(NOTIFICATION_IDS.monthlySummary);
      await Notifications.scheduleNotificationAsync({
        identifier: NOTIFICATION_IDS.monthlySummary,
        content: {
          title: content.title,
          body: content.body,
          sound: true,
          data: {...content.data},
        },
        // Repeats on the 1st of every month; the OS resolves "next" in the
        // device timezone, so DST shifts and month lengths stay correct.
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
          channelId: NOTIFICATION_CHANNEL_REMINDERS,
          day: 1,
          hour: MONTHLY_SUMMARY_TIME.hour,
          minute: MONTHLY_SUMMARY_TIME.minute,
        },
      });
    },

    async cancelMonthlySummary(): Promise<void> {
      await cancelById(NOTIFICATION_IDS.monthlySummary);
    },

    async syncRecurringReminders(
      items: RecurringReminderScheduleItem[],
      currencyCode: string,
      nowMs: number,
    ): Promise<void> {
      const liveIds = new Set<string>();
      for (const item of items) {
        liveIds.add(recurringReminderId(item.ruleId));
      }

      // 1. Replace (cancel-first) every current rule's reminder.
      for (const item of items) {
        const identifier = recurringReminderId(item.ruleId);
        await cancelById(identifier);

        const reminderAt = recurringReminderAt(
          item.nextOccurrenceAt,
          RECURRING_REMINDER_TIME,
          nowMs,
        );
        if (reminderAt === null) {
          // The day-before reminder slot for this cycle already passed —
          // skip; the next sync picks up the rule's following occurrence.
          continue;
        }
        const content = recurringReminderContent(
          item.ruleTitle,
          formatAmountLabel(item.amountMinor, currencyCode),
        );
        try {
          await Notifications.scheduleNotificationAsync({
            identifier,
            content: {
              title: content.title,
              body: content.body,
              sound: true,
              data: {...content.data},
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              channelId: NOTIFICATION_CHANNEL_REMINDERS,
              date: reminderAt,
            },
          });
        } catch {
          // One bad rule must not abort the rest of the sync.
        }
      }

      // 2. Orphan sweep: rules deleted/paused/type-changed since the last
      //    sync must stop ringing.
      const scheduled = await this.listScheduledIds();
      for (const {id} of scheduled) {
        if (id.startsWith(RECURRING_ID_PREFIX) && !liveIds.has(id)) {
          await cancelById(id);
        }
      }
    },

    async presentBudgetAlert(content: NotificationContent): Promise<void> {
      // trigger: null → deliver immediately. Shows as a banner while the
      // app is open and lands in the tray when the app is backgrounded.
      await Notifications.scheduleNotificationAsync({
        identifier: budgetAlertId(eventKeyOf(content)),
        content: {
          title: content.title,
          body: content.body,
          sound: true,
          data: {...content.data},
        },
        trigger: null,
      });
    },

    async listScheduledIds(): Promise<ScheduledNotificationSnapshot[]> {
      try {
        const scheduled =
          await Notifications.getAllScheduledNotificationsAsync();
        return scheduled
          .map(item => item.identifier)
          .filter(isKharchaId)
          .map(id => ({id}));
      } catch {
        return [];
      }
    },

    async cancelAllKarchaNotifications(): Promise<void> {
      const scheduled = await this.listScheduledIds();
      for (const {id} of scheduled) {
        await cancelById(id);
      }
    },
  };
}

/** Extracts the dedupe key embedded in the alert's data payload. */
function eventKeyOf(content: NotificationContent): string {
  const key = (content.data as {key?: string} | undefined)?.key;
  return typeof key === 'string' && key.length > 0 ? key : 'adhoc';
}
