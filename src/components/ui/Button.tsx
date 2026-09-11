import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';

import {useTheme} from '@/theme';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

/** Themed, accessible button with press ripple and loading state. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
}: ButtonProps) {
  const {colors, radius, spacing, typography} = useTheme();

  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : colors.surfaceMuted;
  const foreground =
    variant === 'secondary'
      ? colors.text
      : variant === 'danger'
        ? colors.onDanger
        : colors.onPrimary;

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.base,
        {
          backgroundColor: background,
          borderRadius: radius.md,
          paddingVertical: spacing.sm + 4,
          paddingHorizontal: spacing.lg,
          opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
        },
        fullWidth && styles.fullWidth,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={foreground} /> : null}
        <RNText
          style={{
            color: foreground,
            fontSize: typography.size.body,
            fontWeight: typography.weight.semibold,
          }}
        >
          {title}
        </RNText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {alignSelf: 'stretch'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
