/**
 * @jest-environment node
 */
import * as Notifications from 'expo-notifications';

import {createNotificationScheduler} from './scheduler';
import {NOTIFICATION_IDS, recurringReminderId} from './config';

/**
 * The expo-notifications native module is fully mocked — these tests pin
 * the DUPLICATE-PREVENTION CONTRACT (spec §11): stable identifiers, cancel-
 * before-schedule, orphan sweeps and OS-level budget-alert dedupe.
 */
jest.mock('expo-notifications', () => ({
  AndroidImportance: {DEFAULT: 5, HIGH: 6},
  SchedulableTriggerInputTypes: {
    CALENDAR: 'calendar',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
    DATE: 'date',
    TIME_INTERVAL: 'timeInterval',
  },
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn().mockResolvedValue({
    granted: false,
    canAskAgain: true,
  }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({
    granted: true,
    canAskAgain: true,
  }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('scheduled'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('react-native', () => ({Platform: {OS: 'android'}}));

const mocked = jest.mocked(Notifications);

function scheduledRequests(): {identifier: string; trigger: unknown}[] {
  return mocked.scheduleNotificationAsync.mock.calls.map(
    call => call[0] as {identifier: string; trigger: unknown},
  );
}

function cancelledIds(): string[] {
  return mocked.cancelScheduledNotificationAsync.mock.calls.map(
    call => call[0] as string,
  );
}

describe('daily reminder scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('schedules with the STABLE identifier and a daily trigger', async () => {
    const scheduler = createNotificationScheduler();
    await scheduler.scheduleDailyReminder({hour: 20, minute: 30});

    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      NOTIFICATION_IDS.dailyReminder,
    );
    const request = scheduledRequests()[0];
    expect(request.identifier).toBe(NOTIFICATION_IDS.dailyReminder);
    expect(request.trigger).toMatchObject({
      type: 'daily',
      hour: 20,
      minute: 30,
    });
  });

  it('re-scheduling replaces — cancel-before-schedule, never a second copy', async () => {
    const scheduler = createNotificationScheduler();
    await scheduler.scheduleDailyReminder({hour: 20, minute: 0});
    await scheduler.scheduleDailyReminder({hour: 21, minute: 0});

    // Both calls targeted the SAME stable id — impossible to duplicate.
    expect(cancelledIds()).toEqual([
      NOTIFICATION_IDS.dailyReminder,
      NOTIFICATION_IDS.dailyReminder,
    ]);
    expect(scheduledRequests()).toHaveLength(2);
    for (const request of scheduledRequests()) {
      expect(request.identifier).toBe(NOTIFICATION_IDS.dailyReminder);
    }
  });

  it('cancel removes exactly the stable identifier', async () => {
    const scheduler = createNotificationScheduler();
    await scheduler.cancelDailyReminder();
    expect(cancelledIds()).toEqual([NOTIFICATION_IDS.dailyReminder]);
  });
});

describe('monthly summary scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('schedules a repeating 1st-of-month trigger with the stable id', async () => {
    const scheduler = createNotificationScheduler();
    await scheduler.scheduleMonthlySummary();

    const request = scheduledRequests()[0];
    expect(request.identifier).toBe(NOTIFICATION_IDS.monthlySummary);
    expect(request.trigger).toMatchObject({type: 'monthly', day: 1});
  });
});

describe('recurring reminder sync (spec §4)', () => {
  const NOW = new Date(2026, 8, 20, 12, 0).getTime();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('schedules one reminder per active rule with per-rule stable ids', async () => {
    const scheduler = createNotificationScheduler();
    await scheduler.syncRecurringReminders(
      [
        {
          ruleId: 11,
          ruleTitle: 'Internet Bill',
          amountMinor: 250_000,
          nextOccurrenceAt: new Date(2026, 8, 25, 12, 0).getTime(),
        },
      ],
      'PKR',
      NOW,
    );

    const requests = scheduledRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].identifier).toBe(recurringReminderId(11));
    expect((requests[0].trigger as {type: string}).type).toBe('date');
    // The "due tomorrow" copy carries the rule title + formatted amount.
    const content = (mocked.scheduleNotificationAsync.mock.calls[0][0] as {
      content: {body: string};
    }).content;
    expect(content.body).toContain('Internet Bill');
    expect(content.body).toContain('due tomorrow');
  });

  it('skips a rule whose reminder slot already passed this cycle', async () => {
    const scheduler = createNotificationScheduler();
    // 19:00 — the 18:00 day-before slot for tomorrow's noon due date is gone.
    const evening = new Date(2026, 8, 20, 19, 0).getTime();
    await scheduler.syncRecurringReminders(
      [
        {
          ruleId: 12,
          ruleTitle: 'Rent',
          amountMinor: 1_000_000,
          nextOccurrenceAt: new Date(2026, 8, 21, 12, 0).getTime(),
        },
      ],
      'PKR',
      evening,
    );
    expect(scheduledRequests()).toHaveLength(0);
  });

  it('sweeps orphaned rule reminders after delete/pause (spec §4)', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      {identifier: recurringReminderId(11)},
      {identifier: recurringReminderId(42)},
      {identifier: NOTIFICATION_IDS.dailyReminder},
      {identifier: 'some.other.app.id'},
    ] as never);

    const scheduler = createNotificationScheduler();
    // Only rule 11 still exists — 42 was deleted/paused.
    await scheduler.syncRecurringReminders(
      [
        {
          ruleId: 11,
          ruleTitle: 'Internet Bill',
          amountMinor: 250_000,
          nextOccurrenceAt: new Date(2026, 8, 25, 12, 0).getTime(),
        },
      ],
      'PKR',
      NOW,
    );

    const cancellations = cancelledIds();
    expect(cancellations).toContain(recurringReminderId(42));
    // The daily reminder and other apps' notifications are untouched.
    expect(cancellations).not.toContain(NOTIFICATION_IDS.dailyReminder);
    expect(cancellations).not.toContain('some.other.app.id');
    // Live rule still gets (re)scheduled exactly once.
    expect(
      scheduledRequests().map(request => request.identifier),
    ).toEqual([recurringReminderId(11)]);

    mocked.getAllScheduledNotificationsAsync.mockResolvedValue(
      [] as never,
    );
  });

  it('syncing an empty list cancels every rule reminder (disable path)', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      {identifier: recurringReminderId(11)},
      {identifier: recurringReminderId(12)},
    ] as never);

    const scheduler = createNotificationScheduler();
    await scheduler.syncRecurringReminders([], 'PKR', NOW);

    expect(cancelledIds()).toEqual([
      recurringReminderId(11),
      recurringReminderId(12),
    ]);
    expect(scheduledRequests()).toHaveLength(0);
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([] as never);
  });
});

describe('budget alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fires immediately with the event key as the OS identifier', async () => {
    const scheduler = createNotificationScheduler();
    await scheduler.presentBudgetAlert({
      title: 'Budget Reminder',
      body: 'Food budget is 80% used.',
      data: {target: 'Budgets', key: '2026-09|category:7|warning80'},
    });

    const request = scheduledRequests()[0];
    expect(request.identifier).toBe('kharcha.budget.2026-09|category:7|warning80');
    expect(request.trigger).toBeNull(); // immediate
  });
});

describe('permissions (spec §6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps granted / denied / undetermined', async () => {
    const scheduler = createNotificationScheduler();

    mocked.getPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
    } as never);
    await expect(scheduler.getPermissionStatus()).resolves.toBe('granted');

    mocked.getPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    } as never);
    await expect(scheduler.getPermissionStatus()).resolves.toBe('denied');

    mocked.getPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    } as never);
    await expect(scheduler.getPermissionStatus()).resolves.toBe('undetermined');
  });

  it('degrades to "unsupported" when the native module fails', async () => {
    const scheduler = createNotificationScheduler();
    mocked.getPermissionsAsync.mockRejectedValueOnce(new Error('no native'));
    await expect(scheduler.getPermissionStatus()).resolves.toBe('unsupported');
  });
});

describe('cancelAllKarchaNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([] as never);
  });

  it('cancels every Kharcha id and nothing else', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      {identifier: NOTIFICATION_IDS.dailyReminder},
      {identifier: NOTIFICATION_IDS.monthlySummary},
      {identifier: recurringReminderId(3)},
      {identifier: 'foreign.id'},
    ] as never);

    const scheduler = createNotificationScheduler();
    await scheduler.cancelAllKarchaNotifications();

    expect(cancelledIds()).toEqual([
      NOTIFICATION_IDS.dailyReminder,
      NOTIFICATION_IDS.monthlySummary,
      recurringReminderId(3),
    ]);
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([] as never);
  });
});
