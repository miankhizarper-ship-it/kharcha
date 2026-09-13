/**
 * @jest-environment node
 */
import {
  budgetAlertContent,
  dailyReminderContent,
  monthlySummaryContent,
  recurringReminderContent,
} from './content';
import {formatCurrency} from '@/utils/format';
import type {BudgetThresholdEvent} from './types';

describe('dailyReminderContent', () => {
  it('uses the spec copy and targets the Add Expense screen', () => {
    expect(dailyReminderContent()).toEqual({
      title: 'Daily Spending Reminder',
      body: "Don't forget to record today's expenses.",
      data: {target: 'AddExpense'},
    });
  });
});

describe('monthlySummaryContent', () => {
  it('targets the Reports tab and avoids database-derived numbers', () => {
    const content = monthlySummaryContent();
    expect(content.title).toBe('Your Monthly Summary is Ready 📊');
    expect(content.data.target).toBe('Tabs:Reports');
  });
});

describe('recurringReminderContent', () => {
  it('formats the spec example with the shared currency formatter', () => {
    const content = recurringReminderContent(
      'Internet Bill',
      formatCurrency(250_000, 'PKR'),
    );
    expect(content.title).toBe('Upcoming Expense');
    expect(content.body).toContain('Internet Bill');
    expect(content.body).toContain('is due tomorrow.');
    expect(content.body).toContain(formatCurrency(250_000, 'PKR'));
    expect(content.data.target).toBe('Recurring');
  });
});

function event(overrides: Partial<BudgetThresholdEvent>): BudgetThresholdEvent {
  return {
    eventKey: '2026-09|category:7|warning80',
    scopeKey: 'category:7',
    budgetName: 'Food',
    threshold: 'warning80',
    spent: 80_000,
    remaining: 20_000,
    ...overrides,
  };
}

describe('budgetAlertContent', () => {
  it('80%: "\u2026 is 80% used." for a category budget', () => {
    const content = budgetAlertContent(event({}), 'PKR');
    expect(content.title).toBe('Budget Reminder');
    expect(content.body).toBe('Food budget is 80% used.');
    expect(content.data.target).toBe('Budgets');
    // The dedupe key rides in the payload → stable OS identifier.
    expect(content.data.key).toBe('2026-09|category:7|warning80');
  });

  it('90%: "Only \u2026 left in your \u2026 budget."', () => {
    const content = budgetAlertContent(
      event({threshold: 'warning90', remaining: 100_000}),
      'PKR',
    );
    expect(content.title).toBe('Budget Almost Finished');
    expect(content.body).toBe(
      `Only ${formatCurrency(100_000, 'PKR')} left in your Food budget.`,
    );
  });

  it('100%: "\u2026 has been exceeded."', () => {
    const content = budgetAlertContent(
      event({threshold: 'exceeded', remaining: -5_000}),
      'PKR',
    );
    expect(content.title).toBe('Budget Exceeded');
    expect(content.body).toBe('Your Food budget has been exceeded.');
  });

  it('overall budget copy uses the "monthly budget" subject', () => {
    const overall = event({
      scopeKey: 'overall',
      budgetName: 'Monthly',
      threshold: 'exceeded',
    });
    expect(budgetAlertContent(overall, 'PKR').body).toBe(
      'Your monthly budget has been exceeded.',
    );
  });

  it('falls back to a generic subject for blank category names', () => {
    const blank = event({budgetName: '   '});
    expect(budgetAlertContent(blank, 'PKR').body).toBe(
      'budget budget is 80% used.',
    );
  });
});
