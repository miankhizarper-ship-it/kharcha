import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextProps as RNTextProps,
  TextStyle,
} from 'react-native';

import {useTheme} from '@/theme';
import type {ThemeColors} from '@/theme/colors';

export type TextVariant = 'display' | 'title' | 'body' | 'label' | 'caption';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Any key of the theme palette; defaults to the variant's base color. */
  color?: keyof ThemeColors;
  align?: 'left' | 'center' | 'right';
}

/**
 * Themed text primitive. Every screen text should go through this component
 * so typography and colors stay consistent across both palettes.
 */
export function Text({
  variant = 'body',
  color,
  align,
  style,
  ...rest
}: TextProps) {
  const {colors, typography} = useTheme();

  const variantStyle: TextStyle = {
    display: {
      fontSize: typography.size.display,
      fontWeight: typography.weight.bold,
      color: colors.text,
    },
    title: {
      fontSize: typography.size.title,
      fontWeight: typography.weight.semibold,
      color: colors.text,
    },
    body: {
      fontSize: typography.size.body,
      fontWeight: typography.weight.regular,
      color: colors.text,
    },
    label: {
      fontSize: typography.size.label,
      fontWeight: typography.weight.medium,
      color: colors.text,
    },
    caption: {
      fontSize: typography.size.caption,
      fontWeight: typography.weight.regular,
      color: colors.textMuted,
    },
  }[variant];

  const colorStyle: TextStyle | undefined = color
    ? {color: colors[color]}
    : undefined;

  const alignStyle: TextStyle | undefined = align
    ? {textAlign: align}
    : undefined;

  const composedStyle: StyleProp<TextStyle> = [
    styles.base,
    variantStyle,
    colorStyle,
    alignStyle,
    style,
  ];

  return <RNText style={composedStyle} {...rest} />;
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
});
