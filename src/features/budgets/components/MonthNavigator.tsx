import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import {useTheme} from '@/theme';
import {formatMonthLabel} from '@/utils/date';

export interface MonthNavigatorProps {
  year: number;
  /** 1-12. */
  month: number;
  /** Omitted when the earliest supported month is displayed. */
  onPrevious?: () => void;
  /** Omitted when the latest supported month is displayed. */
  onNext?: () => void;
}

/** "< September 2026 >" — steps the Budget screen between months. */
export function MonthNavigator({
  year,
  month,
  onPrevious,
  onNext,
}: MonthNavigatorProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          marginVertical: spacing.md,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        onPress={onPrevious}
        disabled={!onPrevious}
        android_ripple={{color: colors.overlay}}
        style={({pressed}) => [
          styles.chevron,
          {
            borderRadius: radius.md,
            opacity: !onPrevious ? 0.35 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
      </Pressable>

      <Text variant="title" style={styles.label} numberOfLines={1}>
        {formatMonthLabel(year, month)}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next month"
        onPress={onNext}
        disabled={!onNext}
        android_ripple={{color: colors.overlay}}
        style={({pressed}) => [
          styles.chevron,
          {
            borderRadius: radius.md,
            opacity: !onNext ? 0.35 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  chevron: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {flex: 1, textAlign: 'center'},
});
