import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from '@/components/ui';
import {useTheme} from '@/theme';

export interface AddActionSheetProps {
  visible: boolean;
  onAddExpense: () => void;
  onAddIncome: () => void;
  onClose: () => void;
}

/**
 * Bottom sheet behind the central + button: choose between recording an
 * expense or income. Pure JS (no extra dependencies), themed for light and
 * dark, matching the CalendarSheet's visual language.
 */
export function AddActionSheet({
  visible,
  onAddExpense,
  onAddIncome,
  onClose,
}: AddActionSheetProps) {
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
              <Text
                variant="title"
                style={{marginBottom: spacing.md}}
                align="center"
              >
                What do you want to add?
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add expense"
                onPress={onAddExpense}
                android_ripple={{color: colors.overlay, foreground: true}}
                style={({pressed}) => [
                  styles.option,
                  {
                    borderRadius: radius.md,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.optionIcon,
                    {
                      backgroundColor: colors.dangerMuted,
                      borderRadius: radius.full,
                    },
                  ]}
                >
                  <Ionicons name="arrow-down" size={20} color={colors.danger} />
                </View>
                <View style={styles.optionCopy}>
                  <Text variant="label">Expense</Text>
                  <Text variant="caption">Money you spent</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add income"
                onPress={onAddIncome}
                android_ripple={{color: colors.overlay, foreground: true}}
                style={({pressed}) => [
                  styles.option,
                  {
                    borderRadius: radius.md,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.optionIcon,
                    {
                      backgroundColor: colors.primaryMuted,
                      borderRadius: radius.full,
                    },
                  ]}
                >
                  <Ionicons name="arrow-up" size={20} color={colors.primary} />
                </View>
                <View style={styles.optionCopy}>
                  <Text variant="label">Income</Text>
                  <Text variant="caption">Money you received</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={[
                  styles.cancelButton,
                  {
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceMuted,
                    marginTop: spacing.sm,
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
  sheet: {width: '100%'},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  optionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionCopy: {flex: 1, gap: 2},
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
