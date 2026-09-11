import React, {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Card, Text} from '@/components/ui';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {formatBudgetPercent} from '@/features/budgets/progress';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import {budgetStateColor} from '@/features/budgets/components/budgetStateVisuals';
import type {CategoryBudgetProgress} from '@/features/budgets/types';
import type {CategorySlice} from '@/features/reports/types';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';

/** Orderings for the category comparison (Phase 9). Default: highest first. */
export type CategorySort = 'highest' | 'lowest' | 'frequent';

const SORTS: {value: CategorySort; label: string}[] = [
  {value: 'highest', label: 'Highest'},
  {value: 'lowest', label: 'Lowest'},
  {value: 'frequent', label: 'Most frequent'},
];

export interface CategoryBreakdownListProps {
  /** Slices from the report snapshot (largest first by default). */
  slices: CategorySlice[];
  currency: string;
  /** Called when a category row is tapped (drill-down). */
  onSelectCategory: (slice: CategorySlice) => void;
  /**
   * Category budgets for the reported month (Phase 9) — when provided, rows
   * with a budget show their state ("82% of PKR 8,000 budget") using the
   * Budget feature's own status semantics.
   */
  budgetByCategoryId?: Map<number, CategoryBudgetProgress>;
}

function sortSlices(
  slices: CategorySlice[],
  sortBy: CategorySort,
): CategorySlice[] {
  const copy = [...slices];
  switch (sortBy) {
    case 'lowest':
      return copy.sort(
        (a, b) => a.total - b.total || a.categoryId - b.categoryId,
      );
    case 'frequent':
      return copy.sort(
        (a, b) =>
          (b.transactionCount ?? 0) - (a.transactionCount ?? 0) ||
          b.total - a.total ||
          a.categoryId - b.categoryId,
      );
    default:
      return copy.sort(
        (a, b) => b.total - a.total || a.categoryId - b.categoryId,
      );
  }
}

/**
 * "Where did my money go" — every spending category with icon, amount,
 * share of the period and transaction count, largest first. Rows are
 * tappable and drill into the Category Detail screen. This text list
 * mirrors the chart content, so numbers are never communicated by a
 * visualization alone.
 */
export function CategoryBreakdownList({
  slices,
  currency,
  onSelectCategory,
  budgetByCategoryId,
}: CategoryBreakdownListProps) {
  const {colors, radius, spacing} = useTheme();
  const [sortBy, setSortBy] = useState<CategorySort>('highest');
  const sorted = sortSlices(slices, sortBy);

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.md}}>
      <View style={styles.headerRow}>
        <Text variant="title">By Category</Text>
        {slices.length > 1 ? (
          <View style={styles.sortRow}>
            {SORTS.map(option => {
              const isActive = option.value === sortBy;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${option.label}`}
                  accessibilityState={{selected: isActive}}
                  onPress={() => setSortBy(option.value)}
                  style={[
                    styles.sortChip,
                    {
                      backgroundColor: isActive
                        ? colors.primaryMuted
                        : 'transparent',
                      borderColor: isActive ? colors.primary : colors.border,
                      borderRadius: radius.full,
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{color: isActive ? colors.text : colors.textMuted}}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {sorted.map(slice => {
        const budget = budgetByCategoryId?.get(slice.categoryId);
        const countLabel =
          slice.transactionCount !== undefined
            ? `${slice.transactionCount} ${
                slice.transactionCount === 1 ? 'transaction' : 'transactions'
              }`
            : null;
        const a11yLabel = [
          slice.name,
          formatCurrency(slice.total, currency),
          `${formatBudgetPercent(slice.percent)} percent`,
          countLabel,
          budget
            ? `${formatBudgetPercent(budget.percent)} percent of budget used`
            : null,
          'View category details',
        ]
          .filter(Boolean)
          .join(', ');

        return (
          <Pressable
            key={slice.categoryId}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
            onPress={() => onSelectCategory(slice)}
            android_ripple={{color: colors.overlay, foreground: true}}
            style={({pressed}) => [
              styles.row,
              styles.rowPressable,
              {
                borderRadius: radius.md,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.identity}>
              <View
                style={[
                  styles.icon,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.full,
                  },
                ]}
              >
                <Ionicons
                  name={categoryIconName(slice.icon)}
                  size={16}
                  color={colors.textMuted}
                />
              </View>
              <View style={styles.nameColumn}>
                <Text variant="body" numberOfLines={1}>
                  {slice.name}
                </Text>
                <View style={styles.shareRow}>
                  <View style={styles.barWrap}>
                    <ProgressBar
                      ratio={slice.percent > 0 ? slice.percent / 100 : 0}
                      color={colors.primary}
                    />
                  </View>
                  <Text variant="caption" color="textMuted">
                    {formatBudgetPercent(slice.percent)}%
                  </Text>
                </View>
                {countLabel || budget ? (
                  <View style={styles.metaRow}>
                    {countLabel ? (
                      <Text variant="caption" color="textMuted">
                        {countLabel}
                      </Text>
                    ) : null}
                    {budget ? (
                      <Text
                        variant="caption"
                        style={{color: budgetStateColor(budget.state, colors)}}
                      >
                        {formatBudgetPercent(budget.percent)}% of{' '}
                        {formatCurrency(budget.amount, currency)} budget
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
            <Text variant="label">{formatCurrency(slice.total, currency)}</Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  sortRow: {flexDirection: 'row', gap: 6},
  sortChip: {borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowPressable: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginHorizontal: -4,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameColumn: {flex: 1, gap: 4},
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  barWrap: {flex: 1},
});
