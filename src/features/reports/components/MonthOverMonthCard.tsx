import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Card, Text} from '@/components/ui';
import {formatBudgetPercent} from '@/features/budgets/progress';
import type {
  MonthOverMonthComparison,
  TrendDirection,
} from '@/features/reports/types';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';

export interface MonthOverMonthCardProps {
  comparison: MonthOverMonthComparison;
  /** Label of the month being viewed, e.g. "September 2026". */
  currentLabel: string;
  /** Label of the month before it, e.g. "August 2026". */
  previousLabel: string;
  currency: string;
}

const DIRECTION_ICONS: Record<TrendDirection, keyof typeof Ionicons.glyphMap> =
  {
    up: 'arrow-up',
    down: 'arrow-down',
    flat: 'remove',
  };

/**
 * Month-over-month spending comparison. When the previous month had zero
 * spending the percentage is undefined — the card says so in words instead
 * of ever rendering Infinity/NaN.
 */
export function MonthOverMonthCard({
  comparison,
  currentLabel,
  previousLabel,
  currency,
}: MonthOverMonthCardProps) {
  const {colors, spacing} = useTheme();
  const {currentTotal, previousTotal, percentChange, direction} = comparison;

  const changeColor =
    direction === 'up'
      ? colors.danger
      : direction === 'down'
        ? colors.primary
        : colors.textMuted;

  let changeText: string;
  if (percentChange === null) {
    changeText =
      direction === 'up'
        ? `No spending in ${previousLabel} to compare.`
        : 'Nothing spent in either month.';
  } else if (direction === 'flat') {
    changeText = 'No change from the previous month.';
  } else {
    const verb = direction === 'up' ? 'increased' : 'decreased';
    changeText = `Spending ${verb} ${formatBudgetPercent(
      Math.abs(percentChange),
    )}%`;
  }

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.md}}>
      <Text variant="title">Month-over-Month</Text>

      <View style={styles.statRow}>
        <Text variant="body">{currentLabel}</Text>
        <Text
          variant="label"
          accessibilityLabel={`${currentLabel} ${formatCurrency(currentTotal, currency)}`}
        >
          {formatCurrency(currentTotal, currency)}
        </Text>
      </View>
      <View style={styles.statRow}>
        <Text variant="body">{previousLabel}</Text>
        <Text
          variant="label"
          accessibilityLabel={`${previousLabel} ${formatCurrency(previousTotal, currency)}`}
        >
          {formatCurrency(previousTotal, currency)}
        </Text>
      </View>

      <View style={styles.changeRow}>
        <Ionicons
          name={DIRECTION_ICONS[direction]}
          size={14}
          color={changeColor}
        />
        <Text variant="label" style={{color: changeColor}}>
          {changeText}
        </Text>
        {percentChange !== null && direction !== 'flat' ? (
          <Text variant="caption" color="textMuted" style={styles.difference}>
            {comparison.difference > 0 ? '+' : ''}
            {formatCurrency(comparison.difference, currency)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  difference: {marginLeft: 'auto'},
});
