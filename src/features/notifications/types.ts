/**
 * UI-facing and internal models for the Smart Notifications feature.
 *
 * Everything is LOCAL: preferences live in the existing `settings` SQLite
 * key/value table (same persistence as theme/currency — see
 * `src/features/settings/service.ts`), schedules live in the OS notification
 * scheduler (expo-notifications), and there is no server, no Firebase and no
 * network dependency anywhere in this feature.
 */

/** Hour/minute on the user's LOCAL clock (device timezone, DST respected —
 * the OS re-resolves "next occurrence" in local time for repeating triggers). */
export interface ReminderTime {
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
}

/** The persisted notification preferences (spec §9). */
export interface NotificationPreferences {
  /** Daily "record today's expenses" reminder. */
  dailyReminderEnabled: boolean;
  /** Local time of the daily reminder. */
  dailyReminderTime: ReminderTime;
  /** Budget threshold alerts (80% / 90% / exceeded). */
  budgetAlertsEnabled: boolean;
  /** Reminders for upcoming recurring-expense rules. */
  recurringReminderEnabled: boolean;
  /** Monthly summary notification. */
  monthlySummaryEnabled: boolean;
}

/** Defaults: everything OFF so no notification is ever a surprise and the
 * permission prompt happens exactly once, at the moment the user opts in. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  dailyReminderEnabled: false,
  dailyReminderTime: {hour: 20, minute: 0},
  budgetAlertsEnabled: false,
  recurringReminderEnabled: false,
  monthlySummaryEnabled: false,
};

/**
 * Coarse permission status surfaced to the settings UI. Maps the richer
 * expo-notifications permission response down to what the screen needs.
 */
export type NotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unsupported';

/** Stable semantic names for the OS notification channels (Android 8+). */
export const NOTIFICATION_CHANNEL_REMINDERS = 'kharcha-reminders';
export const NOTIFICATION_CHANNEL_ALERTS = 'kharcha-budget-alerts';

/**
 * Where a notification tap should land. These are `RootStackParamList` route
 * names plus the Reports TAB (reached as the nested `Tabs` → `Reports`).
 * The tap handler maps unknown/absent payloads to a safe no-op fallback.
 */
export type NotificationRouteTarget =
  | 'AddExpense'
  | 'Budgets'
  | 'Recurring'
  | 'Tabs:Reports';

/** Payload embedded in every notification this feature schedules. */
export interface NotificationData {
  target: NotificationRouteTarget;
  /** Optional dedupe identity (used by budget alerts as the OS id). */
  key?: string;
}

/**
 * One detected budget threshold crossing. Pure data — the evaluator in
 * `budgetThresholds.ts` produces these, the service presents + latches them.
 */
export interface BudgetThresholdEvent {
  /** Latch key, unique per (period, scope, threshold) — dedupe backbone. */
  eventKey: string;
  /** 'overall' or `category:<categoryId>` — survives budget re-creation. */
  scopeKey: string;
  /** Human budget name for the message ("Food", or "Monthly" overall). */
  budgetName: string;
  /** 'warning80' | 'warning90' | 'exceeded' */
  threshold: BudgetThreshold;
  /** Spent at evaluation time (minor units) — for the message. */
  spent: number;
  /** Remaining (negative once exceeded) in minor units. */
  remaining: number;
}

export type BudgetThreshold = 'warning80' | 'warning90' | 'exceeded';

/**
 * Durable, JSON-serialized dedupe state (spec §3/§9): which budget
 * threshold notifications were already delivered for which period. The
 * period key is part of every entry, so a new month naturally starts
 * clean; old entries are pruned on every write.
 */
export interface NotificationStateV1 {
  schemaVersion: 1;
  /** Latched event keys for the CURRENT evaluation period only. */
  budgetNotifiedKeys: string[];
}
