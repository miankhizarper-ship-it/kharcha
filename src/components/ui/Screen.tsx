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

  const contentStyle: StyleProp<ViewStyle> = [
    styles.grow,
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
      style={[styles.grow, {backgroundColor: colors.background}]}
    >
      {scroll ? (
        <ScrollView
          style={styles.grow}
          contentContainerStyle={contentStyle}
          alwaysBounceVertical={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={contentStyle}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  grow: {flex: 1},
});
