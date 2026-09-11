import React from 'react';
import {StyleSheet, View} from 'react-native';

import {useTheme} from '@/theme';

export interface ProgressBarProps {
  /** 0..1 — values outside the range (incl. NaN from guarded division) are clamped. */
  ratio: number;
  /** Fill color; callers pass theme-derived state colors. */
  color: string;
}

/**
 * Thin horizontal progress bar. Pure presentation: the ratio is clamped so
 * an exceeded budget (>= 100%) renders a full bar — the exceeded state is
 * communicated by the surrounding text/badge, not an overflowing bar.
 * NaN/Infinity ratios (defensive division guards upstream) clamp to 0.
 */
export function ProgressBar({ratio, color}: ProgressBarProps) {
  const {colors, radius} = useTheme();
  const safe = Number.isFinite(ratio) ? ratio : 0;
  const clamped = Math.min(1, Math.max(0, safe));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{min: 0, max: 1, now: clamped}}
      style={[
        styles.track,
        {backgroundColor: colors.surfaceMuted, borderRadius: radius.full},
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${clamped * 100}%`,
            backgroundColor: color,
            borderRadius: radius.full,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {height: 8, overflow: 'hidden', alignSelf: 'stretch'},
  fill: {height: '100%'},
});
