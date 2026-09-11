import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import type {RecurringRuleItem} from '../types';
import {frequencyLabel} from '../types';
import {formatShortDate} from '@/utils/date';
import {formatCurrency} from '@/utils/format';
import {useTheme} from '@/theme';

export interface RecurringRuleRowProps {
  rule: RecurringRuleItem;
  currency: string;
  onPress?: (rule: RecurringRuleItem) => void;
}

/**
 * One recurring RULE in the list screen: category icon, title, amount,
 * frequency, next occurrence and the active/paused/blocked state — the
 * layout mirrors `TransactionRow` so the two lists feel identical.
 *
 * Statuses:
 * - Active (primary): will generate when due;
 * - Paused (muted): stored but not generating;
 * - Needs attention (warning): expense rule whose category is archived —
 *   generation is blocked until the category is restored or changed.
 */
export function RecurringRuleRow({
  rule,
  currency,
  onPress,
}: RecurringRuleRowProps) {
  const {colors, radius, spacing} = useTheme();

  const status = rule.needsAttention
    ? {label: 'Needs attention', color: colors.warning}
    : rule.isActive
      ? {label: 'Active', color: colors.primary}
      : {label: 'Paused', color: colors.textMuted};

  // Same composed-sentence contract as TransactionRow: screen readers get
  // the full rule state (amount, cadence, next occurrence, status) instead
  // of an unlabelled glyph row.
  const a11yLabel = [
    rule.title,
    `${rule.type === 'income' ? '+' : '-'}${formatCurrency(
      rule.amount,
      currency,
    )}`,
    frequencyLabel(rule.frequency),
    `next ${formatShortDate(rule.nextOccurrenceAt)}`,
    status.label,
  ].join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={() => onPress?.(rule)}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderColor: rule.needsAttention ? colors.warning : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.full,
            marginRight: spacing.md,
          },
        ]}
      >
        <Ionicons
          name={categoryIconName(rule.categoryIcon ?? 'pricetag')}
          size={20}
          color={colors.textMuted}
        />
      </View>

      <View style={styles.copy}>
        <Text variant="body" numberOfLines={1} style={styles.title}>
          {rule.title}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {`${frequencyLabel(rule.frequency)} · Next: ${formatShortDate(rule.nextOccurrenceAt)}`}
        </Text>
        <Text variant="caption" numberOfLines={1} style={{color: status.color}}>
          {status.label}
        </Text>
      </View>

      <Text
        variant="label"
        style={{
          fontSize: 14,
          marginLeft: 8,
          color: rule.type === 'income' ? colors.primary : colors.text,
        }}
      >
        {rule.type === 'income' ? '+' : '-'}
        {formatCurrency(rule.amount, currency)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  title: {fontWeight: '500'},
});
