import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {useTheme} from '@/theme';
import {Text} from './Text';

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  /** Optional call-to-action rendered below the message. */
  action?: React.ReactNode;
}

/** Centered placeholder shown when a screen has no content yet. */
export function EmptyState({
  icon = 'wallet-outline',
  title,
  message,
  action,
}: EmptyStateProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <View style={[styles.container, {paddingVertical: spacing.xl}]}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.full,
            marginBottom: spacing.md,
          },
        ]}
      >
        <Ionicons name={icon} size={28} color={colors.textMuted} />
      </View>
      <Text variant="title" align="center">
        {title}
      </Text>
      {message ? (
        <Text
          variant="body"
          color="textMuted"
          align="center"
          style={{marginTop: spacing.sm, maxWidth: 280}}
        >
          {message}
        </Text>
      ) : null}
      {action ? <View style={{marginTop: spacing.md}}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {alignItems: 'center', alignSelf: 'stretch'},
  iconCircle: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
