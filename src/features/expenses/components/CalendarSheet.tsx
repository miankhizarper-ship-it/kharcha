import React, {useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from '@/components/ui';
import {atNoon, formatShortDate} from '@/utils/date';
import {useTheme} from '@/theme';

export interface CalendarSheetProps {
  visible: boolean;
  /** Selected date (epoch millis). */
  value: number;
  onChange: (dateMs: number) => void;
  onClose: () => void;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Bottom-sheet month calendar for picking an expense date.
 *
 * Pure JS (no native date-picker dependency): themed for light/dark, works
 * offline, and behaves identically in every environment. Days commit as local
 * noon to stay clear of DST boundaries.
 *
 * The grid mounts only while the sheet is open, so it always re-anchors to
 * the currently selected month without any synchronization effects.
 */
export function CalendarSheet({
  visible,
  value,
  onChange,
  onClose,
}: CalendarSheetProps) {
  if (!visible) {
    return <Modal visible={false} transparent animationType="none" />;
  }
  return (
    <MonthGrid
      key={value}
      value={value}
      onChange={onChange}
      onClose={onClose}
    />
  );
}

interface MonthGridProps {
  value: number;
  onChange: (dateMs: number) => void;
  onClose: () => void;
}

function MonthGrid({value, onChange, onClose}: MonthGridProps) {
  const {colors, radius, spacing, typography} = useTheme();
  const {width} = useWindowDimensions();

  // Initializers run once per open: "today" marker + the month of the
  // selected date.
  const [todayMs] = useState(() => Date.now());
  const [displayed, setDisplayed] = useState(() => new Date(value));

  const year = displayed.getFullYear();
  const monthIndex = displayed.getMonth();

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const blanks = Array.from({length: firstWeekday}, (_, i) => i);
    const days = Array.from({length: dayCount}, (_, i) => i + 1);
    return [
      ...blanks.map(blank => ({kind: 'blank' as const, blank})),
      ...days.map(day => ({kind: 'day' as const, day})),
    ];
  }, [year, monthIndex]);

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, monthIndex, 1));

  const stepMonth = (delta: number) => {
    setDisplayed(new Date(year, monthIndex + delta, 1));
  };

  const cellSize = Math.min(44, Math.floor((width - 64) / 7) - 2);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
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
              <View style={styles.header}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  onPress={() => stepMonth(-1)}
                  style={styles.navButton}
                >
                  <Ionicons name="chevron-back" size={20} color={colors.text} />
                </Pressable>
                <Text variant="title">{monthLabel}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  onPress={() => stepMonth(1)}
                  style={styles.navButton}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.text}
                  />
                </Pressable>
              </View>

              <View style={styles.weekRow}>
                {WEEKDAY_LABELS.map(label => (
                  <View
                    key={label}
                    style={[styles.weekCell, {width: cellSize}]}
                  >
                    <Text variant="caption">{label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.grid}>
                {cells.map((cell, index) => {
                  if (cell.kind === 'blank') {
                    return (
                      <View
                        key={`blank-${index}`}
                        style={[
                          styles.dayCell,
                          {width: cellSize, height: cellSize},
                        ]}
                      />
                    );
                  }
                  const dayMs = atNoon(year, monthIndex, cell.day);
                  const selected = isSameLocalDay(dayMs, value);
                  const today = isSameLocalDay(dayMs, todayMs);
                  return (
                    <Pressable
                      key={`day-${cell.day}`}
                      accessibilityRole="button"
                      accessibilityLabel={formatShortDate(dayMs)}
                      accessibilityState={{selected}}
                      onPress={() => {
                        onChange(dayMs);
                        onClose();
                      }}
                      style={[
                        styles.dayCell,
                        {width: cellSize, height: cellSize},
                      ]}
                    >
                      <View
                        style={[
                          styles.dayInner,
                          {
                            borderRadius: radius.full,
                            backgroundColor: selected
                              ? colors.primary
                              : 'transparent',
                            borderWidth: today && !selected ? 1 : 0,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? colors.onPrimary : colors.text,
                            fontSize: typography.size.body,
                            fontWeight: selected
                              ? typography.weight.semibold
                              : typography.weight.regular,
                          }}
                        >
                          {cell.day}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={[
                  styles.doneButton,
                  {
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceMuted,
                    marginTop: spacing.md,
                  },
                ]}
              >
                <Text variant="label">Close</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  weekCell: {alignItems: 'center'},
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  dayCell: {alignItems: 'center', justifyContent: 'center', marginBottom: 4},
  dayInner: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
