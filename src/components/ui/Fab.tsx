import React from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {useTheme} from '@/theme';

export const FAB_SIZE = 60;

export interface FabProps {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
}

/**
 * Circular floating action button.
 *
 * In Kharcha this is THE primary action: the custom tab bar positions it in
 * the center, opening "Add Expense". It is deliberately not a tab.
 */
export function Fab({onPress, icon = 'add', accessibilityLabel}: FabProps) {
  const {colors, elevation} = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{color: colors.overlay, radius: 40, foreground: true}}
      style={({pressed}) => [
        styles.fab,
        elevation.fab,
        {backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1},
      ]}
    >
      <Ionicons name={icon} size={28} color={colors.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
