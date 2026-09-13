import {useEffect, useRef} from 'react';
import {AppState, type AppStateStatus} from 'react-native';

import {openDatabase} from '@/database/connection';

import {BUDGET_EVALUATION_INTERVAL_MS, NOTIFICATION_SYNC_DELAY_MS} from './config';
import {createNotificationFeature} from './service';

/**
 * App-lifecycle orchestrator for Smart Notifications (mounted once, next to
 * `AppUpdateManager`). Entirely fire-and-forget: every failure is swallowed
 * and nothing here can block or break startup.
 *
 * Responsibilities:
 * - ONE full schedule sync shortly after launch (idempotent — stable ids +
 *   cancel-before-schedule mean repeated runs never duplicate; spec §11).
 * - Re-sync on every foreground transition (picks up preference/data
 *   changes, catches one-shot recurring reminders whose time arrived).
 * - Cheap budget evaluation on a fixed cadence WHILE the app is open, so
 *   add/edit/delete of expenses produces an alert within a minute without
 *   any background service or data duplication (spec §3).
 *
 * It NEVER requests notification permission (spec §6) — that happens only
 * from explicit user gestures in Settings.
 */
export function NotificationOrchestrator() {
  const syncRunningRef = useRef(false);
  const featureRef = useRef<ReturnType<typeof createNotificationFeature> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    let launchTimer: ReturnType<typeof setTimeout> | null = null;
    let evalTimer: ReturnType<typeof setInterval> | null = null;

    function runSync(feature: ReturnType<typeof createNotificationFeature>) {
      if (syncRunningRef.current) {
        return;
      }
      syncRunningRef.current = true;
      feature
        .syncAll()
        .catch(() => undefined)
        .finally(() => {
          syncRunningRef.current = false;
        });
    }

    openDatabase()
      .then(db => {
        if (cancelled) {
          return;
        }
        const feature = createNotificationFeature(db);
        featureRef.current = feature;

        // Launch sync, delayed like the update check so startup stays snappy.
        launchTimer = setTimeout(() => {
          if (!cancelled) {
            runSync(feature);
          }
        }, NOTIFICATION_SYNC_DELAY_MS);

        // While the app is OPEN, re-evaluate budget thresholds on a light
        // fixed cadence (two indexed SQLite reads; skipped when disabled).
        evalTimer = setInterval(() => {
          if (!cancelled && AppState.currentState === 'active') {
            feature.evaluateBudgetAlerts().catch(() => undefined);
          }
        }, BUDGET_EVALUATION_INTERVAL_MS);
      })
      .catch(() => {
        // Database unavailable — the whole feature is inert; the rest of
        // the app already surfaces the DB state on screen.
      });

    function onAppStateChange(state: AppStateStatus) {
      if (state === 'active') {
        const feature = featureRef.current;
        if (feature && !cancelled) {
          runSync(feature);
        }
      }
    }

    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelled = true;
      subscription.remove();
      if (launchTimer !== null) {
        clearTimeout(launchTimer);
      }
      if (evalTimer !== null) {
        clearInterval(evalTimer);
      }
    };
  }, []);

  return null;
}
