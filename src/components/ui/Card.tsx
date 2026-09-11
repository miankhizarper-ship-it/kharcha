import React from 'react';
import {StyleProp, StyleSheet, View, ViewProps, ViewStyle} from 'react-native';

import {useTheme} from '@/theme';

export interface CardProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

/** Elevated surface for grouping related content. */
export function Card({style, children, ...rest}: CardProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderColor: colors.border,
          padding: spacing.md,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {borderWidth: 1},
});
