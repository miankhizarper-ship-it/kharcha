import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {useTheme} from '@/theme';
import {Text} from './Text';

export interface SegmentedControlProps {
  /** Ordered segment labels; indexes align with `selectedIndex`. */
  segments: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Small two/three-way segmented control (e.g. [Expenses] [Income]) built on
 * theme tokens only — no new dependencies.
 */
export function SegmentedControl({
  segments,
  selectedIndex,
  onSelect,
}: SegmentedControlProps) {
  const {colors, radius} = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.md,
          padding: 3,
          gap: 3,
        },
      ]}
    >
      {segments.map((label, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={label}
            accessibilityRole="tab"
            accessibilityState={{selected}}
            accessibilityLabel={label}
            onPress={() => onSelect(index)}
            android_ripple={{color: colors.overlay, foreground: true}}
            style={[
              styles.segment,
              {
                borderRadius: radius.sm,
                backgroundColor: selected ? colors.primary : 'transparent',
              },
            ]}
          >
            <Text
              variant="label"
              numberOfLines={1}
              style={{color: selected ? colors.onPrimary : colors.textMuted}}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
