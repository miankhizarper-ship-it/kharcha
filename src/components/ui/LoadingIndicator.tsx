import React from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';

import {useTheme} from '@/theme';

export interface LoadingIndicatorProps {
  /** Minimum height so list screens don't collapse while loading. */
  minHeight?: number;
}

/**
 * Centered, theme-colored loading placeholder.
 *
 * Replaces raw `<ActivityIndicator />` usages (which default to a low-
 * contrast gray, especially in dark mode) so every database-backed screen
 * loads with the same, visible spinner.
 */
export function LoadingIndicator({minHeight = 200}: LoadingIndicatorProps) {
  const {colors} = useTheme();

  return (
    <View
      style={[styles.container, {minHeight}]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {alignItems: 'center', justifyContent: 'center'},
});
