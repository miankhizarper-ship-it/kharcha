import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Screen,
  SegmentedControl,
  Text,
  TextInput,
} from '@/components/ui';
import type {Category, CategoryType} from '@/database/models';
import {
  buildRecurringDraft,
  buildRecurringPatch,
  initialRecurringFormValues,
  isRecurringFormValid,
  validateRecurringForm,
  type RecurringFormErrors,
  type RecurringFormValues,
} from '../form';
import {FREQUENCY_OPTIONS} from '../types';
import {
  describeDeleteError,
  describeSaveError,
} from '@/features/recurring/errors';
import {CategoryChipPicker} from '@/features/expenses/components/CategoryChipPicker';
import {CalendarSheet} from '@/features/expenses/components/CalendarSheet';
import {PaymentMethodPicker} from '@/features/expenses/components/PaymentMethodPicker';
import {useRecurringFeature} from '../useRecurringFeature';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import {formatShortDate} from '@/utils/date';
import {sanitizeAmountInput} from '@/utils/money';
import type {RootStackParamList} from '@/navigation/types';

type EditLoadState = 'loading' | 'ready' | 'missing';

/** Duration the success banner is shown before the screen pops. */
const SUCCESS_DISMISS_MS = 750;

function ruleToFormValues(rule: {
  amount: number;
  title: string;
  categoryId: number | null;
  frequency: RecurringFormValues['frequency'];
  startDate: number;
  nextOccurrenceAt: number;
  endDate: number | null;
  paymentMethod: RecurringFormValues['paymentMethod'] | null;
  note: string | null;
}): RecurringFormValues {
  return {
    amount: (rule.amount / 100).toFixed(2),
    title: rule.title,
    categoryId: rule.categoryId,
    startDate: rule.startDate,
    nextOccurrenceAt: rule.nextOccurrenceAt,
    frequency: rule.frequency,
    hasEndDate: rule.endDate !== null,
    endDate: rule.endDate ?? rule.nextOccurrenceAt,
    paymentMethod: rule.paymentMethod ?? 'cash',
    note: rule.note ?? '',
  };
}

/**
 * Add/Edit recurring RULE (one reusable form for expense + income rules).
 *
 * The form only orchestrates interaction — validation lives in `../form`
 * and persistence in the recurring feature service. Editing a rule never
 * touches the transactions it already generated; deleting asks for
 * confirmation and explicitly promises to keep generated history
 * (spec §9/§11).
 */
export function RecurringFormScreen() {
  const {colors, radius, spacing} = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'RecurringForm'>>();
  const currency = useSettingsStore(state => state.currency);

  const {feature, loadError} = useRecurringFeature();
  const ruleId = route.params?.ruleId;
  // The route's type param drives the form for NEW rules; for edits the
  // type is re-read from the rule itself once it loads.
  const routeType = route.params?.type ?? 'expense';
  const [type, setType] = useState<CategoryType>(routeType);

  const isExpense = type === 'expense';

  const [editState, setEditState] = useState<EditLoadState>(
    ruleId !== undefined ? 'loading' : 'ready',
  );
  const [editRetryKey, setEditRetryKey] = useState(0);

  const [values, setValues] = useState<RecurringFormValues>(() =>
    initialRecurringFormValues(Date.now(), routeType),
  );
  const [errors, setErrors] = useState<RecurringFormErrors>({});
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<
    'startDate' | 'nextOccurrenceAt' | 'endDate' | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /**
   * Active flag of the loaded rule (edit mode only): drives which of the
   * Pause/Resume actions is offered, so the user can always tell whether
   * the rule is currently generating (spec §11). `null` while loading / for
   * new rules.
   */
  const [ruleActive, setRuleActive] = useState<boolean | null>(null);

  const savingRef = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, []);

  // Load ACTIVE categories for the picker (spec §8) — expense rules only.
  useEffect(() => {
    if (!feature || !isExpense) {
      return;
    }
    let active = true;
    feature
      .listCategories('expense')
      .then(rows => {
        if (active) {
          setCategories(rows);
          setCategoriesError(null);
        }
      })
      .catch(() => {
        if (active) {
          setCategoriesError('Could not load categories.');
        }
      });
    return () => {
      active = false;
    };
  }, [feature, isExpense]);

  // Preload the rule being edited (re-runs on retry).
  useEffect(() => {
    if (!feature || ruleId === undefined) {
      return;
    }
    let active = true;
    feature
      .getRule(ruleId)
      .then(rule => {
        if (!active) {
          return;
        }
        if (!rule) {
          setEditState('missing');
          return;
        }
        setType(rule.type);
        setValues(ruleToFormValues(rule));
        setRuleActive(rule.isActive);
        setEditState('ready');
      })
      .catch(() => {
        if (active) {
          setEditState('missing');
        }
      });
    return () => {
      active = false;
    };
  }, [feature, ruleId, editRetryKey]);

  const patchValues = useCallback((patch: Partial<RecurringFormValues>) => {
    setValues(previous => ({...previous, ...patch}));
  }, []);

  const submit = useCallback(async () => {
    if (!feature || savingRef.current || saved) {
      return;
    }
    Keyboard.dismiss();

    const nextErrors = validateRecurringForm(values, type);
    setErrors(nextErrors);
    if (!isRecurringFormValid(nextErrors)) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (ruleId !== undefined) {
        await feature.editRule(ruleId, buildRecurringPatch(values, type));
      } else {
        await feature.addRule(buildRecurringDraft(values, type));
      }
      // Popping refocuses the list underneath, which re-processes and
      // refetches from SQLite — no cached copy to invalidate.
      setSaved(true);
      dismissTimer.current = setTimeout(
        () => navigation.goBack(),
        SUCCESS_DISMISS_MS,
      );
    } catch (error) {
      setSaveError(describeSaveError(error));
      setSaving(false);
    } finally {
      savingRef.current = false;
    }
  }, [feature, values, type, ruleId, navigation, saved]);

  const confirmDelete = useCallback(() => {
    if (!feature || ruleId === undefined) {
      return;
    }
    Alert.alert(
      'Delete recurring rule',
      `Only the rule "${values.title.trim() || 'This rule'}" will be deleted. Transactions it already generated are kept.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete rule',
          style: 'destructive',
          onPress: () => {
            feature
              .removeRule(ruleId)
              .then(() => navigation.goBack())
              .catch(error => {
                Alert.alert('Could not delete', describeDeleteError(error));
              });
          },
        },
      ],
    );
  }, [feature, ruleId, values.title, navigation]);

  const confirmResume = useCallback(() => {
    if (!feature || ruleId === undefined) {
      return;
    }
    Alert.alert(
      'Resume rule',
      'Occurrences missed while paused are skipped — the next one generates after today.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Resume',
          onPress: () => {
            feature
              .resumeRule(ruleId)
              .then(resumed => {
                setValues(previous => ({
                  ...previous,
                  nextOccurrenceAt: resumed.nextOccurrenceAt,
                }));
                setRuleActive(true);
              })
              .catch(error => {
                Alert.alert('Could not resume', describeSaveError(error));
              });
          },
        },
      ],
    );
  }, [feature, ruleId]);

  const pause = useCallback(() => {
    if (!feature || ruleId === undefined) {
      return;
    }
    feature
      .pauseRule(ruleId)
      .then(() => {
        // Switch the action row to "Resume" immediately — the list screen
        // picks up the persisted state on refocus.
        setRuleActive(false);
      })
      .catch(error => {
        Alert.alert('Could not pause', describeSaveError(error));
      });
  }, [feature, ruleId]);

  const retryLoad = useCallback(() => {
    if (ruleId === undefined) {
      navigation.goBack();
      return;
    }
    setEditState('loading');
    setEditRetryKey(key => key + 1);
  }, [ruleId, navigation]);

  if (loadError) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <EmptyState
          icon="alert-circle-outline"
          title="Database unavailable"
          message={loadError}
          action={<Button title="Close" onPress={() => navigation.goBack()} />}
        />
      </Screen>
    );
  }

  if (ruleId !== undefined && editState === 'loading') {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </Screen>
    );
  }

  if (ruleId !== undefined && editState === 'missing') {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <EmptyState
          icon="alert-circle-outline"
          title="Rule not found"
          message="It may have been deleted already."
          action={
            <Button title="Retry" variant="secondary" onPress={retryLoad} />
          }
        />
      </Screen>
    );
  }

  const frequencyIndex = FREQUENCY_OPTIONS.findIndex(
    option => option.value === values.frequency,
  );

  const calendarValue =
    calendarTarget === 'endDate'
      ? values.endDate
      : calendarTarget === 'nextOccurrenceAt'
        ? values.nextOccurrenceAt
        : values.startDate;

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      {saveError ? (
        <Card
          style={[
            styles.banner,
            {backgroundColor: colors.dangerMuted, borderColor: colors.danger},
          ]}
        >
          <Text variant="caption" style={{color: colors.danger}}>
            {saveError}
          </Text>
        </Card>
      ) : null}

      {saved ? (
        <Card
          style={[
            styles.banner,
            {
              backgroundColor: colors.primaryMuted,
              borderColor: colors.primary,
            },
          ]}
        >
          <View style={styles.bannerRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.primary}
            />
            <Text variant="caption" style={{color: colors.primary}}>
              {ruleId !== undefined ? 'Changes saved' : 'Rule created'}
            </Text>
          </View>
        </Card>
      ) : null}

      {ruleId === undefined ? (
        <View style={styles.typeSwitch}>
          <SegmentedControl
            segments={['Expense', 'Income']}
            selectedIndex={type === 'expense' ? 0 : 1}
            onSelect={index => {
              const nextType: CategoryType = index === 0 ? 'expense' : 'income';
              setType(nextType);
              setValues(previous => ({
                ...initialRecurringFormValues(previous.startDate, nextType),
                amount: previous.amount,
                title: previous.title,
                note: previous.note,
              }));
              setErrors({});
            }}
          />
        </View>
      ) : null}

      <View style={{gap: spacing.md}}>
        <View>
          <FieldLabel>Amount ({currency})</FieldLabel>
          <TextInput
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={values.amount}
            onChangeText={text =>
              patchValues({amount: sanitizeAmountInput(text)})
            }
            error={errors.amount}
          />
        </View>

        <TextInput
          label={isExpense ? 'Title' : 'Source'}
          placeholder={isExpense ? 'e.g. Hostel rent' : 'e.g. Salary'}
          value={values.title}
          onChangeText={title => patchValues({title})}
          maxLength={200}
          error={errors.title}
        />

        {isExpense ? (
          <View>
            <FieldLabel>Category</FieldLabel>
            {categoriesError ? (
              <Text variant="caption" style={{color: colors.danger}}>
                {categoriesError}
              </Text>
            ) : categories === null ? (
              <ActivityIndicator
                style={{marginVertical: spacing.sm}}
                color={colors.primary}
              />
            ) : categories.length === 0 ? (
              <Text variant="caption" color="textMuted">
                No categories available yet.
              </Text>
            ) : (
              <CategoryChipPicker
                categories={categories}
                selectedId={values.categoryId}
                onSelect={categoryId => patchValues({categoryId})}
                error={errors.categoryId}
              />
            )}
          </View>
        ) : null}

        <View>
          <FieldLabel>Repeats</FieldLabel>
          <SegmentedControl
            segments={FREQUENCY_OPTIONS.map(option => option.label)}
            selectedIndex={frequencyIndex === -1 ? 2 : frequencyIndex}
            onSelect={index =>
              patchValues({frequency: FREQUENCY_OPTIONS[index]!.value})
            }
          />
        </View>

        {ruleId === undefined ? (
          <View>
            <FieldLabel>Start date</FieldLabel>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change start date"
              onPress={() => setCalendarTarget('startDate')}
              style={({pressed}) => [
                styles.dateField,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={18}
                color={colors.textMuted}
              />
              <Text variant="body">{formatShortDate(values.startDate)}</Text>
            </Pressable>
            <Text variant="caption" color="textMuted" style={styles.hint}>
              If the start date is in the past, the missed occurrences up to
              today are recorded on the first run.
            </Text>
          </View>
        ) : (
          <View>
            <FieldLabel>Next occurrence</FieldLabel>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change next occurrence"
              onPress={() => setCalendarTarget('nextOccurrenceAt')}
              style={({pressed}) => [
                styles.dateField,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={18}
                color={colors.textMuted}
              />
              <Text variant="body">
                {formatShortDate(values.nextOccurrenceAt)}
              </Text>
            </Pressable>
            <Text variant="caption" color="textMuted" style={styles.hint}>
              Changing the schedule does not affect transactions already
              generated.
            </Text>
          </View>
        )}

        <View>
          <FieldLabel>End date (optional)</FieldLabel>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change end date"
            onPress={() => setCalendarTarget('endDate')}
            style={({pressed}) => [
              styles.dateField,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={colors.textMuted}
            />
            <Text variant="body">
              {values.hasEndDate
                ? formatShortDate(values.endDate)
                : 'No end date'}
            </Text>
          </Pressable>
          {values.hasEndDate ? (
            <View style={styles.clearButton}>
              <Button
                title="Clear end date"
                variant="secondary"
                onPress={() =>
                  patchValues({
                    hasEndDate: false,
                    endDate: values.startDate,
                  })
                }
              />
            </View>
          ) : null}
          {errors.endDate ? (
            <Text
              variant="caption"
              style={{color: colors.danger, marginTop: 4}}
            >
              {errors.endDate}
            </Text>
          ) : null}
        </View>

        {isExpense ? (
          <View>
            <FieldLabel>Payment method</FieldLabel>
            <PaymentMethodPicker
              value={values.paymentMethod}
              onChange={paymentMethod => patchValues({paymentMethod})}
            />
          </View>
        ) : null}

        <TextInput
          label="Note (optional)"
          placeholder="Added to every generated transaction..."
          value={values.note}
          onChangeText={note => patchValues({note})}
          maxLength={2000}
          multiline
          style={{minHeight: 72, paddingTop: 10}}
        />

        <Button
          title={
            saved
              ? 'Saved'
              : ruleId !== undefined
                ? 'Save changes'
                : 'Create rule'
          }
          onPress={submit}
          loading={saving}
          disabled={saving || saved}
          fullWidth
        />

        {/* Contextual state action: a rule is either generating (Pause) or
        paused (Resume) — showing both at once would hide the rule's state
        from the user (spec §11). Hidden until the rule's state has loaded. */}
        {ruleId !== undefined && ruleActive ? (
          <Button
            title="Pause rule"
            variant="secondary"
            onPress={pause}
            disabled={saving || saved}
            fullWidth
          />
        ) : null}
        {ruleId !== undefined && ruleActive === false ? (
          <Button
            title="Resume rule"
            variant="secondary"
            onPress={confirmResume}
            disabled={saving || saved}
            fullWidth
          />
        ) : null}

        {ruleId !== undefined ? (
          <Button
            title="Delete rule"
            variant="danger"
            onPress={confirmDelete}
            disabled={saving || saved}
            fullWidth
          />
        ) : null}
      </View>

      <CalendarSheet
        visible={calendarTarget !== null}
        value={calendarValue}
        onChange={date => {
          if (calendarTarget === 'startDate') {
            patchValues({
              startDate: date,
              nextOccurrenceAt: date,
              endDate:
                values.hasEndDate && values.endDate < date
                  ? date
                  : values.endDate,
            });
          } else if (calendarTarget === 'nextOccurrenceAt') {
            patchValues({nextOccurrenceAt: date});
          } else if (calendarTarget === 'endDate') {
            patchValues({hasEndDate: true, endDate: date});
          }
          setCalendarTarget(null);
        }}
        onClose={() => setCalendarTarget(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {marginBottom: 12},
  bannerRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  typeSwitch: {marginBottom: 16},
  dateField: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  hint: {marginTop: 6},
  clearButton: {marginTop: 8},
});
