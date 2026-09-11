import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Card, Text} from '@/components/ui';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {buildReportInsights} from '@/features/reports/insights';
import type {ReportInsight, ReportSnapshot} from '@/features/reports/types';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';
import {formatShortDate} from '@/utils/date';
import {formatBudgetPercent} from '@/features/budgets/progress';

export interface InsightsCardProps {
  /** The already-loaded report snapshot — every insight derives from it. */
  snapshot: ReportSnapshot;
  currency: string;
  /** Label of the comparison period for the trend row (month reports). */
  previousLabel?: string;
  /**
   * Opens a transaction (edit screens) when an insight row is tappable —
   * currently the largest-transaction row. Internal ids stay out of the UI.
   */
  onOpenTransaction?: (transaction: {
    type: 'expense' | 'income';
    id: number;
  }) => void;
}

/**
 * Compact insights: where the most money went, which day cost the most,
 * how big a typical transaction is, budget warnings and the period's
 * direction — all deterministic calculations on real database rows (spec
 * §11: no AI, no fabricated advice). Rows without data simply don't render.
 */
export function InsightsCard({
  snapshot,
  currency,
  previousLabel,
  onOpenTransaction,
}: InsightsCardProps) {
  const {spacing} = useTheme();

  const rows = buildReportInsights(
    snapshot,
    {
      formatCurrency: minor => formatCurrency(minor, currency),
      formatPercent: formatBudgetPercent,
      formatShortDate,
    },
    {previousLabel},
  );

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.md}}>
      <Text variant="title">Insights</Text>

      {rows.length === 0 ? (
        <Text variant="label" color="textMuted">
          No insights for this period yet.
        </Text>
      ) : (
        rows.map(row => {
          const transaction = row.transaction;
          const onOpen =
            transaction && onOpenTransaction
              ? () => onOpenTransaction(transaction)
              : undefined;
          return <InsightRow key={row.key} row={row} onOpen={onOpen} />;
        })
      )}
    </Card>
  );
}

function InsightRow({row, onOpen}: {row: ReportInsight; onOpen?: () => void}) {
  const {colors, radius} = useTheme();

  const body = (
    <View style={styles.row}>
      <Text variant="body" color="textMuted" style={styles.label}>
        {row.title}
      </Text>
      <View style={styles.valueRow}>
        <View
          style={[
            styles.icon,
            {backgroundColor: colors.surfaceMuted, borderRadius: radius.full},
          ]}
        >
          <Ionicons
            name={categoryIconName(row.icon)}
            size={13}
            color={colors.textMuted}
          />
        </View>
        <Text variant="label" numberOfLines={2} style={styles.value}>
          {row.detail}
        </Text>
        {onOpen ? (
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        ) : null}
      </View>
    </View>
  );

  if (!onOpen) {
    return body;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${row.detail ?? ''}. Open transaction`}
      onPress={onOpen}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.rowPressable,
        {borderRadius: radius.md, opacity: pressed ? 0.85 : 1},
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flex: 1,
  },
  rowPressable: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginHorizontal: -4,
  },
  label: {flexShrink: 0},
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  value: {flexShrink: 1, textAlign: 'right'},
  icon: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
