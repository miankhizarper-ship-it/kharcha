import {useEffect, useRef} from 'react';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {
  DEFAULT_ACTION_IDENTIFIER,
  useLastNotificationResponse,
  type NotificationResponse,
} from 'expo-notifications';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useNavigation} from '@react-navigation/native';

import type {MainTabParamList, RootStackParamList} from '@/navigation/types';

import type {NotificationData, NotificationRouteTarget} from './types';

/**
 * Notification TAP handling (spec §8).
 *
 * Mounted INSIDE the NavigationContainer (see RootNavigator) so it can
 * navigate. `useLastNotificationResponse` covers BOTH entry paths on
 * Android:
 * - cold start (app fully closed) — the launch-causing tap surfaces here
 * - app alive in background/foreground — taps arrive through the same hook
 *
 * Target map:
 * - Daily Spending Reminder → Add Expense modal
 * - Budget Alerts           → Budget screen (current month)
 * - Recurring reminder      → Recurring Transactions screen
 * - Monthly Summary         → Reports tab (existing analytics)
 * Unknown/missing payloads fall back safely to doing nothing (the app just
 * opens on its normal screen).
 */

type NavigationProp = BottomTabNavigationProp<MainTabParamList> &
  NativeStackNavigationProp<RootStackParamList>;

/** Extracts our typed payload from the (JSON-round-tripped) notification. */
function targetOf(
  response: NotificationResponse,
): NotificationRouteTarget | null {
  const data = response.notification.request.content.data as
    | Partial<NotificationData>
    | undefined;
  const target = data?.target;
  if (
    target === 'AddExpense' ||
    target === 'Budgets' ||
    target === 'Recurring' ||
    target === 'Tabs:Reports'
  ) {
    return target;
  }
  return null;
}

export function NotificationTapHandler() {
  const navigation = useNavigation<NavigationProp>();
  const response = useLastNotificationResponse();
  const handledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!response) {
      return;
    }

    // The hook re-emits the same response across re-renders — handle each
    // physical tap exactly once (id + timestamp is a stable tap identity).
    const tapKey = `${response.notification.request.identifier}#${response.notification.date}`;
    if (handledKeyRef.current === tapKey) {
      return;
    }
    handledKeyRef.current = tapKey;

    // Only a plain tap (not a dismissed/custom action) should navigate.
    if (response.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) {
      return;
    }

    const target = targetOf(response);
    if (target === null) {
      return;
    }

    try {
      switch (target) {
        case 'AddExpense':
          navigation.navigate('AddExpense', undefined);
          break;
        case 'Budgets':
          navigation.navigate('Budgets', undefined);
          break;
        case 'Recurring':
          navigation.navigate('Recurring', undefined);
          break;
        case 'Tabs:Reports':
          // Navigating by tab route name focuses Tabs → Reports from
          // anywhere in the stack.
          navigation.navigate('Reports', undefined);
          break;
      }
    } catch {
      // A navigation hiccup must never crash the app on launch.
    }
  }, [response, navigation]);

  return null;
}
