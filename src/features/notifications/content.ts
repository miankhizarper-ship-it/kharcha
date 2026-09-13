import {formatCurrency} from '@/utils/format';

import type {
  BudgetThreshold,
  BudgetThresholdEvent,
  NotificationData,
  NotificationRouteTarget,
} from './types';

/**
 * Pure notification content builders — titles, bodies and tap payloads.
 *
 * No database, no React, no expo-notifications: the scheduler serializes
 * whatever these return. Money is formatted with the app's ONE canonical
 * formatter (`utils/format.formatCurrency`) so notification text matches
 * what every screen shows.
 */

/** Shape handed to expo-notifications for every Kharcha notification. */
export interface NotificationContent {
  title: string;
  body: string;
  data: NotificationData;
}

function build(
  title: string,
  body: string,
  target: NotificationRouteTarget,
): NotificationContent {
  return {title, body, data: {target}};
}

/** "Daily Spending Reminder" — spec §2 copy, tap → Add Expense. */
export function dailyReminderContent(): NotificationContent {
  return build(
    'Daily Spending Reminder',
    "Don't forget to record today's expenses.",
    'AddExpense',
  );
}

/**
 * Monthly summary — repeats on the 1st of every month at
 * `MONTHLY_SUMMARY_TIME` (local), so the body stays generic: the numbers
 * are never computed here (spec §5: avoid background database work when
 * the app may be closed). Tap → Reports tab (the existing analytics
 * screen).
 */
export function monthlySummaryContent(): NotificationContent {
  return build(
    'Your Monthly Summary is Ready 📊',
    'See your income, expenses and savings for last month.',
    'Tabs:Reports',
  );
}

/**
 * "Upcoming Expense" — spec §4 copy. `amountMinor` is minor units;
 * `amountLabel` arrives already formatted. Tap → Recurring screen.
 */
export function recurringReminderContent(
  ruleTitle: string,
  amountLabel: string,
): NotificationContent {
  return build(
    'Upcoming Expense',
    `${ruleTitle} of ${amountLabel} is due tomorrow.`,
    'Recurring',
  );
}

function budgetDisplayName(name: string): string {
  return name.trim().length > 0 ? name.trim() : 'budget';
}

/**
 * Threshold copy (spec §3 examples):
 * - 80%      → "Food budget is 80% used."
 * - 90%      → "Only Rs. 1,000 left in your Food budget."
 * - exceeded → "Your Food budget has been exceeded."
 */
export function budgetAlertContent(
  event: BudgetThresholdEvent,
  currency: string,
): NotificationContent {
  const name = budgetDisplayName(event.budgetName);
  const isOverall = event.scopeKey === 'overall';
  const subject = isOverall ? 'monthly budget' : `${name} budget`;

  let body: string;
  switch (event.threshold) {
    case 'warning80':
      body = `${isOverall ? 'Your monthly budget is' : `${name} budget is`} 80% used.`;
      break;
    case 'warning90':
      body = `Only ${formatCurrency(event.remaining, currency)} left in your ${subject}.`;
      break;
    case 'exceeded':
      body = `Your ${subject} has been exceeded.`;
      break;
  }

  return {
    title: budgetAlertTitle(event.threshold),
    body,
    data: {
      target: 'Budgets',
      // Dedupe identity → becomes the stable OS notification id.
      key: event.eventKey,
    },
  };
}

function budgetAlertTitle(threshold: BudgetThreshold): string {
  switch (threshold) {
    case 'exceeded':
      return 'Budget Exceeded';
    case 'warning90':
      return 'Budget Almost Finished';
    default:
      return 'Budget Reminder';
  }
}
