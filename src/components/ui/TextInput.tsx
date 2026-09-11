import React, {useState} from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  View,
} from 'react-native';

import {useTheme} from '@/theme';

export interface TextInputProps extends RNTextInputProps {
  label?: string;
  /**
   * Optional nativeID applied to the rendered label so the input can point
   * back at it with `accessibilityLabelledBy` (screen readers then announce
   * the field name before its value).
   */
  labelId?: string;
  error?: string;
}

/** Themed text input with optional label and inline error message. */
export function TextInput({
  label,
  labelId,
  error,
  style,
  ...rest
}: TextInputProps) {
  const {colors, radius, spacing, typography} = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = error
    ? colors.danger
    : isFocused
      ? colors.primary
      : colors.border;

  return (
    <View style={styles.container}>
      {label ? (
        <RNText
          nativeID={labelId}
          style={{
            color: colors.textMuted,
            fontSize: typography.size.caption,
            fontWeight: typography.weight.medium,
            marginBottom: spacing.xs,
          }}
        >
          {label}
        </RNText>
      ) : null}
      <RNTextInput
        placeholderTextColor={colors.textMuted}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor,
            color: colors.text,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm + 2,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <RNText
          style={{
            color: colors.danger,
            fontSize: typography.size.caption,
            marginTop: spacing.xs,
          }}
        >
          {error}
        </RNText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {alignSelf: 'stretch'},
  input: {borderWidth: 1},
});
