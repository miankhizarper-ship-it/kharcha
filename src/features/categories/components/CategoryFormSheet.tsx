import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Button, FieldLabel, Text, TextInput} from '@/components/ui';
import type {CategoryType} from '@/database/models';
import {useTheme} from '@/theme';
import {
  initialCategoryFormValues,
  isCategoryFormValid,
  validateCategoryForm,
} from '../form';
import type {
  CategoryFormErrors,
  CategoryFormValues,
  CategoryUsage,
} from '../types';
import {
  DuplicateCategoryError,
  MissingCategoryError,
  describeCategoryDeleteError,
} from '../errors';
import {IconPickerGrid} from './IconPickerGrid';
import type {CategoriesFeature} from '../service';

/** The category being edited, or null when creating a new one. */
export interface CategoryEditTarget {
  id: number;
  values: CategoryFormValues;
}

export interface CategoryFormSheetProps {
  visible: boolean;
  /** Type for NEW categories; ignored when `editing` is set. */
  type: CategoryType;
  editing: CategoryEditTarget | null;
  feature: CategoriesFeature;
  /** Called after a successful save/delete so the screen refetches. */
  onSaved: () => void;
  onClose: () => void;
}

/** Duration the success banner is shown before the sheet closes. */
const SUCCESS_DISMISS_MS = 750;

/**
 * Reusable category form sheet — one component for both flows: add and
 * edit. Mirrors the BudgetFormSheet UX: validation before save, double-submit
 * guard, success banner, usage-aware confirmed delete.
 *
 * The form content mounts only while the sheet is open (same pattern as
 * CalendarSheet / BudgetFormSheet), so every open starts from clean state
 * derived from the props — no synchronization effects.
 */
export function CategoryFormSheet(props: CategoryFormSheetProps) {
  if (!props.visible) {
    return <Modal visible={false} transparent animationType="none" />;
  }
  return <CategoryFormSheetContent {...props} />;
}

function CategoryFormSheetContent({
  type,
  editing,
  feature,
  onSaved,
  onClose,
}: CategoryFormSheetProps) {
  const {colors, radius, spacing} = useTheme();

  // Initializers run once per open — the sheet remounts each time.
  const [values, setValues] = useState<CategoryFormValues>(() =>
    editing ? {...editing.values} : initialCategoryFormValues(type),
  );
  const [original] = useState<CategoryFormValues>(() =>
    editing ? {...editing.values} : initialCategoryFormValues(type),
  );
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<CategoryUsage | null>(null);

  const savingRef = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, []);

  // Reference counts for the edit sheet's delete explanation.
  useEffect(() => {
    if (!editing) {
      return;
    }
    let active = true;
    feature
      .getUsage(editing.id)
      .then(next => {
        if (active) {
          setUsage(next);
        }
      })
      .catch(() => {
        if (active) {
          setUsage(null);
        }
      });
    return () => {
      active = false;
    };
  }, [editing, feature]);

  const patchValues = useCallback((patch: Partial<CategoryFormValues>) => {
    setValues(previous => ({...previous, ...patch}));
  }, []);

  const closeAfterSave = useCallback(() => {
    dismissTimer.current = setTimeout(() => {
      onSaved();
      onClose();
    }, SUCCESS_DISMISS_MS);
  }, [onSaved, onClose]);

  const submit = useCallback(() => {
    if (savingRef.current || saved) {
      return;
    }
    Keyboard.dismiss();

    const nextErrors = validateCategoryForm(values);
    setErrors(nextErrors);
    if (!isCategoryFormValid(nextErrors)) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const save = async () => {
      try {
        if (editing) {
          await feature.editCategory(editing.id, values, original);
        } else {
          await feature.addCategory(values);
        }
        setSaved(true);
        closeAfterSave();
      } catch (error) {
        if (error instanceof DuplicateCategoryError) {
          setErrors(previous => ({...previous, name: error.message}));
        } else if (error instanceof MissingCategoryError) {
          setSaveError(
            'This category was deleted already. Close and reopen this screen.',
          );
        } else {
          setSaveError(
            error instanceof Error && error.message.length > 0
              ? error.message
              : 'Could not save the category. Please try again.',
          );
        }
        setSaving(false);
      } finally {
        savingRef.current = false;
      }
    };
    void save();
  }, [feature, saved, values, editing, original, closeAfterSave]);

  const confirmDelete = useCallback(() => {
    if (!editing) {
      return;
    }
    const isUsed =
      usage !== null && (usage.expenseCount > 0 || usage.budgetCount > 0);
    if (isUsed) {
      Alert.alert(
        'Category in use',
        usage.expenseCount > 0
          ? `${usage.expenseCount} transaction(s) use "${editing.values.name.trim()}". Turn the category off instead — its history stays intact.`
          : `${usage.budgetCount} budget(s) use "${editing.values.name.trim()}". Turn the category off instead — deleting would remove those budgets.`,
        [{text: 'OK'}],
      );
      return;
    }
    Alert.alert(
      'Delete category',
      `"${editing.values.name.trim()}" will be removed permanently. This cannot be undone.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const remove = async () => {
              try {
                const result = await feature.deleteCategory(editing.id);
                if (!result.deleted) {
                  Alert.alert(
                    'Category in use',
                    'Existing records still reference this category. Turn it off instead to keep your history intact.',
                    [{text: 'OK'}],
                  );
                  return;
                }
                onSaved();
                onClose();
              } catch (error) {
                Alert.alert(
                  'Could not delete',
                  describeCategoryDeleteError(error),
                );
              }
            };
            void remove();
          },
        },
      ],
    );
  }, [editing, feature, onSaved, onClose, usage]);

  const title = editing ? 'Edit category' : 'New category';

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
                      Category saved
                    </Text>
                  </View>
                ) : null}

                <TextInput
                  label="Name"
                  placeholder="e.g. Fuel"
                  value={values.name}
                  onChangeText={name => patchValues({name})}
                  maxLength={60}
                  error={errors.name}
                />

                <View>
                  <FieldLabel>Type</FieldLabel>
                  <Text variant="body">
                    {values.type === 'expense'
                      ? 'Expense — cannot be changed'
                      : 'Income — cannot be changed'}
                  </Text>
                </View>

                <View>
                  <FieldLabel>Icon</FieldLabel>
                  <IconPickerGrid
                    selectedKey={values.icon}
                    onSelect={icon => patchValues({icon})}
                    error={errors.icon}
                  />
                </View>

                <View style={styles.activeRow}>
                  <View style={styles.activeCopy}>
                    <Text variant="body">Active</Text>
                    <Text variant="caption" color="textMuted">
                      Turn off to archive. Past transactions keep working.
                    </Text>
                  </View>
                  <Switch
                    value={values.isActive}
                    onValueChange={isActive => patchValues({isActive})}
                    trackColor={{false: colors.border, true: colors.primary}}
                    thumbColor={colors.surface}
                    accessibilityLabel="Category active"
                  />
                </View>

                <Button
                  title={saved ? 'Saved' : 'Save category'}
                  onPress={submit}
                  loading={saving}
                  disabled={saving || saved}
                  fullWidth
                />

                {editing ? (
                  <Button
                    title={
                      usage !== null &&
                      (usage.expenseCount > 0 || usage.budgetCount > 0)
                        ? 'Delete unavailable — in use'
                        : 'Delete category'
                    }
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
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activeCopy: {flexShrink: 1, paddingRight: 8},
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
