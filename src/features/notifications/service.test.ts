/**
 * @jest-environment node
 */
import type {DatabaseService} from '@/database/service';
import {createTestService} from '@/database/testing/helpers';

import {createNotificationFeature} from './service';

/**
 * Service-level integration tests: REAL SQLite (preferences + budgets +
 * recurring rules) against a MOCKED scheduler, proving:
 * - settings persistence drives scheduling calls
 * - toggling OFF cancels
 * - budget alerts fire once per period from REAL expense data (spec §3)
 * - recurring reminders track the live rules, sweeping paused/deleted ones
 */

const mockScheduler = {
  ensureAndroidChannels: jest.fn().mockResolvedValue(undefined),
  getPermissionStatus: jest.fn().mockResolvedValue('granted'),
  requestPermission: jest.fn().mockResolvedValue('granted'),
  scheduleDailyReminder: jest.fn().mockResolvedValue(undefined),
  cancelDailyReminder: jest.fn().mockResolvedValue(undefined),
  scheduleMonthlySummary: jest.fn().mockResolvedValue(undefined),
  cancelMonthlySummary: jest.fn().mockResolvedValue(undefined),
  syncRecurringReminders: jest.fn().mockResolvedValue(undefined),
  presentBudgetAlert: jest.fn().mockResolvedValue(undefined),
  listScheduledIds: jest.fn().mockResolvedValue([]),
  cancelAllKarchaNotifications: jest.fn().mockResolvedValue(undefined),
};

jest.mock('./scheduler', () => ({
  createNotificationScheduler: () => mockScheduler,
  __esModule: true,
}));

// "Now" pinned inside a fixed month so fixtures are deterministic:
// September 20, 2026, local time.
const NOW = new Date(2026, 8, 20, 12, 0).getTime();
const SEP = {month: 9, year: 2026};

async function createCategory(service: DatabaseService, name: string) {
  return service.categories.create({name, icon: 'tag', type: 'expense'});
}

async function createExpenseInSeptember(
  service: DatabaseService,
  categoryId: number,
  amountMinor: number,
) {
  return service.expenses.create({
    amount: amountMinor,
    title: 'Fixture expense',
    categoryId,
    date: new Date(2026, 8, 10, 12, 0).getTime(), // Sep 10, 2026 local noon
    paymentMethod: 'cash',
  });
}

describe('notification feature (settings persistence + scheduling)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScheduler.getPermissionStatus.mockResolvedValue('granted');
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('loads defaults before anything is configured', async () => {
    const feature = createNotificationFeature(service, mockScheduler);
    const preferences = await feature.loadPreferences();
    expect(preferences).toEqual({
      dailyReminderEnabled: false,
      dailyReminderTime: {hour: 20, minute: 0},
      budgetAlertsEnabled: false,
      recurringReminderEnabled: false,
      monthlySummaryEnabled: false,
    });
  });

  it('enabling the daily reminder persists and schedules once', async () => {
    const feature = createNotificationFeature(service, mockScheduler);
    const updated = await feature.setDailyReminder(true, {hour: 21, minute: 30});

    expect(updated.dailyReminderEnabled).toBe(true);
    expect(updated.dailyReminderTime).toEqual({hour: 21, minute: 30});
    expect(mockScheduler.scheduleDailyReminder).toHaveBeenCalledTimes(1);
    expect(mockScheduler.scheduleDailyReminder).toHaveBeenCalledWith({
      hour: 21,
      minute: 30,
    });
    // Persistence is authoritative — a fresh feature sees the same prefs.
    const reloaded = await createNotificationFeature(
      service,
      mockScheduler,
    ).loadPreferences();
    expect(reloaded.dailyReminderEnabled).toBe(true);
    expect(reloaded.dailyReminderTime).toEqual({hour: 21, minute: 30});
  });

  it('disabling the daily reminder cancels the schedule', async () => {
    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setDailyReminder(true);
    await feature.setDailyReminder(false);

    expect(mockScheduler.cancelDailyReminder).toHaveBeenCalledTimes(1);
    expect(
      (await feature.loadPreferences()).dailyReminderEnabled,
    ).toBe(false);
  });

  it('monthly summary schedules on enable and cancels on disable', async () => {
    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setMonthlySummary(true);
    expect(mockScheduler.scheduleMonthlySummary).toHaveBeenCalledTimes(1);

    await feature.setMonthlySummary(false);
    expect(mockScheduler.cancelMonthlySummary).toHaveBeenCalledTimes(1);
  });

  it('toggling budget alerts OFF never touches the scheduler', async () => {
    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setBudgetAlerts(false);
    expect(mockScheduler.presentBudgetAlert).not.toHaveBeenCalled();
  });
});

describe('budget alert evaluation against real expense data (spec §3)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScheduler.getPermissionStatus.mockResolvedValue('granted');
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('fires once at 80% of a category budget and never again that period', async () => {
    const category = await createCategory(service, 'Food');
    // Budget 1,000.00; spent 850.00 → 85%.
    await service.budgets.create({
      categoryId: category.id,
      amount: 100_000,
      ...SEP,
    });
    await createExpenseInSeptember(service, category.id, 85_000);

    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setBudgetAlerts(true); // evaluates immediately

    expect(mockScheduler.presentBudgetAlert).toHaveBeenCalledTimes(1);
    const content = mockScheduler.presentBudgetAlert.mock.calls[0][0];
    expect(content.body).toBe('Food budget is 80% used.');
    expect(content.data.key).toBe(
      `2026-09|category:${category.id}|warning80`,
    );

    // Repeat sync/evaluations in the same period stay silent (spec §3/§11).
    await feature.syncAll(NOW);
    await feature.evaluateBudgetAlerts(NOW);
    expect(mockScheduler.presentBudgetAlert).toHaveBeenCalledTimes(1);

    // Deleting the expense drops the spend — still silent (latched).
    const expenses = await service.expenses.list({
      fromDate: new Date(2026, 8, 1).getTime(),
      toDate: new Date(2026, 8, 30, 23, 59, 59, 999).getTime(),
    });
    for (const expense of expenses) {
      await service.expenses.delete(expense.id);
    }
    await feature.evaluateBudgetAlerts(NOW);
    expect(mockScheduler.presentBudgetAlert).toHaveBeenCalledTimes(1);
  });

  it('announces only the most severe threshold on a jump to 95%', async () => {
    const category = await createCategory(service, 'Fuel');
    await service.budgets.create({
      categoryId: category.id,
      amount: 100_000,
      ...SEP,
    });
    await createExpenseInSeptember(service, category.id, 95_000);

    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setBudgetAlerts(true);

    expect(mockScheduler.presentBudgetAlert).toHaveBeenCalledTimes(1);
    const content = mockScheduler.presentBudgetAlert.mock.calls[0][0];
    expect(content.title).toBe('Budget Almost Finished');
    expect(content.body).toContain('Only');
    expect(content.body).toContain('left in your Fuel budget');
  });

  it('alerts again in a NEW budget period (latch resets)', async () => {
    const category = await createCategory(service, 'Food');
    await service.budgets.create({
      categoryId: category.id,
      amount: 100_000,
      ...SEP,
    });
    await createExpenseInSeptember(service, category.id, 85_000);

    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setBudgetAlerts(true);
    expect(mockScheduler.presentBudgetAlert).toHaveBeenCalledTimes(1);

    // October: same 85% situation → new period → one fresh alert.
    await service.budgets.upsert({
      categoryId: category.id,
      amount: 100_000,
      month: 10,
      year: 2026,
    });
    await service.expenses.create({
      amount: 85_000,
      title: 'October spend',
      categoryId: category.id,
      date: new Date(2026, 9, 10, 12, 0).getTime(),
      paymentMethod: 'cash',
    });

    const OCTOBER = new Date(2026, 9, 20, 12, 0).getTime();
    await feature.evaluateBudgetAlerts(OCTOBER);
    expect(mockScheduler.presentBudgetAlert).toHaveBeenCalledTimes(2);
    const second = mockScheduler.presentBudgetAlert.mock.calls[1][0];
    expect(second.data.key).toBe(
      `2026-10|category:${category.id}|warning80`,
    );
  });

  it('respects the OFF setting: no evaluation at all', async () => {
    const category = await createCategory(service, 'Food');
    await service.budgets.create({
      categoryId: category.id,
      amount: 100_000,
      ...SEP,
    });
    await createExpenseInSeptember(service, category.id, 95_000);

    const feature = createNotificationFeature(service, mockScheduler);
    // syncAll with budget alerts OFF must not evaluate or notify.
    await feature.syncAll(NOW);
    expect(mockScheduler.presentBudgetAlert).not.toHaveBeenCalled();
  });
});

describe('recurring reminder integration (spec §4)', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScheduler.getPermissionStatus.mockResolvedValue('granted');
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  async function createMonthlyRule(
    service: DatabaseService,
    overrides: {title?: string; amount?: number; dayOfMonth?: number} = {},
  ) {
    const category = await createCategory(service, 'Bills');
    const due = new Date(
      2026,
      9,
      overrides.dayOfMonth ?? 15,
      12,
      0,
      0,
      0,
    ).getTime(); // future due occurrence (local noon)
    return service.recurring.create({
      type: 'expense',
      title: overrides.title ?? 'Internet Bill',
      amount: overrides.amount ?? 250_000,
      categoryId: category.id,
      frequency: 'monthly',
      startDate: due,
      nextOccurrenceAt: due,
      paymentMethod: 'cash',
    });
  }

  it('schedules one reminder per active expense rule', async () => {
    const rule = await createMonthlyRule(service);
    const feature = createNotificationFeature(service, mockScheduler);

    await feature.setRecurringReminder(true);

    expect(mockScheduler.syncRecurringReminders).toHaveBeenCalledTimes(1);
    const items = mockScheduler.syncRecurringReminders.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0].ruleId).toBe(rule.id);
    expect(items[0].ruleTitle).toBe('Internet Bill');
    expect(items[0].amountMinor).toBe(250_000);
  });

  it('idempotent resyncs never duplicate the schedule set', async () => {
    await createMonthlyRule(service);
    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setRecurringReminder(true);

    // Every launch/foreground sync sends exactly the same live set.
    await feature.syncAll(NOW);
    await feature.syncAll(NOW);

    const lastCall =
      mockScheduler.syncRecurringReminders.mock.calls[
        mockScheduler.syncRecurringReminders.mock.calls.length - 1
      ];
    expect(lastCall[0]).toHaveLength(1);
    // The scheduler layer is cancel-before-schedule per stable id (its own
    // tests pin that), so repeated identical sets cannot accumulate.
  });

  it('paused or deleted rules are swept from the schedule', async () => {
    const rule = await createMonthlyRule(service);
    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setRecurringReminder(true);
    expect(mockScheduler.syncRecurringReminders.mock.calls[0][0]).toHaveLength(1);

    await service.recurring.setActive(rule.id, false);
    await feature.syncAll(NOW);

    const lastCall =
      mockScheduler.syncRecurringReminders.mock.calls[
        mockScheduler.syncRecurringReminders.mock.calls.length - 1
      ];
    expect(lastCall[0]).toHaveLength(0); // → scheduler sweeps the orphan
  });

  it('income rules never generate reminders', async () => {
    // NOT "Salary" — the seeded default income categories occupy that name
    // (categories are UNIQUE per name+type).
    await service.categories.create({
      name: 'Consulting Fee',
      icon: 'laptop',
      type: 'income',
    });
    await service.recurring.create({
      type: 'income',
      title: 'Monthly Consulting',
      amount: 500_000,
      frequency: 'monthly',
      startDate: new Date(2026, 9, 1, 12, 0).getTime(),
      nextOccurrenceAt: new Date(2026, 9, 1, 12, 0).getTime(),
    });

    const feature = createNotificationFeature(service, mockScheduler);
    await feature.setRecurringReminder(true);
    expect(mockScheduler.syncRecurringReminders.mock.calls[0][0]).toHaveLength(0);
  });
});
