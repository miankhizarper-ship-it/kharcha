import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Button, Card, Text} from '@/components/ui';
import {budgetStateColor} from '@/features/budgets/components/budgetStateVisuals';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import {formatBudgetPercent} from '@/features/budgets/progress';
import type {
  CategoryBudgetProgress,
  OverallBudgetProgress,
} from '@/features/budgets/types';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';

export interface BudgetPerformanceCardProps {
  overall: OverallBudgetProgress | null;
  /** Highest-usage category budgets for the compact status list. */
  topCategories: CategoryBudgetProgress[];
  currency: string;
  /** Opens the Budget screen on the reported month. */
  onOpenBudget: () => void;
}

/**
 * How the period performed against its budget — the overall limit with its
 * progress bar, plus the tightest category budgets. All math and colors are
 * reused from the Budget feature; this card only renders them.
 */
export function BudgetPerformanceCard({
  overall,
  topCategories,
  currency,
  onOpenBudget,
}: BudgetPerformanceCardProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.sm}}>
      <Text variant="label" color="textMuted">
        MONTHLY BUDGET
      </Text>

      {overall ? (
        <>
          <Text
            variant="title"
            style={{
              color: overall.state === 'exceeded' ? colors.danger : colors.text,
            }}
            accessibilityLabel={`Budget ${formatCurrency(overall.amount, currency)}`}
          >
            {formatCurrency(overall.amount, currency)}
          </Text>
          <ProgressBar
            ratio={overall.amount > 0 ? overall.spent / overall.amount : 0}
            color={budgetStateColor(overall.state, colors)}
          />
          <View style={styles.statRow}>
            <Text variant="caption" color="textMuted">
              Spent {formatCurrency(overall.spent, currency)}
            </Text>
            <Text
              variant="caption"
              style={{
                color: overall.remaining < 0 ? colors.danger : colors.textMuted,
              }}
            >
              Remaining {formatCurrency(overall.remaining, currency)}
            </Text>
          </View>
          <View style={styles.footerRow}>
            <View style={styles.stateRow}>
              {overall.state === 'warning' || overall.state === 'exceeded' ? (
                <Ionicons
                  name={
                    overall.state === 'exceeded' ? 'alert-circle' : 'warning'
                  }
                  size={14}
                  color={budgetStateColor(overall.state, colors)}
                />
              ) : null}
              <Text
                variant="caption"
                style={{color: budgetStateColor(overall.state, colors)}}
              >
                {formatBudgetPercent(overall.percent)}% used
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View Budget"
              onPress={onOpenBudget}
            >
              <Text variant="label" style={{color: colors.primary}}>
                View Budget
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text variant="title">Not set</Text>
          <View style={{marginTop: spacing.xs}}>
            <Button
              title="Set Budget"
              variant="secondary"
              fullWidth
              onPress={onOpenBudget}
            />
          </View>
        </>
      )}

      {topCategories.length > 0 ? (
        <View
          style={[
            styles.categorySection,
            {borderTopColor: colors.border, paddingTop: spacing.sm},
          ]}
        >
          {topCategories.map(budget => (
            <View key={budget.id} style={styles.categoryRow}>
              <View
                style={[
                  styles.categoryIcon,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.full,
                  },
                ]}
              >
                <Ionicons
                  name={categoryIconName(budget.categoryIcon)}
                  size={13}
                  color={colors.textMuted}
                />
              </View>
              <Text
                variant="body"
                numberOfLines={1}
                style={styles.categoryName}
              >
                {budget.categoryName}
              </Text>
              <Text
                variant="caption"
                style={{
                  color: budgetStateColor(budget.state, colors),
                }}
              >
                {formatBudgetPercent(budget.percent)}% used
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categorySection: {borderTopWidth: 1, gap: 10},
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryIcon: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {flex: 1},
});
