import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import type {Category} from '@/database/models';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {useTheme} from '@/theme';

export interface CategoryRowProps {
  category: Category;
  onPress?: (category: Category) => void;
}

/**
 * One row of the category management list: icon, name, archived badge and a
 * chevron. Rows open the edit sheet; nothing here mutates data directly.
 */
export function CategoryRow({category, onPress}: CategoryRowProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit category ${category.name}`}
      accessibilityState={{disabled: !category.isActive}}
      onPress={() => onPress?.(category)}
      android_ripple={{color: colors.overlay, foreground: true}}
      style={({pressed}) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : category.isActive ? 1 : 0.7,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
        },
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.full,
            marginRight: spacing.md,
          },
        ]}
      >
        <Ionicons
          name={categoryIconName(category.icon)}
          size={20}
          color={colors.textMuted}
        />
      </View>

      <View style={styles.copy}>
        <Text variant="body" numberOfLines={1}>
          {category.name}
        </Text>
        {!category.isActive ? (
          <Text variant="caption" color="textMuted">
            Off — hidden when adding new transactions
          </Text>
        ) : null}
      </View>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.textMuted}
        style={styles.chevron}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  chevron: {marginLeft: 4},
});
