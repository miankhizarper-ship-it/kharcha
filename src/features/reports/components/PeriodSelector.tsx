import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {Text} from '@/components/ui';
import type {ReportPreset} from '@/features/reports/types';
import {useTheme} from '@/theme';

export interface PeriodSelectorProps {
  /** Currently highlighted preset, or null for a navigated month. */
  active: ReportPreset | null;
  onSelect: (preset: ReportPreset) => void;
  disabled?: boolean;
}

const PRESETS: {value: ReportPreset; label: string}[] = [
  {value: 'thisWeek', label: 'This Week'},
  {value: 'thisMonth', label: 'This Month'},
  {value: 'lastMonth', label: 'Last Month'},
  {value: 'custom', label: 'Custom'},
];

/** Row of period preset chips ("[This Week] [This Month] [Last Month] [Custom]"). */
export function PeriodSelector({
  active,
  onSelect,
  disabled = false,
}: PeriodSelectorProps) {
  const {colors, radius, spacing, typography} = useTheme();

  return (
    <View style={styles.row}>
      {PRESETS.map(preset => {
        const isActive = preset.value === active;
        return (
          <Pressable
            key={preset.value}
            accessibilityRole="button"
            accessibilityLabel={`Show ${preset.label}`}
            accessibilityState={{selected: isActive}}
            disabled={disabled}
            onPress={() => onSelect(preset.value)}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? colors.primary : colors.surface,
                borderColor: isActive ? colors.primary : colors.border,
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm + 2,
                paddingVertical: spacing.xs + 2,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: typography.size.caption,
                fontWeight: isActive
                  ? typography.weight.semibold
                  : typography.weight.medium,
                color: isActive ? colors.onPrimary : colors.textMuted,
              }}
            >
              {preset.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
