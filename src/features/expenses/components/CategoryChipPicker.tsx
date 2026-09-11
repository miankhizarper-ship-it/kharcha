import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import type {Category} from '@/database/models';
import {categoryIconName} from '../categoryIcons';
import {useTheme} from '@/theme';

export interface CategoryChipPickerProps {
  categories: Category[];
  selectedId: number | null;
  onSelect: (categoryId: number) => void;
  /** Shown under the grid when a selection is required and missing. */
  error?: string;
  /**
   * Ids in `categories` that are archived/disabled (edit flows append the
   * record's legacy category so it stays visible and selectable). Rendered
   * muted — never offered for NEW transactions.
   */
  inactiveIds?: readonly number[];
}

/**
 * Grid of category chips for the Add/Edit form. Categories come from the
 * database (`ExpenseFeature.listCategories`), never hardcoded.
 */
export function CategoryChipPicker({
  categories,
  selectedId,
  onSelect,
  error,
  inactiveIds = [],
}: CategoryChipPickerProps) {
  const {colors, radius, spacing} = useTheme();
  const inactiveSet = new Set(inactiveIds);

  return (
    <View>
      <View style={styles.grid}>
        {categories.map(category => {
          const selected = category.id === selectedId;
          const inactive = inactiveSet.has(category.id);
          return (
            <Pressable
              key={category.id}
              accessibilityRole="button"
              accessibilityState={{selected}}
              accessibilityLabel={
                inactive ? `${category.name} (off)` : category.name
              }
              onPress={() => onSelect(category.id)}
              android_ripple={{color: colors.overlay, foreground: true}}
              style={[
                styles.chip,
                {
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.primary : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                  opacity: inactive && !selected ? 0.55 : 1,
                },
              ]}
            >
              <Ionicons
                name={categoryIconName(category.icon)}
                size={16}
                color={selected ? colors.onPrimary : colors.textMuted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.chipLabel,
                  {color: selected ? colors.onPrimary : colors.text},
                ]}
              >
                {category.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text
          variant="caption"
          style={{color: colors.danger, marginTop: spacing.xs}}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    maxWidth: '48%',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
  },
});
