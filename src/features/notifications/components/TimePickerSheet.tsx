import React from 'react';
import {FlatList, Modal, Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from '@/components/ui';
import {useTheme} from '@/theme';
import {formatTimeLabel} from '../time';
import type {ReminderTime} from '../types';

export interface TimePickerSheetProps {
  visible: boolean;
  selectedTime: ReminderTime;
  onSelect: (time: ReminderTime) => void;
  onClose: () => void;
}

interface TimeOption {
  time: ReminderTime;
  label: string;
}

/**
 * Reminder-time options: every 30 minutes from 6:00 AM to 11:00 PM — the
 * range that makes sense for a spending reminder. A plain scrollable list
 * styled exactly like the currency sheet: no custom picker dependency, no
 * new design language.
 */
function buildOptions(): TimeOption[] {
  const options: TimeOption[] = [];
  for (let hour = 6; hour <= 23; hour += 1) {
    for (const minute of [0, 30]) {
      const time = {hour, minute};
      options.push({time, label: formatTimeLabel(time)});
    }
  }
  return options;
}

const TIME_OPTIONS = buildOptions();

/** Same sheet language as CurrencyPickerSheet, for one purpose: pick the
 * daily reminder time. Tapping an option selects and closes. */
export function TimePickerSheet({
  visible,
  selectedTime,
  onSelect,
  onClose,
}: TimePickerSheetProps) {
  const {colors, radius, spacing} = useTheme();

  const selectedLabel = formatTimeLabel(selectedTime);

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
                Reminder time
              </Text>
              <Text variant="caption" color="textMuted" align="center">
                Uses your device&apos;s local time.
              </Text>

              <FlatList
                data={TIME_OPTIONS}
                keyExtractor={option => option.label}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                initialNumToRender={TIME_OPTIONS.length}
                renderItem={({item}) => {
                  const selected = item.label === selectedLabel;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{selected}}
                      accessibilityLabel={`Reminder at ${item.label}`}
                      onPress={() => {
                        onSelect(item.time);
                        onClose();
                      }}
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
                      <Text variant="body">{item.label}</Text>
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
                showsVerticalScrollIndicator
              />
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  stopPropagation: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
  },
  list: {
    marginTop: 4,
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
});
