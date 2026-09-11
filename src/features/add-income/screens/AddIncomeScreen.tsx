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
import type {Category, Income} from '@/database/models';
import {
  buildIncomeDraft,
  initialIncomeFormValues,
  isIncomeFormValid,
  validateIncomeForm,
  type IncomeFormErrors,
  type IncomeFormValues,
} from '@/features/income/form';
import {describeDeleteError, describeSaveError} from '@/features/income/errors';
import {useIncomeFeature} from '@/features/income/useIncomeFeature';
import {appendMissingCategory} from '@/features/categories/picker';
import {CategoryChipPicker} from '@/features/expenses/components/CategoryChipPicker';
import {CalendarSheet} from '@/features/expenses/components/CalendarSheet';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import {formatShortDate} from '@/utils/date';
import {sanitizeAmountInput} from '@/utils/money';
import type {RootStackParamList} from '@/navigation/types';

type EditLoadState = 'loading' | 'ready' | 'missing';

/** Duration the success banner is shown before the modal closes. */
const SUCCESS_DISMISS_MS = 750;

function incomeToFormValues(income: Income): IncomeFormValues {
  return {
    amount: (income.amount / 100).toFixed(2),
    source: income.source,
    date: income.date,
    note: income.note ?? '',
  };
}

/**
 * Add Income modal — also reused, unchanged, for editing an existing income
 * record (opened with `AddIncome {incomeId}` route params), mirroring how
 * the expense form handles add vs edit.
 *
 * The source picker is database-backed: it lists the income categories
 * seeded by migration 001, and the chosen category's name is stored as the
 * free-text `source` column. No category names are hardcoded here.
 */
export function AddIncomeScreen() {
  const {colors, radius, spacing} = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddIncome'>>();
  const currency = useSettingsStore(state => state.currency);

  const {feature, loadError} = useIncomeFeature();
  const incomeId = route.params?.incomeId;
  const isEdit = incomeId !== undefined;

  const [editState, setEditState] = useState<EditLoadState>(
    isEdit ? 'loading' : 'ready',
  );
  const [editRetryKey, setEditRetryKey] = useState(0);

  const [values, setValues] = useState<IncomeFormValues>(() =>
    initialIncomeFormValues(Date.now()),
  );
  const [errors, setErrors] = useState<IncomeFormErrors>({});
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

  // Load the income categories from the database for the source picker.
  useEffect(() => {
    if (!feature) {
      return;
    }
    let active = true;
    feature
      .listCategories('income')
      .then(rows => {
        if (active) {
          setCategories(rows);
          setCategoriesError(null);
        }
      })
      .catch(() => {
        if (active) {
          setCategoriesError('Could not load income sources.');
        }
      });
    return () => {
      active = false;
    };
  }, [feature]);

  // Preload the income record being edited (re-runs on retry).
  useEffect(() => {
    if (!feature || incomeId === undefined) {
      return;
    }
    let active = true;
    feature
      .getIncome(incomeId)
      .then(income => {
        if (!active) {
          return;
        }
        if (!income) {
          setEditState('missing');
          return;
        }
        setValues(incomeToFormValues(income));
        // Re-resolve the record's source category regardless of active
        // state: if it was archived after the record was created, the
        // picker appends it (muted) so history remains visible/editable.
        feature
          .findCategoryByName(income.source)
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
  }, [feature, incomeId, editRetryKey]);

  const patchValues = useCallback((patch: Partial<IncomeFormValues>) => {
    setValues(previous => ({...previous, ...patch}));
  }, []);

  // Active income categories, plus the record's archived source appended
  // during edits so historical records keep displaying correctly.
  const pickerCategories = appendMissingCategory(
    categories ?? [],
    legacyCategory,
  );
  const inactiveCategoryIds =
    legacyCategory !== null && !legacyCategory.isActive
      ? [legacyCategory.id]
      : [];

  const selectSource = useCallback(
    (categoryId: number) => {
      const selected = pickerCategories.find(
        category => category.id === categoryId,
      );
      if (selected) {
        patchValues({source: selected.name});
      }
    },
    [pickerCategories, patchValues],
  );

  const submit = useCallback(async () => {
    if (!feature || savingRef.current || saved) {
      return;
    }
    Keyboard.dismiss();

    const nextErrors = validateIncomeForm(values);
    setErrors(nextErrors);
    if (!isIncomeFormValid(nextErrors)) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const draft = buildIncomeDraft(values);
      if (isEdit && incomeId !== undefined) {
        await feature.editIncome(incomeId, draft);
      } else {
        await feature.addIncome(draft);
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
  }, [feature, values, isEdit, incomeId, navigation, saved]);

  const confirmDelete = useCallback(() => {
    if (!feature || incomeId === undefined) {
      return;
    }
    Alert.alert(
      'Delete income',
      `"${values.source.trim() || 'This income'}" will be removed permanently.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            feature
              .removeIncome(incomeId)
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
  }, [feature, incomeId, values.source, navigation]);

  const retryLoad = useCallback(() => {
    if (incomeId === undefined) {
      navigation.goBack();
      return;
    }
    setEditState('loading');
    setEditRetryKey(key => key + 1);
  }, [incomeId, navigation]);

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
          title="Income not found"
          message="It may have been deleted already."
          action={
            <Button title="Retry" variant="secondary" onPress={retryLoad} />
          }
        />
      </Screen>
    );
  }

  const selectedSourceId =
    pickerCategories.find(category => category.name === values.source)?.id ??
    null;

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
              {isEdit ? 'Changes saved' : 'Income saved'}
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

        <View>
          <FieldLabel>Source</FieldLabel>
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
              No income sources available yet.
            </Text>
          ) : (
            <CategoryChipPicker
              categories={pickerCategories}
              selectedId={selectedSourceId}
              onSelect={selectSource}
              error={errors.source}
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
          title={saved ? 'Saved' : isEdit ? 'Save changes' : 'Save income'}
          onPress={submit}
          loading={saving}
          disabled={saving || saved}
          fullWidth
        />

        {isEdit ? (
          <Button
            title="Delete income"
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
