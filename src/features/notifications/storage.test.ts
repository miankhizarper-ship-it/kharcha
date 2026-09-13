/**
 * @jest-environment node
 */
import type {DatabaseService} from '@/database/service';
import {createTestService} from '@/database/testing/helpers';

import {createNotificationStorage} from './storage';
import {DEFAULT_NOTIFICATION_PREFERENCES, type NotificationStateV1} from './types';

/**
 * Runs against the REAL SQLite engine (node:sqlite driver) through the same
 * `settings` key/value table the production feature persists to.
 */
describe('createNotificationStorage', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    service = await createTestService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('returns defaults when nothing was stored', async () => {
    const storage = createNotificationStorage(service);
    expect(await storage.loadPreferences()).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(await storage.loadState()).toEqual({
      schemaVersion: 1,
      budgetNotifiedKeys: [],
    });
  });

  it('round-trips the full preference snapshot (spec §9 fields)', async () => {
    const storage = createNotificationStorage(service);
    await storage.savePreferences({
      dailyReminderEnabled: true,
      dailyReminderTime: {hour: 21, minute: 30},
      budgetAlertsEnabled: true,
      recurringReminderEnabled: false,
      monthlySummaryEnabled: true,
    });

    expect(await storage.loadPreferences()).toEqual({
      dailyReminderEnabled: true,
      dailyReminderTime: {hour: 21, minute: 30},
      budgetAlertsEnabled: true,
      recurringReminderEnabled: false,
      monthlySummaryEnabled: true,
    });
  });

  it('shares the settings table without clobbering other settings', async () => {
    const storage = createNotificationStorage(service);
    await service.settings.set('themeMode', 'dark');
    await service.settings.set('currency', 'PKR');

    await storage.savePreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      dailyReminderEnabled: true,
    });

    expect(await service.settings.get('themeMode')).toBe('dark');
    expect(await service.settings.get('currency')).toBe('PKR');
    expect((await storage.loadPreferences()).dailyReminderEnabled).toBe(true);
  });

  it('survives corrupt rows via coercion instead of throwing', async () => {
    await service.settings.set('notification.daily.time', '{corrupt');
    const storage = createNotificationStorage(service);
    expect((await storage.loadPreferences()).dailyReminderTime).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES.dailyReminderTime,
    );
  });

  it('persists and prunes the dedupe state', async () => {
    const storage = createNotificationStorage(service);
    const state: NotificationStateV1 = {
      schemaVersion: 1,
      budgetNotifiedKeys: ['2026-09|overall|warning80'],
    };
    await storage.saveState(state);
    expect(await storage.loadState()).toEqual(state);
  });

  it('skips the write when the state is unchanged', async () => {
    const storage = createNotificationStorage(service);
    const state: NotificationStateV1 = {
      schemaVersion: 1,
      budgetNotifiedKeys: ['2026-09|overall|warning80'],
    };
    await storage.saveState(state);

    const writeSpy = jest.spyOn(service.settings, 'set');
    await storage.saveState({...state, budgetNotifiedKeys: [...state.budgetNotifiedKeys]});
    expect(writeSpy).not.toHaveBeenCalled();

    await storage.saveState({
      schemaVersion: 1,
      budgetNotifiedKeys: ['2026-09|overall|warning90'],
    });
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
