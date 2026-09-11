import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useRef, useState} from 'react';
import {Pressable, RefreshControl, StyleSheet, View} from 'react-native';

import {
  Button,
  EmptyState,
  LoadingIndicator,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import type {Category, CategoryType} from '@/database/models';
import {CategoryRow} from '@/features/categories/components/CategoryRow';
import {
  CategoryEditTarget,
  CategoryFormSheet,
} from '@/features/categories/components/CategoryFormSheet';
import {describeCategoryLoadError} from '@/features/categories/errors';
import {useCategoriesFeature} from '@/features/categories/useCategoriesFeature';
import {useTheme} from '@/theme';

/**
 * Category management — [Expenses] [Income] tabs over one consistently
 * sorted list (A-Z, case-insensitive, straight from SQLite). Rows open the
 * shared add/edit sheet; archived rows stay visible but muted. Data is
 * refetched on focus and on pull-to-refresh; nothing is cached.
 */
export function CategoriesScreen() {
  const {colors, spacing} = useTheme();
  const {feature, loadError} = useCategoriesFeature();

  const [typeIndex, setTypeIndex] = useState(0);
  const type: CategoryType = typeIndex === 0 ? 'expense' : 'income';

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<CategoryEditTarget | null>(null);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const rows = await feature.listCategories(type);
      if (seq !== loadSeq.current) {
        return;
      }
      setCategories(rows);
      setError(null);
    } catch (loadFailure) {
      if (seq !== loadSeq.current) {
        return;
      }
      setError(describeCategoryLoadError(loadFailure));
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [feature, type]);

  const onFocusReload = useCallback(() => {
    void load();
  }, [load]);
  useFocusEffect(onFocusReload);

  const openAdd = useCallback(() => {
    setEditing(null);
    setSheetVisible(true);
  }, []);

  const openEdit = useCallback((category: Category) => {
    setEditing({
      id: category.id,
      values: {
        name: category.name,
        icon: category.icon,
        type: category.type,
        isActive: category.isActive,
      },
    });
    setSheetVisible(true);
  }, []);

  const onSheetSaved = useCallback(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Categories</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const ready = categories !== null && error === null;

  return (
    <Screen
      scroll
      contentContainerStyle={{paddingBottom: spacing.xl}}
      refreshControl={
        <RefreshControl
          refreshing={loading && categories !== null}
          onRefresh={() => void load()}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <Text variant="display">Categories</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Organize the categories used across your ledger.
      </Text>

      <View style={{marginTop: spacing.md, gap: spacing.md}}>
        <SegmentedControl
          segments={['Expenses', 'Income']}
          selectedIndex={typeIndex}
          onSelect={setTypeIndex}
        />

        <Button title="Add Category" onPress={openAdd} fullWidth />

        {!ready ? (
          error ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load categories"
              message={error}
              action={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void load()}
                  style={[
                    styles.retryButton,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: 12,
                      paddingHorizontal: spacing.lg,
                    },
                  ]}
                >
                  <Text variant="label">Try again</Text>
                </Pressable>
              }
            />
          ) : (
            <LoadingIndicator minHeight={200} />
          )
        ) : categories.length === 0 ? (
          <EmptyState
            icon="pricetag-outline"
            title="No categories yet"
            message={
              type === 'expense'
                ? 'Add an expense category to organize your spending.'
                : 'Add an income category to organize your earnings.'
            }
            action={<Button title="Add Category" onPress={openAdd} />}
          />
        ) : (
          <View style={{gap: spacing.sm}}>
            {categories.map(category => (
              <CategoryRow
                key={category.id}
                category={category}
                onPress={openEdit}
              />
            ))}
          </View>
        )}

        {ready && categories.length > 0 ? (
          <Text variant="caption" color="textMuted" style={styles.hint}>
            Categories that are off stay on past transactions but are hidden
            when adding new ones.
          </Text>
        ) : null}
      </View>

      {feature ? (
        <CategoryFormSheet
          visible={sheetVisible}
          type={type}
          editing={editing}
          feature={feature}
          onSaved={onSheetSaved}
          onClose={() => setSheetVisible(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {textAlign: 'center'},
});
