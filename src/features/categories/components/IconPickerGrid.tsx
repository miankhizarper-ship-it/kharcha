import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {Text} from '@/components/ui';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {CATEGORY_ICON_CHOICES} from '../icons';
import {useTheme} from '@/theme';

export interface IconPickerGridProps {
  selectedKey: string;
  onSelect: (iconKey: string) => void;
  error?: string;
}

/**
 * Mobile-friendly grid of the app's controlled icon set (4 columns). Keys
 * come from `CATEGORY_ICON_CHOICES`; glyphs resolve through the shared
 * `categoryIconName` map — no external icon library is introduced.
 */
export function IconPickerGrid({
  selectedKey,
  onSelect,
  error,
}: IconPickerGridProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <View>
      <View style={styles.grid}>
        {CATEGORY_ICON_CHOICES.map(choice => {
          const selected = choice.key === selectedKey;
          return (
            <Pressable
              key={choice.key}
              accessibilityRole="button"
              accessibilityLabel={`Icon ${choice.label}`}
              accessibilityState={{selected}}
              onPress={() => onSelect(choice.key)}
              android_ripple={{color: colors.overlay, foreground: true}}
              style={[
                styles.cell,
                {
                  borderRadius: radius.md,
                  backgroundColor: selected
                    ? colors.primaryMuted
                    : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Ionicons
                name={categoryIconName(choice.key)}
                size={20}
                color={selected ? colors.primary : colors.textMuted}
              />
              <Text
                variant="caption"
                numberOfLines={1}
                style={{
                  color: selected ? colors.primary : colors.textMuted,
                }}
              >
                {choice.label}
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
  cell: {
    flexGrow: 1,
    width: '23%',
    minWidth: 72,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
});
