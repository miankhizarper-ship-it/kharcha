import React from 'react';
import {
  RefreshControlProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useTheme} from '@/theme';

export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

export interface ScreenProps {
  /** Wrap content in a ScrollView (default: false). */
  scroll?: boolean;
  /** Apply standard horizontal padding (default: true). */
  padded?: boolean;
  /**
   * Safe-area edges to respect. Tab screens keep the default (bottom is
   * owned by the tab bar); modal screens pass all four edges.
   */
  edges?: ScreenEdge[];
  /** Extra padding for the scrollable content container (scroll only). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Attached to the inner ScrollView (scroll only), e.g. a RefreshControl. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * App-wide screen container: theme background, safe-area insets and
 * standard padding in one place.
 */
export function Screen({
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  contentContainerStyle,
  refreshControl,
  style,
  children,
}: ScreenProps) {
  const {colors, spacing} = useTheme();

  const baseContentStyle: StyleProp<ViewStyle> = [
    padded && {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
    contentContainerStyle,
    style,
  ];

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.fill, {backgroundColor: colors.background}]}
    >
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.growContent, baseContentStyle]}
          alwaysBounceVertical={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, baseContentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /** Bounded box: the SafeAreaView, the ScrollView viewport and the plain (non-scroll) content View. */
  fill: {flex: 1},
  /**
   * Content-container filler for the scroll branch. Must be `flexGrow: 1`,
   * never `flex: 1`: with `flex: 1` (flexBasis '0%' + flexShrink 1) Yoga
   * resolves the content container's measured height to the ScrollView's
   * viewport exactly, so the reported contentSize never exceeds the viewport
   * and tall content cannot scroll — while still painting below the fold.
   * `flexGrow: 1` (flexBasis auto, no shrink) fills the viewport for short
   * content and follows the content height when it overflows, keeping the
   * scroll extent correct.
   */
  growContent: {flexGrow: 1},
});
