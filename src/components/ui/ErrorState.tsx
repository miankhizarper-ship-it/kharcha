import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {useTheme} from '@/theme';
import {Button} from './Button';
import {Text} from './Text';

export interface ErrorStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
  message?: string;
  /** Called when the user taps "Try again". Omit for a non-retryable error. */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Centered, themed error placeholder with an optional retry action.
 *
 * Standardizes the error copy contract across the app: a friendly title, a
 * human message (never raw SQL or stack traces), and one consistent retry
 * button. Pass `title`/`message` only when the default wording does not fit.
 */
export function ErrorState({
  icon = 'cloud-offline-outline',
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Your data stays safely on this device.',
  onRetry,
  retryLabel = 'Try again',
}: ErrorStateProps) {
  const {colors, spacing, radius} = useTheme();

  return (
    <View
      style={[styles.container, {paddingVertical: spacing.xl}]}
      accessibilityLiveRegion="polite"
    >
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
      <Text
        variant="body"
        color="textMuted"
        align="center"
        style={{marginTop: spacing.sm, maxWidth: 280}}
      >
        {message}
      </Text>
      {onRetry ? (
        <View style={[styles.action, {marginTop: spacing.md}]}>
          <Button title={retryLabel} variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
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
  action: {alignSelf: 'stretch', maxWidth: 280},
});
