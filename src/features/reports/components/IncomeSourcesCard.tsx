import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Card, Text} from '@/components/ui';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {formatBudgetPercent} from '@/features/budgets/progress';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import type {IncomeSourceSummary} from '@/features/reports/types';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';

export interface IncomeSourcesCardProps {
  /** Sources from the report snapshot, largest first. */
  sources: IncomeSourceSummary[];
  currency: string;
  /** Called when a source row is tapped (drill-down). */
  onSelectSource: (source: IncomeSourceSummary) => void;
}

/**
 * "Where did my money come from" — income grouped by its exact source
 * text, with amount, share and transaction count (Phase 9). Rows are
 * tappable and drill into the same Category Detail screen as expense
 * categories (income has no category FK, so sources ARE the breakdown).
 */
export function IncomeSourcesCard({
  sources,
  currency,
  onSelectSource,
}: IncomeSourcesCardProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.md}}>
      <Text variant="title">Income Sources</Text>

      {sources.map(source => {
        const countLabel = `${source.transactionCount} ${
          source.transactionCount === 1 ? 'transaction' : 'transactions'
        }`;
        return (
          <Pressable
            key={source.source}
            accessibilityRole="button"
            accessibilityLabel={[
              source.source,
              formatCurrency(source.total, currency),
              `${formatBudgetPercent(source.percent)} percent of income`,
              countLabel,
              'View source details',
            ].join(', ')}
            onPress={() => onSelectSource(source)}
            android_ripple={{color: colors.overlay, foreground: true}}
            style={({pressed}) => [
              styles.row,
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
                  name={categoryIconName(source.icon)}
                  size={16}
                  color={colors.textMuted}
                />
              </View>
              <View style={styles.nameColumn}>
                <Text variant="body" numberOfLines={1}>
                  {source.source}
                </Text>
                <View style={styles.shareRow}>
                  <View style={styles.barWrap}>
                    <ProgressBar
                      ratio={source.percent > 0 ? source.percent / 100 : 0}
                      color={colors.primary}
                    />
                  </View>
                  <Text variant="caption" color="textMuted">
                    {formatBudgetPercent(source.percent)}%
                  </Text>
                </View>
                <Text variant="caption" color="textMuted">
                  {countLabel}
                </Text>
              </View>
            </View>
            <Text variant="label">
              {formatCurrency(source.total, currency)}
            </Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  barWrap: {flex: 1},
});
