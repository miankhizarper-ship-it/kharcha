import React from 'react';
import {StyleSheet, View} from 'react-native';

import {Card, Text} from '@/components/ui';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';

export interface ReportSummaryCardProps {
  income: number;
  expenses: number;
  balance: number;
  averageDailySpend: number;
  currency: string;
  /** Expense rows in the period (Phase 9 frequency line). */
  transactionCount?: number;
  /** expenses / transactionCount, minor units (Phase 9). */
  averageTransaction?: number;
}

/**
 * Top-of-screen totals: Income / Expenses / Balance side by side, with the
 * period's average daily spend beneath a divider. Balance turns danger-red
 * when spending outweighs income.
 */
export function ReportSummaryCard({
  income,
  expenses,
  balance,
  averageDailySpend,
  currency,
  transactionCount,
  averageTransaction,
}: ReportSummaryCardProps) {
  const {colors, spacing} = useTheme();

  return (
    <Card style={{marginTop: spacing.md}}>
      <View style={styles.columns}>
        <View style={styles.column}>
          <Text variant="caption" color="textMuted">
            Income
          </Text>
          <Text
            variant="title"
            style={{color: colors.primary}}
            accessibilityLabel={`Income ${formatCurrency(income, currency)}`}
          >
            +{formatCurrency(income, currency)}
          </Text>
        </View>
        <View style={styles.column}>
          <Text variant="caption" color="textMuted">
            Expenses
          </Text>
          <Text
            variant="title"
            style={{color: colors.danger}}
            accessibilityLabel={`Expenses ${formatCurrency(expenses, currency)}`}
          >
            -{formatCurrency(expenses, currency)}
          </Text>
        </View>
        <View style={[styles.column, styles.columnEnd]}>
          <Text variant="caption" color="textMuted">
            Balance
          </Text>
          <Text
            variant="title"
            style={{color: balance < 0 ? colors.danger : colors.text}}
            accessibilityLabel={`Balance ${formatCurrency(balance, currency)}`}
          >
            {formatCurrency(balance, currency)}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.dailyRow,
          {
            borderTopColor: colors.border,
            marginTop: spacing.md,
            paddingTop: spacing.md,
          },
        ]}
      >
        <Text variant="body" color="textMuted">
          Average Daily Spend
        </Text>
        <Text
          variant="label"
          accessibilityLabel={`Average daily spend ${formatCurrency(averageDailySpend, currency)}`}
        >
          {formatCurrency(averageDailySpend, currency)}
        </Text>
      </View>

      {transactionCount !== undefined && transactionCount > 0 ? (
        <View style={styles.dailyRow}>
          <Text variant="body" color="textMuted">
            {transactionCount}{' '}
            {transactionCount === 1 ? 'Transaction' : 'Transactions'}
          </Text>
          {averageTransaction !== undefined ? (
            <Text
              variant="label"
              accessibilityLabel={`Average transaction ${formatCurrency(averageTransaction, currency)}`}
            >
              Avg {formatCurrency(averageTransaction, currency)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    gap: 16,
  },
  column: {flex: 1, gap: 2},
  columnEnd: {flex: 0, alignItems: 'flex-end'},
  dailyRow: {
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
