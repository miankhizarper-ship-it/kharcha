import React from 'react';

import {useTheme} from '@/theme';
import {Text} from './Text';

export interface FieldLabelProps {
  children: React.ReactNode;
  /**
   * Optional unique id. When provided, render the matching input with
   * `accessibilityLabelledBy={id}` so screen readers announce the field
   * name (React Native inputs have no native `for` association).
   */
  id?: string;
}

/** Small muted label rendered above a form field. */
export function FieldLabel({children, id}: FieldLabelProps) {
  const {colors, spacing} = useTheme();
  return (
    <Text
      variant="caption"
      nativeID={id}
      style={{color: colors.textMuted, marginBottom: spacing.xs}}
    >
      {children}
    </Text>
  );
}
