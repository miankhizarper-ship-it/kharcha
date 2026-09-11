import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import {useTheme} from '@/theme';

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /**
   * Announced instead of the visual label (Phase 11): chips describe WHAT
   * they filter and their state, e.g. "Food filter, selected".
   */
  accessibilityLabel?: string;
  /**
   * Visual dimming for archived categories. Never the ONLY signal — callers
   * pair it with a text suffix or an explicit accessibility label.
   */
  dimmed?: boolean;
  /** Optional muted suffix rendered after the label, e.g. "(archived)". */
  suffix?: string;
}

/**
 * Single chip implementation for the Transactions browser (screen rows and
 * the filter sheet). Theme-token only — the selected state flips surface to
 * primary and stays legible in both palettes.
 */
export function FilterChip({
  label,
  selected,
  onPress,
  icon,
  accessibilityLabel,
  dimmed = false,
  suffix,
}: FilterChipProps) {
  const {colors, radius, typography} = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.chip,
        {
          borderRadius: radius.full,
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          opacity: dimmed ? 0.7 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? colors.onPrimary : colors.textMuted}
          style={styles.icon}
        />
      ) : null}
      <View style={styles.row}>
        <Text
          numberOfLines={1}
          style={{
            color: selected ? colors.onPrimary : colors.text,
            fontSize: typography.size.label,
            fontWeight: typography.weight.medium,
          }}
        >
          {label}
        </Text>
        {suffix ? (
          <Text
            numberOfLines={1}
            style={{
              color: selected ? colors.onPrimary : colors.textMuted,
              fontSize: typography.size.caption,
            }}
          >
            {' '}
            {suffix}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  icon: {marginRight: 4},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
