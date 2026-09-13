import {useCallback, useEffect, useRef, useState} from 'react';

import {openDatabase} from '@/database/connection';

import {
  createNotificationFeature,
  type NotificationFeature,
} from './service';
import type {
  NotificationPermissionStatus,
  NotificationPreferences,
  ReminderTime,
} from './types';

/**
 * Connects the notification settings section to the feature service.
 * Same contract as `useSettingsFeature` / `useBudgetFeature`: the database
 * handle resolves once, every mutation persists immediately and returns the
 * authoritative updated preferences snapshot.
 */
export function useNotificationSettings(): {
  feature: NotificationFeature | null;
  preferences: NotificationPreferences | null;
  permission: NotificationPermissionStatus | 'unknown';
  /** Set while a persist/schedule operation is in flight. */
  saving: boolean;
  /** Permission request happens only when enabling (user-gesture). */
  ensurePermissionThen: (
    action: (feature: NotificationFeature) => Promise<NotificationPreferences>,
  ) => void;
  /** Applies the change without any permission prompt (e.g. toggling OFF). */
  apply: (
    action: (feature: NotificationFeature) => Promise<NotificationPreferences>,
  ) => void;
  refreshPermission: () => void;
} {
  const [feature, setFeature] = useState<NotificationFeature | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(
    null,
  );
  const [permission, setPermission] = useState<
    NotificationPermissionStatus | 'unknown'
  >('unknown');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;

    openDatabase()
      .then(db => {
        const created = createNotificationFeature(db);
        if (active) {
          setFeature(created);
        }
        return created.loadPreferences().then(loaded => {
          if (active) {
            setPreferences(loaded);
          }
        });
      })
      .catch(() => {
        // Database unavailable → section shows its fallback; the rest of
        // the Settings screen already handles that state independently.
      });

    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  const refreshPermission = useCallback(() => {
    if (!feature) {
      return;
    }
    feature
      .getPermissionStatus()
      .then(status => {
        if (mounted.current) {
          setPermission(status);
        }
      })
      .catch(() => undefined);
  }, [feature]);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  const runAction = useCallback(
    (
      action: (feature: NotificationFeature) => Promise<NotificationPreferences>,
      requestPermissionIfNeeded: boolean,
    ) => {
      if (!feature || saving) {
        return;
      }
      setSaving(true);
      (async () => {
        // The ONE permission prompt in the whole feature: an explicit user
        // toggle while permission is not granted yet (spec §6). Denied,
        // permanently-denied and unsupported all resolve — the toggle is
        // still saved, and the UI explains where to enable notifications.
        if (requestPermissionIfNeeded) {
          const status = await feature.getPermissionStatus().catch(
            () => 'unsupported' as const,
          );
          if (status !== 'granted') {
            await feature
              .requestPermission()
              .then(updated => setPermission(updated))
              .catch(() => undefined);
          }
        }
        const updated = await action(feature);
        if (mounted.current) {
          setPreferences(updated);
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          if (mounted.current) {
            setSaving(false);
            refreshPermission();
          }
        });
    },
    [feature, saving, refreshPermission],
  );

  const ensurePermissionThen = useCallback(
    (action: (feature: NotificationFeature) => Promise<NotificationPreferences>) =>
      runAction(action, true),
    [runAction],
  );

  const apply = useCallback(
    (action: (feature: NotificationFeature) => Promise<NotificationPreferences>) =>
      runAction(action, false),
    [runAction],
  );

  return {
    feature,
    preferences,
    permission,
    saving,
    ensurePermissionThen,
    apply,
    refreshPermission,
  };
}

export type {NotificationPreferences, ReminderTime};
