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
  LoadingIndicator,
  Screen,
  Text,
  TextInput,
} from '@/components/ui';
import type {Category} from '@/database/models';
import {
  buildExpenseDraft,
  initialExpenseFormValues,
  isExpenseFormValid,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormValues,
} from '@/features/expenses/form';
import {
  describeDeleteError,
  describeSaveError,
} from '@/features/expenses/errors';
import {CategoryChipPicker} from '@/features/expenses/components/CategoryChipPicker';
import {CalendarSheet} from '@/features/expenses/components/CalendarSheet';
import {PaymentMethodPicker} from '@/features/expenses/components/PaymentMethodPicker';
import {appendMissingCategory} from '@/features/categories/picker';
import {useExpenseFeature} from '@/features/expenses/useExpenseFeature';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import {formatShortDate} from '@/utils/date';
import {sanitizeAmountInput} from '@/utils/money';
import type {RootStackParamList} from '@/navigation/types';

type EditLoadState = 'loading' | 'ready' | 'missing';

/** Duration the success banner is shown before the modal closes. */
const SUCCESS_DISMISS_MS = 750;

function expenseToFormValues(
  amount: number,
  title: string,
  categoryId: number,
  date: number,
  paymentMethod: ExpenseFormValues['paymentMethod'],
  note: string | null,
): ExpenseFormValues {
  return {
    amount: (amount / 100).toFixed(2),
    title,
    categoryId,
    date,
    paymentMethod,
    note: note ?? '',
  };
}

/**
 * Add Expense modal — also reused, unchanged, for editing an existing
 * expense (opened with `AddExpense {expenseId}` route params).
 */
export function AddExpenseScreen() {
  const {colors, radius, spacing} = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddExpense'>>();
  const currency = useSettingsStore(state => state.currency);

  const {feature, loadError} = useExpenseFeature();
  const expenseId = route.params?.expenseId;
  const isEdit = expenseId !== undefined;

  const [editState, setEditState] = useState<EditLoadState>(
    isEdit ? 'loading' : 'ready',
  );
  const [editRetryKey, setEditRetryKey] = useState(0);

  const [values, setValues] = useState<ExpenseFormValues>(() =>
    initialExpenseFormValues(Date.now()),
  );
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [legacyCategory, setLegacyCategory] = useState<Category | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const savingRef = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, []);

  // Load categories from the database for the picker.
  useEffect(() => {
    if (!feature) {
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
  }, [feature]);

  // Preload the expense being edited (re-runs on retry).
  useEffect(() => {
    if (!feature || expenseId === undefined) {
      return;
    }
    let active = true;
    feature
      .getExpense(expenseId)
      .then(expense => {
        if (!active) {
          return;
        }
        if (!expense) {
          setEditState('missing');
          return;
        }
        setValues(
          expenseToFormValues(
            expense.amount,
            expense.title,
            expense.categoryId,
            expense.date,
            expense.paymentMethod,
            expense.note,
          ),
        );
        // Resolve the record's category regardless of active state: if it
        // was archived after the expense was recorded, the picker appends
        // it (muted) so history remains visible and editable unchanged.
        feature
          .getCategory(expense.categoryId)
          .then(category => {
            if (active) {
              setLegacyCategory(category);
            }
          })
          .catch(() => {
            if (active) {
              setLegacyCategory(null);
            }
          });
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
  }, [feature, expenseId, editRetryKey]);

  const patchValues = useCallback((patch: Partial<ExpenseFormValues>) => {
    setValues(previous => ({...previous, ...patch}));
  }, []);

  const submit = useCallback(async () => {
    if (!feature || savingRef.current || saved) {
      return;
    }
    Keyboard.dismiss();

    const nextErrors = validateExpenseForm(values);
    setErrors(nextErrors);
    if (!isExpenseFormValid(nextErrors)) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const draft = buildExpenseDraft(values);
      if (isEdit && expenseId !== undefined) {
        await feature.editExpense(expenseId, draft);
      } else {
        await feature.addExpense(draft);
      }
      // Closing the modal refocuses the tab underneath, which refetches
      // from SQLite — no cached copy to invalidate.
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
  }, [feature, values, isEdit, expenseId, navigation, saved]);

  const confirmDelete = useCallback(() => {
    if (!feature || expenseId === undefined) {
      return;
    }
    Alert.alert(
      'Delete expense',
      `"${values.title.trim() || 'This expense'}" will be removed permanently.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            feature
              .removeExpense(expenseId)
              .then(() => {
                navigation.goBack();
              })
              .catch(error => {
                Alert.alert('Could not delete', describeDeleteError(error));
              });
          },
        },
      ],
    );
  }, [feature, expenseId, values.title, navigation]);

  const retryLoad = useCallback(() => {
    if (expenseId === undefined) {
      navigation.goBack();
      return;
    }
    setEditState('loading');
    setEditRetryKey(key => key + 1);
  }, [expenseId, navigation]);

  // Active categories, plus the record's archived category appended during
  // edits so historical records keep displaying and saving correctly.
  const pickerCategories = appendMissingCategory(
    categories ?? [],
    legacyCategory,
  );
  const inactiveCategoryIds =
    legacyCategory !== null && !legacyCategory.isActive
      ? [legacyCategory.id]
      : [];

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

  if (isEdit && editState === 'loading') {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <LoadingIndicator minHeight={120} />
        </View>
      </Screen>
    );
  }

  if (isEdit && editState === 'missing') {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <EmptyState
          icon="alert-circle-outline"
          title="Expense not found"
          message="It may have been deleted already."
          action={
            <Button title="Retry" variant="secondary" onPress={retryLoad} />
          }
        />
      </Screen>
    );
  }

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
              {isEdit ? 'Changes saved' : 'Expense saved'}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{gap: spacing.md}}>
        <View>
          <FieldLabel>Amount ({currency})</FieldLabel>
          <TextInput
            placeholder="0.00"
            keyboardType="decimal-pad"
            autoFocus
            value={values.amount}
            onChangeText={text =>
              patchValues({amount: sanitizeAmountInput(text)})
            }
            error={errors.amount}
          />
        </View>

        <TextInput
          label="Title"
          placeholder="What was it for?"
          value={values.title}
          onChangeText={title => patchValues({title})}
          maxLength={200}
          error={errors.title}
        />

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
          ) : pickerCategories.length === 0 ? (
            <Text variant="caption" color="textMuted">
              No categories available yet.
            </Text>
          ) : (
            <CategoryChipPicker
              categories={pickerCategories}
              selectedId={values.categoryId}
              onSelect={categoryId => patchValues({categoryId})}
              error={errors.categoryId}
              inactiveIds={inactiveCategoryIds}
            />
          )}
        </View>

        <View>
          <FieldLabel>Date</FieldLabel>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change date"
            onPress={() => setCalendarVisible(true)}
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
            <Text variant="body">{formatShortDate(values.date)}</Text>
          </Pressable>
        </View>

        <View>
          <FieldLabel>Payment method</FieldLabel>
          <PaymentMethodPicker
            value={values.paymentMethod}
            onChange={paymentMethod => patchValues({paymentMethod})}
          />
        </View>

        <TextInput
          label="Note (optional)"
          placeholder="Add a note..."
          value={values.note}
          onChangeText={note => patchValues({note})}
          maxLength={2000}
          multiline
          style={{minHeight: 72, paddingTop: 10}}
        />

        <Button
          title={saved ? 'Saved' : isEdit ? 'Save changes' : 'Save expense'}
          onPress={submit}
          loading={saving}
          disabled={saving || saved}
          fullWidth
        />

        {isEdit ? (
          <Button
            title="Delete expense"
            variant="danger"
            onPress={confirmDelete}
            disabled={saving || saved}
            fullWidth
          />
        ) : null}
      </View>

      <CalendarSheet
        visible={calendarVisible}
        value={values.date}
        onChange={date => patchValues({date})}
        onClose={() => setCalendarVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {marginBottom: 12},
  bannerRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  dateField: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
  },
});
