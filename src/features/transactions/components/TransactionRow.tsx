import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import type {TransactionItem} from '../types';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {paymentMethodLabel} from '@/features/expenses/paymentMethods';
import {formatShortDate} from '@/utils/date';
import {formatCurrency} from '@/utils/format';
import {useTheme} from '@/theme';

export interface TransactionRowProps {
  transaction: TransactionItem;
  currency: string;
  onPress?: (transaction: TransactionItem) => void;
}

/**
 * One transaction in a list (Transactions + dashboard recents), for either
 * side of the ledger:
 * - expenses render exactly as before: category icon, title, category ·
 *   date · payment method, `-amount`;
 * - income shows the source, date, optional note and a green `+amount`,
 *   making the direction of the money obvious at a glance.
 *
 * Memoized: the ledger list re-renders on every keystroke of the debounced
 * search, and rows only change when their item or currency changes.
 */
export const TransactionRow = React.memo(function TransactionRow({
  transaction,
  currency,
  onPress,
}: TransactionRowProps) {
  const {colors, radius, spacing, typography} = useTheme();

  const meta =
    transaction.type === 'expense'
      ? [
          transaction.category,
          formatShortDate(transaction.date),
          transaction.paymentMethod
            ? paymentMethodLabel(transaction.paymentMethod)
            : null,
        ]
      : [formatShortDate(transaction.date), transaction.note?.trim() || null];

  const isIncome = transaction.type === 'income';
  const amount = `${isIncome ? '+' : '-'}${formatCurrency(
    transaction.amount,
    currency,
  )}`;
  const isRecurring = transaction.recurringRuleId != null;

  // Screen readers get one composed sentence instead of fragmenting into
  // glyphs ("+", "-") and unlabelled icons.
  const a11yLabel = [
    transaction.title,
    amount,
    meta.filter(Boolean).join(', '),
    isRecurring ? 'Recurring transaction' : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={() => onPress?.(transaction)}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderColor: colors.border,
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
          name={categoryIconName(transaction.icon)}
          size={20}
          color={colors.textMuted}
        />
      </View>

      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text variant="body" numberOfLines={1} style={styles.title}>
            {transaction.title}
          </Text>
          {isRecurring ? (
            <Ionicons
              name="repeat"
              size={13}
              color={colors.textMuted}
              style={styles.recurringIcon}
            />
          ) : null}
        </View>
        <Text variant="caption" numberOfLines={1}>
          {meta.filter(Boolean).join(' · ')}
        </Text>
      </View>

      <Text
        variant="label"
        style={{
          fontSize: typography.size.body,
          marginLeft: spacing.sm,
          color: isIncome ? colors.primary : colors.text,
        }}
      >
        {amount}
      </Text>
    </Pressable>
  );
});

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
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  title: {fontWeight: '500', flexShrink: 1},
  recurringIcon: {marginLeft: 6},
});
