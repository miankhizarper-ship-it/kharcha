import React from 'react';
import {StyleSheet, View} from 'react-native';

import {Card, Text} from '@/components/ui';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import type {IncomeVsExpense} from '@/features/reports/types';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';

export interface IncomeExpenseCompareProps {
  comparison: IncomeVsExpense;
  currency: string;
}

/**
 * Income vs Expenses for the selected period: two proportional bars and the
 * resulting balance. Bars scale against the larger of the two sides; when
 * both are zero the bars collapse (the section is hidden by the screen in
 * fully empty periods anyway).
 */
export function IncomeExpenseCompare({
  comparison,
  currency,
}: IncomeExpenseCompareProps) {
  const {colors, spacing} = useTheme();
  const {income, expenses, balance} = comparison;
  const scale = Math.max(income, expenses);

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.md}}>
      <Text variant="title">Income vs Expenses</Text>

      <View style={styles.sideRow}>
        <Text variant="body" style={styles.sideLabel}>
          Income
        </Text>
        <View style={styles.barWrap}>
          <ProgressBar
            ratio={scale > 0 ? income / scale : 0}
            color={colors.primary}
          />
        </View>
        <Text
          variant="label"
          style={styles.sideValue}
          accessibilityLabel={`Income ${formatCurrency(income, currency)}`}
        >
          {formatCurrency(income, currency)}
        </Text>
      </View>

      <View style={styles.sideRow}>
        <Text variant="body" style={styles.sideLabel}>
          Expenses
        </Text>
        <View style={styles.barWrap}>
          <ProgressBar
            ratio={scale > 0 ? expenses / scale : 0}
            color={colors.danger}
          />
        </View>
        <Text
          variant="label"
          style={styles.sideValue}
          accessibilityLabel={`Expenses ${formatCurrency(expenses, currency)}`}
        >
          {formatCurrency(expenses, currency)}
        </Text>
      </View>

      <View
        style={[
          styles.balanceRow,
          {borderTopColor: colors.border, paddingTop: spacing.md},
        ]}
      >
        <Text variant="body" color="textMuted">
          Balance
        </Text>
        <Text
          variant="label"
          style={{color: balance < 0 ? colors.danger : colors.text}}
          accessibilityLabel={`Balance ${formatCurrency(balance, currency)}`}
        >
          {formatCurrency(balance, currency)}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  sideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sideLabel: {width: 72},
  barWrap: {flex: 1},
  sideValue: {minWidth: 96, textAlign: 'right'},
  balanceRow: {
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
