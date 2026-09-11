import React, {useState} from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Button, Text, TextInput} from '@/components/ui';
import type {Category} from '@/database/models';
import {PAYMENT_METHODS} from '@/database/models';
import {CalendarSheet} from '@/features/expenses/components/CalendarSheet';
import {paymentMethodLabel} from '@/features/expenses/paymentMethods';
import {atNoon, formatShortDate, startOfDay} from '@/utils/date';
import {
  formatDateRangeLabel,
  normalizeCustomRange,
} from '@/features/reports/period';
import {
  defaultTransactionFilters,
  validateAmountBound,
  validateAmountRange,
} from '../filters';
import type {TransactionFilters} from '../filters';
import {
  TRANSACTION_DATE_PERIODS,
  TRANSACTION_RECURRING_FILTERS,
  TRANSACTION_SORT_OPTIONS,
  TRANSACTION_TYPE_FILTERS,
  type TransactionCustomRange,
} from '../types';
import {formatMinorAsDecimal} from '@/utils/format';
import {sanitizeAmountInput} from '@/utils/money';
import {FilterChip} from './FilterChip';
import {useTheme} from '@/theme';

export interface FilterSheetProps {
  visible: boolean;
  /** Filter state the sheet starts from (re-applied fresh on every open). */
  initialFilters: TransactionFilters;
  /**
   * EVERY expense category — archived ones included — so historical
   * transactions stay discoverable under their archived category.
   */
  categories: Category[];
  currency: string;
  /** Commits the edited draft; the caller owns pagination invalidation. */
  onApply: (filters: TransactionFilters) => void;
  onClose: () => void;
}

type PickStage = 'start' | 'end';

/**
 * Dedicated filter sheet for the Transactions browser (spec §10) — the
 * screen stays clean while this sheet carries all seven filter dimensions:
 * type, category, payment method, recurring, date window (incl. custom via
 * the shared CalendarSheet), amount range and sort.
 *
 * Edits land in a DRAFT; nothing touches the list until "Apply filters".
 * Only ONE modal exists at a time (the sheet body switches to the calendar
 * while picking — nested modals misbehave on Android). The body mounts
 * fresh per open (same pattern as CalendarSheet/CustomRangeSheet).
 */
export function FilterSheet({
  visible,
  initialFilters,
  categories,
  currency,
  onApply,
  onClose,
}: FilterSheetProps) {
  if (!visible) {
    return <Modal visible={false} transparent animationType="none" />;
  }
  return (
    <SheetBody
      key={JSON.stringify(initialFilters)}
      initialFilters={initialFilters}
      categories={categories}
      currency={currency}
      onApply={onApply}
      onClose={onClose}
    />
  );
}

interface SheetBodyProps {
  initialFilters: TransactionFilters;
  categories: Category[];
  currency: string;
  onApply: (filters: TransactionFilters) => void;
  onClose: () => void;
}

function SheetBody({
  initialFilters,
  categories,
  currency,
  onApply,
  onClose,
}: SheetBodyProps) {
  const {colors, radius, spacing} = useTheme();

  const [todayMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<TransactionFilters>(initialFilters);
  const [minText, setMinText] = useState(() =>
    initialFilters.minAmount !== null
      ? formatMinorAsDecimal(initialFilters.minAmount)
      : '',
  );
  const [maxText, setMaxText] = useState(() =>
    initialFilters.maxAmount !== null
      ? formatMinorAsDecimal(initialFilters.maxAmount)
      : '',
  );
  const [amountError, setAmountError] = useState<string | null>(null);
  /** null = the sheet is open; otherwise the calendar is open. */
  const [picking, setPicking] = useState<PickStage | null>(null);

  const patch = (changes: Partial<TransactionFilters>) =>
    setDraft(previous => ({...previous, ...changes}));

  const changeType = (type: TransactionFilters['type']) => {
    // Category and payment method only exist for expenses; switching to
    // income clears them so the draft can never contradict itself.
    patch(
      type === 'income'
        ? {type, categoryId: null, paymentMethod: null}
        : {type},
    );
  };

  const changeMinText = (raw: string) => {
    setMinText(sanitizeAmountInput(raw));
    setAmountError(null);
  };

  const changeMaxText = (raw: string) => {
    setMaxText(sanitizeAmountInput(raw));
    setAmountError(null);
  };

  const apply = () => {
    const min = validateAmountBound(minText, 'Minimum');
    if (min.error) {
      setAmountError(min.error);
      return;
    }
    const max = validateAmountBound(maxText, 'Maximum');
    if (max.error) {
      setAmountError(max.error);
      return;
    }
    const rangeError = validateAmountRange(min.minor, max.minor);
    if (rangeError) {
      setAmountError(rangeError);
      return;
    }
    Keyboard.dismiss();
    onApply({...draft, minAmount: min.minor, maxAmount: max.minor});
  };

  const clearAll = () => {
    setDraft(defaultTransactionFilters());
    setMinText('');
    setMaxText('');
    setAmountError(null);
  };

  const range = draft.customRange;
  const resolvedRange =
    draft.period === 'custom' && range
      ? normalizeCustomRange(range.fromDate, range.toDate)
      : null;

  if (picking !== null) {
    return (
      <CalendarSheet
        visible
        value={noonOf(
          picking === 'start'
            ? (range?.fromDate ?? todayMs)
            : (range?.toDate ?? range?.fromDate ?? todayMs),
        )}
        onChange={picked => {
          patch({
            customRange: pickingDate(range, picking, picked),
          });
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
                  backgroundColor: colors.background,
                  borderTopLeftRadius: radius.lg,
                  borderTopRightRadius: radius.lg,
                },
              ]}
            >
              <View style={styles.header}>
                <Text variant="title">Filters</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close filters"
                  hitSlop={8}
                  onPress={onClose}
                  style={[
                    styles.closeButton,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.full,
                    },
                  ]}
                >
                  <Text variant="label">✕</Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.scroll}
                contentContainerStyle={{
                  padding: spacing.md,
                  gap: spacing.md,
                  paddingBottom: spacing.lg,
                }}
                keyboardShouldPersistTaps="handled"
              >
                <Section title="Type">
                  <Row>
                    {TRANSACTION_TYPE_FILTERS.map(option => (
                      <FilterChip
                        key={option.value}
                        label={option.label}
                        selected={draft.type === option.value}
                        onPress={() => changeType(option.value)}
                        accessibilityLabel={`${option.label} type filter, ${
                          draft.type === option.value
                            ? 'selected'
                            : 'not selected'
                        }`}
                      />
                    ))}
                  </Row>
                </Section>

                {draft.type !== 'income' ? (
                  <>
                    <Section title="Category">
                      <Row>
                        <FilterChip
                          label="All categories"
                          selected={draft.categoryId === null}
                          onPress={() => patch({categoryId: null})}
                          accessibilityLabel={`All categories filter, ${
                            draft.categoryId === null
                              ? 'selected'
                              : 'not selected'
                          }`}
                        />
                        {categories.map(category => (
                          <FilterChip
                            key={category.id}
                            label={category.name}
                            suffix={
                              category.isActive ? undefined : '(archived)'
                            }
                            dimmed={!category.isActive}
                            selected={draft.categoryId === category.id}
                            onPress={() => patch({categoryId: category.id})}
                            accessibilityLabel={`${
                              category.name
                            }${category.isActive ? '' : ', archived'} filter, ${
                              draft.categoryId === category.id
                                ? 'selected'
                                : 'not selected'
                            }`}
                          />
                        ))}
                      </Row>
                      {categories.some(category => !category.isActive) ? (
                        <Text variant="caption" color="textMuted">
                          Archived categories stay selectable — their historical
                          transactions remain searchable.
                        </Text>
                      ) : null}
                    </Section>

                    <Section title="Payment method">
                      <Row>
                        <FilterChip
                          label="All"
                          selected={draft.paymentMethod === null}
                          onPress={() => patch({paymentMethod: null})}
                          accessibilityLabel={`All payment methods filter, ${
                            draft.paymentMethod === null
                              ? 'selected'
                              : 'not selected'
                          }`}
                        />
                        {PAYMENT_METHODS.map(method => (
                          <FilterChip
                            key={method}
                            label={paymentMethodLabel(method)}
                            selected={draft.paymentMethod === method}
                            onPress={() => patch({paymentMethod: method})}
                            accessibilityLabel={`${paymentMethodLabel(
                              method,
                            )} filter, ${
                              draft.paymentMethod === method
                                ? 'selected'
                                : 'not selected'
                            }`}
                          />
                        ))}
                      </Row>
                    </Section>
                  </>
                ) : (
                  <Text variant="caption" color="textMuted">
                    Income has no category or payment method — those filters
                    apply to expenses only.
                  </Text>
                )}

                <Section title="Recurrence">
                  <Row>
                    {TRANSACTION_RECURRING_FILTERS.map(option => (
                      <FilterChip
                        key={option.value}
                        label={option.label}
                        selected={draft.recurring === option.value}
                        onPress={() => patch({recurring: option.value})}
                        accessibilityLabel={`${
                          option.value === 'all'
                            ? 'All transactions'
                            : option.label
                        } filter, ${
                          draft.recurring === option.value
                            ? 'selected'
                            : 'not selected'
                        }`}
                      />
                    ))}
                  </Row>
                </Section>

                <Section title="Date">
                  <Row>
                    {TRANSACTION_DATE_PERIODS.map(option => (
                      <FilterChip
                        key={option.value}
                        label={option.label}
                        selected={draft.period === option.value}
                        onPress={() => patch({period: option.value})}
                        accessibilityLabel={`${option.label} date filter, ${
                          draft.period === option.value
                            ? 'selected'
                            : 'not selected'
                        }`}
                      />
                    ))}
                  </Row>
                  {draft.period === 'custom' ? (
                    <>
                      <View style={styles.steps}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Choose start date"
                          onPress={() => setPicking('start')}
                          style={[
                            styles.stepChip,
                            {
                              borderRadius: radius.md,
                              borderColor: colors.border,
                              backgroundColor: colors.surface,
                            },
                          ]}
                        >
                          <Text variant="caption" color="textMuted">
                            START
                          </Text>
                          <Text variant="label">
                            {range ? formatShortDate(range.fromDate) : 'Pick'}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Choose end date"
                          onPress={() => setPicking('end')}
                          style={[
                            styles.stepChip,
                            {
                              borderRadius: radius.md,
                              borderColor: colors.border,
                              backgroundColor: colors.surface,
                            },
                          ]}
                        >
                          <Text variant="caption" color="textMuted">
                            END
                          </Text>
                          <Text variant="label">
                            {range ? formatShortDate(range.toDate) : 'Pick'}
                          </Text>
                        </Pressable>
                      </View>
                      <Text variant="caption" color="textMuted">
                        {resolvedRange
                          ? `Covers ${formatDateRangeLabel(
                              resolvedRange.fromDate,
                              resolvedRange.toDate,
                            )}`
                          : 'Pick a start date and an end date.'}
                      </Text>
                    </>
                  ) : null}
                </Section>

                <Section title="Amount range">
                  <View style={styles.amountRow}>
                    <View style={styles.amountField}>
                      <TextInput
                        label="Minimum"
                        value={minText}
                        onChangeText={changeMinText}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        accessibilityLabel={`Minimum amount filter, ${
                          minText.length > 0 ? minText : 'not set'
                        }`}
                      />
                    </View>
                    <View style={styles.amountField}>
                      <TextInput
                        label="Maximum"
                        value={maxText}
                        onChangeText={changeMaxText}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        accessibilityLabel={`Maximum amount filter, ${
                          maxText.length > 0 ? maxText : 'not set'
                        }`}
                      />
                    </View>
                  </View>
                  {amountError ? (
                    <Text
                      variant="caption"
                      style={{color: colors.danger}}
                      accessibilityLiveRegion="polite"
                    >
                      {amountError}
                    </Text>
                  ) : (
                    <Text variant="caption" color="textMuted">
                      Both fields optional — leave empty for no limit. Amounts
                      in {currency}.
                    </Text>
                  )}
                </Section>

                <Section title="Sort by">
                  <Row>
                    {TRANSACTION_SORT_OPTIONS.map(option => (
                      <FilterChip
                        key={option.value}
                        label={option.label}
                        selected={draft.sort === option.value}
                        onPress={() => patch({sort: option.value})}
                        accessibilityLabel={`Sort by ${option.label.toLowerCase()}, ${
                          draft.sort === option.value
                            ? 'selected'
                            : 'not selected'
                        }`}
                      />
                    ))}
                  </Row>
                </Section>
              </ScrollView>

              <View
                style={[
                  styles.actions,
                  {
                    padding: spacing.md,
                    gap: spacing.sm,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View style={styles.actionRow}>
                  <View style={styles.actionSide}>
                    <Button
                      title="Clear all"
                      variant="secondary"
                      onPress={clearAll}
                      fullWidth
                    />
                  </View>
                  <View style={styles.actionSide}>
                    <Button title="Apply filters" onPress={apply} fullWidth />
                  </View>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Section wrapper: small uppercase header + content. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const {spacing} = useTheme();
  return (
    <View style={{gap: spacing.sm}}>
      <Text variant="caption" color="textMuted">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

/** Inline chip row (single line, wraps on narrow screens). */
function Row({children}: {children: React.ReactNode}) {
  const {spacing} = useTheme();
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm}}>
      {children}
    </View>
  );
}

/** Local noon of `ms`'s day — the calendar's DST-safe anchor. */
function noonOf(ms: number): number {
  const date = new Date(ms);
  return atNoon(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Merges a picked day into the draft range: START replaces the lower end,
 * END the upper. When only one endpoint exists, the other stays unset so
 * the user completes the range explicitly.
 */
function pickingDate(
  range: TransactionCustomRange | null,
  stage: PickStage,
  pickedNoon: number,
): TransactionCustomRange {
  const picked = startOfDay(pickedNoon);
  if (stage === 'start') {
    return {fromDate: picked, toDate: range?.toDate ?? picked};
  }
  return {fromDate: range?.fromDate ?? picked, toDate: picked};
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, justifyContent: 'flex-end'},
  stopPropagation: {flexGrow: 1, justifyContent: 'flex-end'},
  sheetWrap: {flexGrow: 1, justifyContent: 'flex-end'},
  sheet: {
    width: '100%',
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {flexGrow: 0},
  steps: {
    flexDirection: 'row',
    gap: 8,
  },
  stepChip: {
    flex: 1,
    borderWidth: 1,
    padding: 10,
    gap: 2,
  },
  amountRow: {
    flexDirection: 'row',
    gap: 8,
  },
  amountField: {flex: 1},
  actions: {borderTopWidth: 1},
  actionRow: {flexDirection: 'row', gap: 8},
  actionSide: {flex: 1},
});
