import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Button, FieldLabel, Text, TextInput} from '@/components/ui';
import type {Category} from '@/database/models';
import {CategoryChipPicker} from '@/features/expenses/components/CategoryChipPicker';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import {formatMonthLabel} from '@/utils/date';
import {sanitizeAmountInput} from '@/utils/money';
import {describeBudgetDeleteError, describeBudgetSaveError} from '../errors';
import {
  buildCategoryBudgetDraft,
  buildOverallBudgetDraft,
  initialBudgetFormValues,
  isBudgetFormValid,
  minorToAmountText,
  validateBudgetForm,
  validateBudgetPeriod,
  type BudgetFormErrors,
  type BudgetFormMode,
  type BudgetFormValues,
} from '../form';
import type {BudgetFeature} from '../service';

/** The budget row being edited, or null when creating a new one. */
export type BudgetEditTarget =
  | {kind: 'overall'; id: number; amount: number}
  | {kind: 'category'; id: number; amount: number; categoryId: number};

export interface BudgetFormSheetProps {
  visible: boolean;
  mode: BudgetFormMode;
  /** 1-12 — the month the sheet saves into (driven by the month navigator). */
  month: number;
  year: number;
  editing: BudgetEditTarget | null;
  /** Expense categories for the picker (category mode only). */
  categories: Category[];
  categoriesReady: boolean;
  /** Category ids already budgeted for this month, EXCLUDING the edited row. */
  budgetedCategoryIds: readonly number[];
  feature: BudgetFeature;
  /** Called after a successful save/delete so the screen refetches. */
  onSaved: () => void;
  onClose: () => void;
}

/** Duration the success banner is shown before the sheet closes. */
const SUCCESS_DISMISS_MS = 750;

/**
 * Reusable budget form sheet — one component for all four flows:
 * set overall / edit overall / add category / edit category budget.
 * Mirrors the Add/Edit Expense modal's UX: validation before save,
 * double-submit guard, success banner, confirmed delete.
 *
 * The form content mounts only while the sheet is open (same pattern as
 * CalendarSheet), so every open starts from clean state derived from the
 * props — no synchronization effects.
 */
export function BudgetFormSheet(props: BudgetFormSheetProps) {
  if (!props.visible) {
    return <Modal visible={false} transparent animationType="none" />;
  }
  return <BudgetFormSheetContent {...props} />;
}

function BudgetFormSheetContent({
  mode,
  month,
  year,
  editing,
  categories,
  categoriesReady,
  budgetedCategoryIds,
  feature,
  onSaved,
  onClose,
}: BudgetFormSheetProps) {
  const {colors, radius, spacing} = useTheme();
  const currency = useSettingsStore(state => state.currency);

  // Initializers run once per open — the sheet remounts each time.
  const [values, setValues] = useState<BudgetFormValues>(() =>
    editing
      ? {
          amount: minorToAmountText(editing.amount),
          categoryId: editing.kind === 'category' ? editing.categoryId : null,
        }
      : initialBudgetFormValues(),
  );
  const [errors, setErrors] = useState<BudgetFormErrors>({});
  const [periodError, setPeriodError] = useState<string | null>(null);
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

  const patchValues = useCallback((patch: Partial<BudgetFormValues>) => {
    setValues(previous => ({...previous, ...patch}));
  }, []);

  const closeAfterSave = useCallback(() => {
    dismissTimer.current = setTimeout(() => {
      onSaved();
      onClose();
    }, SUCCESS_DISMISS_MS);
  }, [onSaved, onClose]);

  const submit = useCallback(() => {
    if (!feature || savingRef.current || saved) {
      return;
    }
    Keyboard.dismiss();

    const periodMessage = validateBudgetPeriod(month, year);
    if (periodMessage) {
      setPeriodError(periodMessage);
      return;
    }

    const nextErrors = validateBudgetForm(values, {
      mode,
      budgetedCategoryIds,
    });
    setErrors(nextErrors);
    if (!isBudgetFormValid(nextErrors)) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const save = async () => {
      try {
        if (mode === 'overall') {
          await feature.saveOverallBudget(
            buildOverallBudgetDraft(values, month, year),
          );
        } else {
          await feature.saveCategoryBudget(
            buildCategoryBudgetDraft(values, month, year),
          );
        }
        setSaved(true);
        closeAfterSave();
      } catch (error) {
        setSaveError(describeBudgetSaveError(error));
        setSaving(false);
      } finally {
        savingRef.current = false;
      }
    };
    void save();
  }, [
    feature,
    saved,
    month,
    year,
    values,
    mode,
    budgetedCategoryIds,
    closeAfterSave,
  ]);

  const confirmDelete = useCallback(() => {
    if (!editing) {
      return;
    }
    const isOverall = editing.kind === 'overall';
    Alert.alert(
      isOverall ? 'Delete budget' : 'Delete category budget',
      'This budget will be removed for this month.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const remove = async () => {
              try {
                if (editing.kind === 'overall') {
                  await feature.removeOverallBudget(editing.id);
                } else {
                  await feature.removeCategoryBudget(editing.id);
                }
                onSaved();
                onClose();
              } catch (error) {
                Alert.alert(
                  'Could not delete',
                  describeBudgetDeleteError(error),
                );
              }
            };
            void remove();
          },
        },
      ],
    );
  }, [editing, feature, onSaved, onClose]);

  const title =
    mode === 'overall'
      ? editing
        ? 'Edit monthly budget'
        : 'Set monthly budget'
      : editing
        ? 'Edit category budget'
        : 'Add category budget';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
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
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{gap: spacing.md}}
              >
                <Text variant="title" align="center">
                  {title}
                </Text>

                {saveError ? (
                  <View
                    style={[
                      styles.banner,
                      {
                        backgroundColor: colors.dangerMuted,
                        borderColor: colors.danger,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Text variant="caption" style={{color: colors.danger}}>
                      {saveError}
                    </Text>
                  </View>
                ) : null}

                {saved ? (
                  <View
                    style={[
                      styles.banner,
                      {
                        backgroundColor: colors.primaryMuted,
                        borderColor: colors.primary,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.primary}
                    />
                    <Text variant="caption" style={{color: colors.primary}}>
                      Budget saved
                    </Text>
                  </View>
                ) : null}

                {periodError ? (
                  <Text variant="caption" style={{color: colors.danger}}>
                    {periodError}
                  </Text>
                ) : null}

                <View>
                  <FieldLabel>Month</FieldLabel>
                  <Text variant="body">{formatMonthLabel(year, month)}</Text>
                </View>

                {mode === 'category' ? (
                  <View>
                    <FieldLabel>Category</FieldLabel>
                    {!categoriesReady ? (
                      <ActivityIndicator style={{marginVertical: spacing.sm}} />
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

                <TextInput
                  label={`Amount (${currency})`}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  value={values.amount}
                  onChangeText={text =>
                    patchValues({amount: sanitizeAmountInput(text)})
                  }
                  error={errors.amount}
                />

                <Button
                  title={saved ? 'Saved' : 'Save budget'}
                  onPress={submit}
                  loading={saving}
                  disabled={saving || saved}
                  fullWidth
                />

                {editing ? (
                  <Button
                    title="Delete budget"
                    variant="danger"
                    onPress={confirmDelete}
                    disabled={saving || saved}
                    fullWidth
                  />
                ) : null}

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
              </ScrollView>
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
  banner: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
