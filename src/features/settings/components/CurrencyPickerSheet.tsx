import React from 'react';
import {FlatList, Modal, Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from '@/components/ui';
import {CURRENCY_OPTIONS} from '../currencies';
import {useTheme} from '@/theme';

export interface CurrencyPickerSheetProps {
  visible: boolean;
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

/**
 * Full-height modal list of supported display currencies. One tap selects
 * and closes; nothing is saved until the caller persists the choice.
 */
export function CurrencyPickerSheet({
  visible,
  selectedCode,
  onSelect,
  onClose,
}: CurrencyPickerSheetProps) {
  const {colors, radius, spacing} = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, {backgroundColor: colors.backdrop}]}
        onPress={onClose}
      >
        <Pressable style={styles.stopPropagation}>
          <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surface,
                  borderTopLeftRadius: radius.lg,
                  borderTopRightRadius: radius.lg,
                  padding: spacing.md,
                },
              ]}
            >
              <Text variant="title" align="center">
                Currency
              </Text>
              <Text variant="caption" color="textMuted" align="center">
                Changes how amounts are displayed. Your records are never
                converted.
              </Text>

              <FlatList
                data={CURRENCY_OPTIONS}
                keyExtractor={option => option.code}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                renderItem={({item}) => {
                  const selected = item.code === selectedCode;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{selected}}
                      accessibilityLabel={`${item.name} (${item.code})`}
                      onPress={() => onSelect(item.code)}
                      android_ripple={{color: colors.overlay, foreground: true}}
                      style={({pressed}) => [
                        styles.row,
                        {
                          borderRadius: radius.md,
                          backgroundColor: selected
                            ? colors.primaryMuted
                            : colors.surface,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <View style={styles.copy}>
                        <Text variant="label">{item.code}</Text>
                        <Text variant="caption" color="textMuted">
                          {item.name}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={20}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                }}
              />

              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={[
                  styles.cancelButton,
                  {
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceMuted,
                  },
                ]}
              >
                <Text variant="label">Cancel</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Scrim color comes from the theme token (`colors.backdrop`) at render
  // time — light and dark modes intentionally use different opacities.
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  stopPropagation: {flexGrow: 1, justifyContent: 'flex-end'},
  sheetWrap: {flexGrow: 1, justifyContent: 'flex-end'},
  sheet: {width: '100%', maxHeight: '80%', gap: 12},
  list: {flexGrow: 0},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  copy: {flexShrink: 1, gap: 1},
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
