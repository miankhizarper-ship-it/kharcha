import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useCallback, useRef, useState} from 'react';
import {View} from 'react-native';

import {
  Button,
  EmptyState,
  LoadingIndicator,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import type {CategoryType} from '@/database/models';
import {describeLoadError} from '@/features/recurring/errors';
import {RecurringRuleRow} from '../components/RecurringRuleRow';
import {useRecurringFeature} from '../useRecurringFeature';
import type {RecurringRuleItem} from '../types';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

/**
 * Recurring rules list — [Expenses] [Income] tabs, one row per rule.
 *
 * On focus the screen first runs the (idempotent, atomic) due-occurrence
 * processor and then refetches — the focus-triggered half of the lifecycle
 * processing policy (spec §16); the app-launch half lives in `App.tsx`.
 * No timers, no polling: data is refetched on focus and after processing.
 */
export function RecurringScreen() {
  const {spacing} = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {feature, loadError} = useRecurringFeature();
  const currency = useSettingsStore(state => state.currency);

  const [typeIndex, setTypeIndex] = useState(0);
  const type: CategoryType = typeIndex === 0 ? 'expense' : 'income';

  const [rules, setRules] = useState<RecurringRuleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    try {
      // Process due rules BEFORE reading — one atomic, idempotent pass so
      // the list (and the ledger everywhere else) is current after focus.
      await feature.processDue();
      const items = await feature.listRules(type);
      if (seq !== loadSeq.current) {
        return;
      }
      setRules(items);
      setError(null);
    } catch {
      if (seq !== loadSeq.current) {
        return;
      }
      setError(describeLoadError());
    }
  }, [feature, type]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loadError) {
    return (
      <Screen scroll>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const ready = rules !== null && error === null;

  return (
    <Screen scroll contentContainerStyle={{paddingBottom: spacing.xl}}>
      <Text variant="display">Recurring</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Rules generate normal transactions on schedule — on this device only.
      </Text>

      <View style={{marginTop: spacing.md, gap: spacing.md}}>
        <SegmentedControl
          segments={['Expenses', 'Income']}
          selectedIndex={typeIndex}
          onSelect={setTypeIndex}
        />

        <Button
          title={
            type === 'expense'
              ? 'Add Recurring Expense'
              : 'Add Recurring Income'
          }
          onPress={() => navigation.navigate('RecurringForm', {type})}
          fullWidth
        />

        {!ready ? (
          error ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load recurring transactions"
              message={error}
            />
          ) : (
            <LoadingIndicator minHeight={200} />
          )
        ) : rules.length === 0 ? (
          <EmptyState
            icon="repeat-outline"
            title={
              type === 'expense'
                ? 'No recurring expenses yet'
                : 'No recurring income yet'
            }
            message={
              'Create a rule and Kharcha records it automatically — even when the app was closed.'
            }
          />
        ) : (
          rules.map(rule => (
            <RecurringRuleRow
              key={rule.id}
              rule={rule}
              currency={currency}
              onPress={selected =>
                navigation.navigate('RecurringForm', {
                  type: selected.type,
                  ruleId: selected.id,
                })
              }
            />
          ))
        )}
      </View>
    </Screen>
  );
}
