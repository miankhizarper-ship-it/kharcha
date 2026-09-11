import React, {useState} from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Button, Text} from '@/components/ui';
import {CalendarSheet} from '@/features/expenses/components/CalendarSheet';
import {formatShortDate, atNoon} from '@/utils/date';
import {
  formatDateRangeLabel,
  normalizeCustomRange,
} from '@/features/reports/period';
import {useTheme} from '@/theme';

export interface CustomRangeSheetProps {
  visible: boolean;
  /** Preselected start (epoch millis) when reopening the sheet. */
  initialFrom?: number;
  /** Preselected end (epoch millis) when reopening the sheet. */
  initialTo?: number;
  /** Called with the normalized range (startOfDay/endOfDay bounds). */
  onApply: (fromDate: number, toDate: number) => void;
  onClose: () => void;
}

type PickStage = 'start' | 'end';

/**
 * Custom-range picker: a small sheet with START/END chips that opens the
 * shared CalendarSheet for whichever endpoint is being picked. Reversed
 * picks are normalized on apply — never an error — and picking the same day
 * twice yields a valid single-day range.
 *
 * Only ONE modal exists at a time: either the range sheet or the calendar
 * (nested modals misbehave on Android). The body mounts fresh per open
 * (same pattern as CalendarSheet) so no synchronization effects are needed.
 */
export function CustomRangeSheet({
  visible,
  initialFrom,
  initialTo,
  onApply,
  onClose,
}: CustomRangeSheetProps) {
  if (!visible) {
    return <Modal visible={false} transparent animationType="none" />;
  }
  return (
    <SheetBody
      key={`${initialFrom ?? 0}-${initialTo ?? 0}`}
      initialFrom={initialFrom}
      initialTo={initialTo}
      onApply={onApply}
      onClose={onClose}
    />
  );
}

interface SheetBodyProps {
  initialFrom?: number;
  initialTo?: number;
  onApply: (fromDate: number, toDate: number) => void;
  onClose: () => void;
}

function SheetBody({initialFrom, initialTo, onApply, onClose}: SheetBodyProps) {
  const {colors, radius, spacing} = useTheme();

  const [todayMs] = useState(() => Date.now());
  /** null = the range sheet is open; otherwise the calendar is open. */
  const [picking, setPicking] = useState<PickStage | null>(null);
  const [from, setFrom] = useState<number | null>(initialFrom ?? null);
  const [to, setTo] = useState<number | null>(initialTo ?? null);

  const normalized =
    from !== null && to !== null ? normalizeCustomRange(from, to) : null;

  if (picking !== null) {
    return (
      <CalendarSheet
        visible
        value={
          picking === 'start'
            ? noonOf(from ?? todayMs)
            : noonOf(to ?? from ?? todayMs)
        }
        onChange={picked => {
          // CalendarSheet fires onChange then its own onClose, which returns
          // to the sheet below — the START/END chips re-open it per step.
          if (picking === 'start') {
            setFrom(picked);
          } else {
            setTo(picked);
          }
        }}
        onClose={() => setPicking(null)}
      />
    );
  }

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
                  gap: spacing.sm,
                },
              ]}
            >
              <Text variant="title">Custom Range</Text>

              <View style={[styles.steps, {gap: spacing.sm}]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose start date"
                  onPress={() => setPicking('start')}
                  style={[
                    styles.stepChip,
                    {
                      borderRadius: radius.md,
                      borderColor: colors.primary,
                      backgroundColor: colors.primaryMuted,
                    },
                  ]}
                >
                  <Text variant="caption" color="textMuted">
                    START
                  </Text>
                  <Text variant="label">
                    {from !== null ? formatShortDate(from) : 'Pick start'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose end date"
                  onPress={() => setPicking('end')}
                  disabled={from === null}
                  style={[
                    styles.stepChip,
                    {
                      borderRadius: radius.md,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      opacity: from === null ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text variant="caption" color="textMuted">
                    END
                  </Text>
                  <Text variant="label">
                    {to !== null ? formatShortDate(to) : 'Pick end'}
                  </Text>
                </Pressable>
              </View>

              <Text variant="caption" color="textMuted">
                {normalized
                  ? `Report covers ${formatDateRangeLabel(
                      normalized.fromDate,
                      normalized.toDate,
                    )}`
                  : 'Pick a start date, then an end date. Same-day ranges are allowed.'}
              </Text>

              <View style={{marginTop: spacing.xs}}>
                <Button
                  title="Apply Range"
                  onPress={() => {
                    if (normalized) {
                      onApply(normalized.fromDate, normalized.toDate);
                    }
                  }}
                  disabled={!normalized}
                  fullWidth
                />
              </View>
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

/** Local noon of `ms`'s day — the calendar's DST-safe default anchor. */
function noonOf(ms: number): number {
  const date = new Date(ms);
  return atNoon(date.getFullYear(), date.getMonth(), date.getDate());
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
  steps: {flexDirection: 'row'},
  stepChip: {
    flex: 1,
    borderWidth: 1,
    padding: 10,
    gap: 2,
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
