import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useCallback, useRef, useState} from 'react';
import {Pressable, RefreshControl, StyleSheet, View} from 'react-native';

import {EmptyState, LoadingIndicator, Screen, Text} from '@/components/ui';
import type {CategoryBudgetProgress} from '@/features/budgets/types';
import {
  MONTH_MAX,
  MONTH_MIN,
  YEAR_MAX,
  YEAR_MIN,
} from '@/database/repositories/budgets';
import {BudgetPerformanceCard} from '@/features/reports/components/BudgetPerformanceCard';
import {CategoryBreakdownList} from '@/features/reports/components/CategoryBreakdownList';
import {CustomRangeSheet} from '@/features/reports/components/CustomRangeSheet';
import {DailyTrendChart} from '@/features/reports/components/DailyTrendChart';
import {IncomeExpenseCompare} from '@/features/reports/components/IncomeExpenseCompare';
import {IncomeSourcesCard} from '@/features/reports/components/IncomeSourcesCard';
import {InsightsCard} from '@/features/reports/components/InsightsCard';
import {MonthOverMonthCard} from '@/features/reports/components/MonthOverMonthCard';
import {PeriodSelector} from '@/features/reports/components/PeriodSelector';
import {describeReportLoadError} from '@/features/reports/errors';
import {
  activePresetOf,
  currentMonthOf,
  formatReportSelectionLabel,
} from '@/features/reports/period';
import {useReportFeature} from '@/features/reports/useReportFeature';
import type {
  CategoryReportScope,
  ReportPreset,
  ReportSelection,
  ReportSnapshot,
} from '@/features/reports/types';
import {MonthNavigator} from '@/features/budgets/components/MonthNavigator';
import {ReportSummaryCard} from '@/features/reports/components/ReportSummaryCard';
import {previousMonth, nextMonth} from '@/utils/date';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

/**
 * Reports — offline-first financial analytics. Every number comes from one
 * SQLite-backed snapshot per selection (period presets + custom range),
 * recomputed on every focus so new/edited/deleted transactions and budget
 * changes are reflected without any global refresh mechanism.
 */
export function ReportsScreen() {
  const {colors, spacing} = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const currency = useSettingsStore(state => state.currency);
  const {feature, loadError} = useReportFeature();

  // Captured once per mount — anchors "this week/month" presets, not a
  // reactive dependency (same rule as the dashboard greeting).
  const [now] = useState(() => Date.now());

  const [selection, setSelection] = useState<ReportSelection>(() => {
    const current = currentMonthOf(Date.now());
    return {kind: 'month', ...current};
  });
  const [lastCustomRange, setLastCustomRange] = useState<{
    from: number;
    to: number;
  } | null>(null);

  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customSheetVisible, setCustomSheetVisible] = useState(false);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const next = await feature.getReportSnapshot(selection, now);
      if (seq !== loadSeq.current) {
        return;
      }
      setSnapshot(next);
      setError(null);
    } catch {
      if (seq !== loadSeq.current) {
        return;
      }
      setError(describeReportLoadError());
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [feature, selection, now]);

  const onFocusReload = useCallback(() => {
    void load();
  }, [load]);
  useFocusEffect(onFocusReload);

  const handleSelectPreset = useCallback(
    (preset: ReportPreset) => {
      switch (preset) {
        case 'thisWeek':
          setSelection({kind: 'thisWeek'});
          break;
        case 'thisMonth':
          setSelection({kind: 'month', ...currentMonthOf(now)});
          break;
        case 'lastMonth':
          setSelection({
            kind: 'month',
            ...previousMonth(...monthParts(now)),
          });
          break;
        case 'custom':
          setCustomSheetVisible(true);
          break;
      }
    },
    [now],
  );

  const goPreviousMonth = useCallback(() => {
    setSelection(current =>
      current.kind === 'month'
        ? {kind: 'month', ...previousMonth(current.year, current.month)}
        : current,
    );
  }, []);

  const goNextMonth = useCallback(() => {
    setSelection(current =>
      current.kind === 'month'
        ? {kind: 'month', ...nextMonth(current.year, current.month)}
        : current,
    );
  }, []);

  const openBudget = useCallback(() => {
    if (selection.kind === 'month') {
      navigation.navigate('Budgets', {
        year: selection.year,
        month: selection.month,
      });
    }
  }, [navigation, selection]);

  /*
   * Drill-down (Phase 9). The overview's resolved period travels with the
   * scope so the detail screen shows exactly the window on screen, and the
   * selection stays in this screen's state — returning from the detail
   * restores Reports on the same filter (spec §14), reloaded on focus.
   */
  const openCategoryDetail = useCallback(
    (scope: CategoryReportScope) => {
      if (!snapshot) {
        return;
      }
      navigation.navigate('CategoryDetail', {
        scope,
        selection,
        period: {
          fromDate: snapshot.period.fromDate,
          toDate: snapshot.period.toDate,
        },
      });
    },
    [navigation, selection, snapshot],
  );

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Reports</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const activePreset = activePresetOf(selection, now);
  const periodLabel = formatReportSelectionLabel(selection, now);

  const canGoPrevious =
    selection.kind === 'month' &&
    (selection.year > YEAR_MIN || selection.month > MONTH_MIN);
  const canGoNext =
    selection.kind === 'month' &&
    (selection.year < YEAR_MAX || selection.month < MONTH_MAX);

  // Whole-screen empty state: a period with no income, no expenses and no
  // budget data would render nothing but zero cards.
  const hasNoDataAtAll =
    snapshot !== null &&
    snapshot.income === 0 &&
    snapshot.expenses === 0 &&
    (snapshot.budgetPerformance === null ||
      (snapshot.budgetPerformance.overall === null &&
        snapshot.budgetPerformance.topCategories.length === 0));

  const budget = snapshot?.budgetPerformance ?? null;

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
      <Text variant="display">Reports</Text>
      <Text
        variant="body"
        color="textMuted"
        style={{marginTop: spacing.xs, marginBottom: spacing.sm}}
      >
        Insights from your spending, computed on this device.
      </Text>

      <PeriodSelector
        active={activePreset}
        onSelect={handleSelectPreset}
        disabled={loading && snapshot === null}
      />

      {selection.kind === 'month' ? (
        <MonthNavigator
          year={selection.year}
          month={selection.month}
          onPrevious={canGoPrevious ? goPreviousMonth : undefined}
          onNext={canGoNext ? goNextMonth : undefined}
        />
      ) : (
        <View
          style={[
            styles.rangeLabelRow,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: 12,
              marginVertical: spacing.md,
              padding: spacing.md,
            },
          ]}
        >
          <Text variant="title" numberOfLines={1}>
            {periodLabel}
          </Text>
        </View>
      )}

      {snapshot === null ? (
        <View style={styles.fillCenter}>
          {error ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load your report"
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
      ) : hasNoDataAtAll ? (
        <View style={{marginTop: spacing.lg}}>
          <EmptyState
            icon="stats-chart-outline"
            title="No spending data yet."
            message="Add a few expenses and your reports will appear here."
          />
        </View>
      ) : (
        <>
          <ReportSection
            snapshot={snapshot}
            currency={currency}
            onOpenScope={openCategoryDetail}
            onOpenTransaction={({type, id}) => {
              // Same routing as the shared openTransaction helper, but the
              // insight row only carries {type, id} — never a full record.
              if (type === 'expense') {
                navigation.navigate('AddExpense', {expenseId: id});
              } else {
                navigation.navigate('AddIncome', {incomeId: id});
              }
            }}
            previousLabel={
              selection.kind === 'month'
                ? formatReportSelectionLabel(
                    {
                      kind: 'month',
                      ...previousMonth(selection.year, selection.month),
                    },
                    now,
                  )
                : undefined
            }
          />

          {budget && selection.kind === 'month' ? (
            <BudgetPerformanceCard
              overall={budget.overall}
              topCategories={budget.topCategories}
              currency={currency}
              onOpenBudget={openBudget}
            />
          ) : null}

          {snapshot.previousPeriodComparison && selection.kind === 'month' ? (
            <MonthOverMonthCard
              comparison={snapshot.previousPeriodComparison}
              currentLabel={periodLabel}
              previousLabel={formatReportSelectionLabel(
                {
                  kind: 'month',
                  ...previousMonth(selection.year, selection.month),
                },
                now,
              )}
              currency={currency}
            />
          ) : null}
        </>
      )}

      <CustomRangeSheet
        visible={customSheetVisible}
        initialFrom={lastCustomRange?.from}
        initialTo={lastCustomRange?.to}
        onApply={(fromDate, toDate) => {
          setLastCustomRange({from: fromDate, to: toDate});
          setCustomSheetVisible(false);
          setSelection({kind: 'custom', fromDate, toDate});
        }}
        onClose={() => setCustomSheetVisible(false)}
      />
    </Screen>
  );
}

/** Local (year, month) parts of a timestamp. */
function monthParts(now: number): [number, number] {
  const date = new Date(now);
  return [date.getFullYear(), date.getMonth() + 1];
}

/**
 * The data sections that apply to every kind of period: summary totals,
 * daily trend, category breakdown (tap → Category Detail), income sources
 * (tap → Category Detail), income-vs-expense and insights. Month extras
 * (budget + comparison) render below from the same snapshot.
 */
function ReportSection({
  snapshot,
  currency,
  onOpenScope,
  onOpenTransaction,
  previousLabel,
}: {
  snapshot: ReportSnapshot;
  currency: string;
  onOpenScope: (scope: CategoryReportScope) => void;
  onOpenTransaction: (transaction: {
    type: 'expense' | 'income';
    id: number;
  }) => void;
  previousLabel?: string;
}) {
  const {spacing} = useTheme();

  // Month selections can annotate breakdown rows with the category's
  // budget state (reusing the Budget feature's own progress objects).
  const budgetByCategoryId = new Map<number, CategoryBudgetProgress>();
  if (snapshot.budgetPerformance) {
    for (const budget of snapshot.budgetPerformance.categoryBudgets) {
      budgetByCategoryId.set(budget.categoryId, budget);
    }
  }

  return (
    <>
      <ReportSummaryCard
        income={snapshot.income}
        expenses={snapshot.expenses}
        balance={snapshot.balance}
        averageDailySpend={snapshot.averageDailySpend}
        currency={currency}
        transactionCount={snapshot.expenseCount}
        averageTransaction={snapshot.averageTransaction}
      />

      {snapshot.expenses > 0 ? (
        <DailyTrendChart points={snapshot.dailySpending} currency={currency} />
      ) : (
        <SectionEmpty title="Daily Spending" />
      )}

      {snapshot.categoryBreakdown.length > 0 ? (
        <CategoryBreakdownList
          slices={snapshot.categoryBreakdown}
          currency={currency}
          onSelectCategory={slice =>
            onOpenScope({kind: 'expense', categoryId: slice.categoryId})
          }
          budgetByCategoryId={budgetByCategoryId}
        />
      ) : (
        <SectionEmpty title="By Category" />
      )}

      {snapshot.incomeSources.length > 0 ? (
        <IncomeSourcesCard
          sources={snapshot.incomeSources}
          currency={currency}
          onSelectSource={source =>
            onOpenScope({kind: 'income', source: source.source})
          }
        />
      ) : (
        <SectionEmpty title="Income Sources" />
      )}

      <IncomeExpenseCompare
        comparison={snapshot.incomeVsExpense}
        currency={currency}
      />

      <InsightsCard
        snapshot={snapshot}
        currency={currency}
        previousLabel={previousLabel}
        onOpenTransaction={onOpenTransaction}
      />
      {/* spacing sentinel keeps the fragment's last card off the tab bar */}
      <View style={{height: spacing.xs}} />
    </>
  );
}

/** Compact in-section empty state (never fake values). */
function SectionEmpty({title}: {title: string}) {
  const {colors, radius, spacing} = useTheme();
  return (
    <View
      style={[
        styles.sectionEmpty,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
          marginTop: spacing.md,
          padding: spacing.md,
        },
      ]}
    >
      <Text variant="label" color="textMuted">
        {title}
      </Text>
      <Text variant="caption" color="textMuted" style={{marginTop: spacing.xs}}>
        Nothing spent in this period yet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fillCenter: {
    marginTop: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeLabelRow: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionEmpty: {
    borderWidth: 1,
  },
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
