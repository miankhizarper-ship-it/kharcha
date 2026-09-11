import {useFocusEffect, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, RefreshControl, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {
  Button,
  Card,
  EmptyState,
  LoadingIndicator,
  Screen,
  Text,
} from '@/components/ui';
import type {Category} from '@/database/models';
import {
  MONTH_MAX,
  MONTH_MIN,
  YEAR_MAX,
  YEAR_MIN,
} from '@/database/repositories/budgets';
import {
  budgetStateColor,
  budgetStateIcon,
} from '@/features/budgets/components/budgetStateVisuals';
import {CategoryBudgetRow} from '@/features/budgets/components/CategoryBudgetRow';
import {
  BudgetEditTarget,
  BudgetFormSheet,
} from '@/features/budgets/components/BudgetFormSheet';
import {MonthNavigator} from '@/features/budgets/components/MonthNavigator';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import {describeBudgetLoadError} from '@/features/budgets/errors';
import {formatBudgetPercent} from '@/features/budgets/progress';
import {useBudgetFeature} from '@/features/budgets/useBudgetFeature';
import type {BudgetMonthSnapshot} from '@/features/budgets/types';
import type {BudgetFormMode} from '@/features/budgets/form';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import {nextMonth, previousMonth} from '@/utils/date';
import {formatCurrency} from '@/utils/format';
import type {RootStackParamList} from '@/navigation/types';

/**
 * Budget — the monthly overview. Shows the overall budget, live spending
 * (computed from SQLite on every focus) and per-category budgets with
 * progress + warnings, navigable across months. All mutations go through
 * the budget feature service; no SQL and no cached copies here.
 */
export function BudgetScreen() {
  const {colors, spacing} = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'Budgets'>>();
  const currency = useSettingsStore(state => state.currency);
  const {feature, loadError} = useBudgetFeature();

  // Initial month comes from route params (e.g. dashboard "View budget")
  // and falls back to the month the user opened the screen in.
  const [initialNow] = useState(() => Date.now());
  const [year, setYear] = useState(
    () => route.params?.year ?? new Date(initialNow).getFullYear(),
  );
  const [month, setMonth] = useState(
    () => route.params?.month ?? new Date(initialNow).getMonth() + 1,
  );

  const [snapshot, setSnapshot] = useState<BudgetMonthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesReady, setCategoriesReady] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetMode, setSheetMode] = useState<BudgetFormMode>('overall');
  const [editing, setEditing] = useState<BudgetEditTarget | null>(null);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const next = await feature.getMonthSnapshot(year, month);
      if (seq !== loadSeq.current) {
        return;
      }
      setSnapshot(next);
      setError(null);
    } catch {
      if (seq !== loadSeq.current) {
        return;
      }
      setError(describeBudgetLoadError());
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [feature, year, month]);

  const onFocusReload = useCallback(() => {
    void load();
  }, [load]);
  useFocusEffect(onFocusReload);

  // Categories for the form picker (expense categories only).
  useEffect(() => {
    if (!feature) {
      return;
    }
    let active = true;
    feature
      .listExpenseCategories()
      .then(rows => {
        if (active) {
          setCategories(rows);
          setCategoriesReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setCategories([]);
          setCategoriesReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [feature]);

  const setPeriod = useCallback((next: {year: number; month: number}) => {
    setYear(next.year);
    setMonth(next.month);
  }, []);

  const goPrevious = useCallback(() => {
    setPeriod(previousMonth(year, month));
  }, [year, month, setPeriod]);

  const goNext = useCallback(() => {
    setPeriod(nextMonth(year, month));
  }, [year, month, setPeriod]);

  const canGoPrevious = year > YEAR_MIN || month > MONTH_MIN;
  const canGoNext = year < YEAR_MAX || month < MONTH_MAX;

  const openSetOverall = useCallback(() => {
    setSheetMode('overall');
    setEditing(null);
    setSheetVisible(true);
  }, []);

  const openEditOverall = useCallback(() => {
    if (!snapshot?.overall) {
      return;
    }
    setSheetMode('overall');
    setEditing({
      kind: 'overall',
      id: snapshot.overall.id,
      amount: snapshot.overall.amount,
    });
    setSheetVisible(true);
  }, [snapshot]);

  const openAddCategory = useCallback(() => {
    setSheetMode('category');
    setEditing(null);
    setSheetVisible(true);
  }, []);

  const openEditCategory = useCallback(
    (budgetId: number) => {
      const row = snapshot?.categories.find(
        category => category.id === budgetId,
      );
      if (!row) {
        return;
      }
      setSheetMode('category');
      setEditing({
        kind: 'category',
        id: row.id,
        amount: row.amount,
        categoryId: row.categoryId,
      });
      setSheetVisible(true);
    },
    [snapshot],
  );

  // Duplicate guard list for the sheet: every budgeted category of this
  // month except the row being edited (keeping it must stay allowed).
  const budgetedCategoryIds = (snapshot?.categories ?? [])
    .filter(row => !(editing?.kind === 'category' && editing.id === row.id))
    .map(row => row.categoryId);

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Budget</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const overall = snapshot?.overall ?? null;
  const categoryBudgets = snapshot?.categories ?? [];
  const hasAnyBudget = overall !== null || categoryBudgets.length > 0;
  // Total month spending across ALL categories (accurate even when only
  // some categories are budgeted).
  const monthSpent = snapshot?.spent ?? 0;

  return (
    <Screen
      scroll
      contentContainerStyle={{paddingBottom: spacing.xl}}
      refreshControl={
        <RefreshControl
          refreshing={loading && snapshot !== null}
          onRefresh={() => void load()}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <Text variant="display">Budget</Text>

      <MonthNavigator
        year={year}
        month={month}
        onPrevious={canGoPrevious ? goPrevious : undefined}
        onNext={canGoNext ? goNext : undefined}
      />

      {snapshot === null ? (
        <View style={styles.fillCenter}>
          {error ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load budgets"
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
            <LoadingIndicator minHeight={160} />
          )}
        </View>
      ) : !hasAnyBudget ? (
        <View style={{marginTop: spacing.lg}}>
          <EmptyState
            icon="pie-chart-outline"
            title="No budget set for this month."
            message="Set an overall monthly limit, or budgets for individual categories, to see progress here."
            action={<Button title="Set Budget" onPress={openSetOverall} />}
          />
        </View>
      ) : (
        <>
          {overall ? (
            <Card style={{marginTop: spacing.sm, gap: spacing.sm}}>
              <Text variant="label" color="textMuted">
                MONTHLY BUDGET
              </Text>
              <Text
                variant="display"
                style={{
                  color:
                    overall.state === 'exceeded' ? colors.danger : colors.text,
                }}
              >
                {formatCurrency(overall.amount, currency)}
              </Text>

              <View style={styles.progressRow}>
                <ProgressBar
                  ratio={
                    overall.amount > 0 ? overall.spent / overall.amount : 0
                  }
                  color={budgetStateColor(overall.state, colors)}
                />
              </View>

              <Text
                variant="caption"
                style={{color: budgetStateColor(overall.state, colors)}}
              >
                {formatBudgetPercent(overall.percent)}% used
              </Text>

              <View style={styles.statRow}>
                <Text variant="body">Spent</Text>
                <Text variant="label">
                  {formatCurrency(overall.spent, currency)}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text variant="body">Remaining</Text>
                <Text
                  variant="label"
                  style={{
                    // Same contract as the dashboard + reports budget cards:
                    // negative remaining is danger, everything else stays
                    // muted (the progress bar already carries the state).
                    color:
                      overall.remaining < 0 ? colors.danger : colors.textMuted,
                  }}
                >
                  {formatCurrency(overall.remaining, currency)}
                </Text>
              </View>

              {overall.state === 'warning' || overall.state === 'exceeded' ? (
                <View style={styles.stateRow}>
                  <Ionicons
                    name={budgetStateIcon(overall.state)}
                    size={16}
                    color={budgetStateColor(overall.state, colors)}
                  />
                  <Text
                    variant="caption"
                    style={{color: budgetStateColor(overall.state, colors)}}
                  >
                    {overall.state === 'exceeded'
                      ? 'Budget exceeded'
                      : 'Approaching budget'}
                  </Text>
                </View>
              ) : null}
            </Card>
          ) : (
            <Card style={{marginTop: spacing.sm, gap: spacing.xs}}>
              <Text variant="label" color="textMuted">
                MONTHLY BUDGET
              </Text>
              <Text variant="title">Not set</Text>
              <Text variant="caption" color="textMuted">
                Spent so far: {formatCurrency(monthSpent, currency)}
              </Text>
              <View style={{marginTop: spacing.sm}}>
                <Button
                  title="Set Overall Budget"
                  variant="secondary"
                  onPress={openSetOverall}
                  fullWidth
                />
              </View>
            </Card>
          )}

          <View style={[styles.actionsRow, {marginTop: spacing.md}]}>
            {overall ? (
              <View style={styles.actionButton}>
                <Button
                  title="Edit Overall Budget"
                  variant="secondary"
                  fullWidth
                  onPress={openEditOverall}
                />
              </View>
            ) : null}
            <View style={styles.actionButton}>
              <Button
                title="Add Category Budget"
                variant="secondary"
                fullWidth
                onPress={openAddCategory}
              />
            </View>
          </View>

          <Text
            variant="title"
            style={{marginTop: spacing.lg, marginBottom: spacing.sm}}
          >
            Category Budgets
          </Text>

          {categoryBudgets.length === 0 ? (
            <Text variant="caption" color="textMuted">
              No category budgets for this month yet. Add one to track spending
              per category.
            </Text>
          ) : (
            <View style={{gap: spacing.sm}}>
              {categoryBudgets.map(budget => (
                <CategoryBudgetRow
                  key={budget.id}
                  budget={budget}
                  currency={currency}
                  onPress={row => openEditCategory(row.id)}
                />
              ))}
            </View>
          )}
        </>
      )}

      {feature ? (
        <BudgetFormSheet
          visible={sheetVisible}
          mode={sheetMode}
          month={month}
          year={year}
          editing={editing}
          categories={categories}
          categoriesReady={categoriesReady}
          budgetedCategoryIds={budgetedCategoryIds}
          feature={feature}
          onSaved={() => void load()}
          onClose={() => setSheetVisible(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fillCenter: {
    marginTop: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRow: {marginTop: 4},
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {flexGrow: 1},
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
