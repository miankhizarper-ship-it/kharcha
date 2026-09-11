import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Card, Text} from '@/components/ui';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';
import {budgetStateColor, budgetStateIcon} from './budgetStateVisuals';
import {ProgressBar} from './ProgressBar';
import {budgetStateLabel, formatBudgetPercent} from '../progress';
import type {CategoryBudgetProgress} from '../types';

export interface CategoryBudgetRowProps {
  budget: CategoryBudgetProgress;
  currency: string;
  /** Opens the edit sheet for this budget. */
  onPress: (budget: CategoryBudgetProgress) => void;
}

/**
 * One category budget card: name, spent/budget, percent, progress bar and
 * a state badge once the budget is approaching or exceeded.
 */
export function CategoryBudgetRow({
  budget,
  currency,
  onPress,
}: CategoryBudgetRowProps) {
  const {colors, radius, spacing} = useTheme();
  const stateColor = budgetStateColor(budget.state, colors);
  const showBadge = budget.state === 'warning' || budget.state === 'exceeded';

  return (
    <Card style={{padding: spacing.md}}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${budget.categoryName} budget`}
        onPress={() => onPress(budget)}
        android_ripple={{color: colors.overlay, foreground: true}}
        style={({pressed}) => [
          styles.inner,
          {borderRadius: radius.sm, opacity: pressed ? 0.85 : 1},
        ]}
      >
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconCircle,
              {backgroundColor: colors.surfaceMuted, borderRadius: radius.full},
            ]}
          >
            <Ionicons
              name={categoryIconName(budget.categoryIcon)}
              size={16}
              color={colors.textMuted}
            />
          </View>
          <Text variant="body" numberOfLines={1} style={styles.name}>
            {budget.categoryName}
          </Text>
          <Text variant="label" style={{color: stateColor}}>
            {formatBudgetPercent(budget.percent)}%
          </Text>
        </View>

        <ProgressBar
          ratio={budget.amount > 0 ? budget.spent / budget.amount : 0}
          color={stateColor}
        />

        <View style={styles.footerRow}>
          <Text variant="caption" color="textMuted">
            {formatCurrency(budget.spent, currency)} /{' '}
            {formatCurrency(budget.amount, currency)}
          </Text>
          {showBadge ? (
            <View style={styles.badgeRow}>
              <Ionicons
                name={budgetStateIcon(budget.state)}
                size={13}
                color={stateColor}
              />
              <Text variant="caption" style={{color: stateColor}}>
                {budgetStateLabel(budget.state)}
              </Text>
            </View>
          ) : (
            <Text variant="caption" color="textMuted">
              {budget.remaining >= 0
                ? `${formatCurrency(budget.remaining, currency)} left`
                : formatCurrency(budget.remaining, currency)}
            </Text>
          )}
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  inner: {gap: 10, alignSelf: 'stretch'},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {flex: 1},
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badgeRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
});
