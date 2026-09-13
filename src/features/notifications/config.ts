import type {ReminderTime} from './types';

/**
 * Central configuration for the Smart Notifications feature: stable
 * identifiers, SQLite keys, defaults and timing constants. Nothing here
 * imports React, expo-notifications or the database — pure constants.
 */

/**
 * STABLE notification identifiers (spec §1/§11 — duplicate prevention).
 *
 * Scheduling with the same identifier REPLACES the previous notification in
 * the OS scheduler, and this feature additionally cancels before scheduling,
 * so re-opening the app / re-visiting settings can never pile up duplicates.
 */
export const NOTIFICATION_IDS = {
  /** The repeating "record today's expenses" reminder — one at a time. */
  dailyReminder: 'kharcha.daily-spending-reminder',
  /** The repeating monthly summary — one at a time. */
  monthlySummary: 'kharcha.monthly-summary',
} as const;

/** One scheduled reminder per recurring-expense rule (cancelled when the
 * rule is deleted, paused or changed). */
export function recurringReminderId(ruleId: number): string {
  return `kharcha.recurring-expense.${ruleId}`;
}

/**
 * Identifier for one budget alert. Unique per (period, scope, threshold):
 * the OS-level id mirrors the persisted latch key, so even a delivered-
 * but-latched race can never produce a visible duplicate.
 */
export function budgetAlertId(eventKey: string): string {
  return `kharcha.budget.${eventKey}`;
}

/**
 * SQLite `settings`-table keys (spec §9). Same key/value persistence the
 * settings feature uses — no new storage library, no schema migration.
 * Values are strings; structured values are JSON (SettingsRepository's
 * documented convention).
 */
export const NOTIFICATION_SETTING_KEYS = {
  dailyEnabled: 'notification.daily.enabled',
  dailyTime: 'notification.daily.time',
  budgetAlerts: 'notification.budget.alerts',
  recurringReminder: 'notification.recurring.reminder',
  monthlySummary: 'notification.monthly.summary',
  /** JSON `NotificationStateV1` — delivered-threshold latch, schema versioned. */
  state: 'notification.state.v1',
} as const;

/** Default daily reminder time — 8:00 PM (spec §1 example). */
export const DEFAULT_DAILY_REMINDER_TIME: ReminderTime = {hour: 20, minute: 0};

/** Default local time-of-day for the monthly summary (1st of the month). */
export const MONTHLY_SUMMARY_TIME: ReminderTime = {hour: 19, minute: 0};

/**
 * Recurring-expense reminders fire at this LOCAL time on the calendar day
 * before the rule's next occurrence ("due tomorrow" wording is exact).
 */
export const RECURRING_REMINDER_TIME: ReminderTime = {hour: 18, minute: 0};

/**
 * Budget evaluation cadence WHILE the app is open (ms). The evaluation is a
 * couple of indexed SQLite reads; running it once a minute keeps alerts
 * near-instant after add/edit/delete without any background service.
 */
export const BUDGET_EVALUATION_INTERVAL_MS = 60_000;

/**
 * How long the launch-time sync waits before touching the scheduler, so the
 * feature never competes with app startup (same pattern as the update
 * check's 2.5 s delay).
 */
export const NOTIFICATION_SYNC_DELAY_MS = 3_000;

/**
 * Safety cap for the recurring resync loop — a pathological clock/row must
 * not spin the "advance past now" loop forever.
 */
export const RECURRING_RESYNC_MAX_ADVANCES = 400;

/** Valid ranges, mirrored by validation.ts. */
export const HOUR_MIN = 0;
export const HOUR_MAX = 23;
export const MINUTE_MIN = 0;
export const MINUTE_MAX = 59;
