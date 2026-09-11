import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useCallback, useRef, useState} from 'react';
import {Pressable, RefreshControl, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {
  Card,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  Screen,
  Text,
  Button,
} from '@/components/ui';
import type {
  DashboardSnapshot,
  TransactionItem,
} from '@/features/transactions/types';
import {describeLoadError} from '@/features/expenses/errors';
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {TransactionRow} from '@/features/transactions/components/TransactionRow';
import {openTransaction} from '@/features/transactions/navigation';
import {useTransactionsFeature} from '@/features/transactions/useTransactionsFeature';
import {budgetStateColor} from '@/features/budgets/components/budgetStateVisuals';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import {formatBudgetPercent} from '@/features/budgets/progress';
import type {
  BudgetState,
  DashboardBudgetSummary,
} from '@/features/budgets/types';
import {useBudgetFeature} from '@/features/budgets/useBudgetFeature';
import {useSettingsStore} from '@/store/settingsStore';
import {radius, spacing, useTheme} from '@/theme';
import {greetingFor} from '@/utils/date';
import {formatCurrency} from '@/utils/format';
import type {MainTabParamList, RootStackParamList} from '@/navigation/types';

/**
 * Dashboard — everything below is computed from SQLite on every focus:
 * today's and this month's income/spending/balance, spending by category
 * and the most recent transactions of either type. No mock data, no cached
 * copy in Zustand.
 */
export function HomeScreen() {
  const {colors, spacing} = useTheme();
  const tabNavigation =
    useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const stackNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const currency = useSettingsStore(state => state.currency);
  const {feature} = useTransactionsFeature();
  const {feature: budgetFeature} = useBudgetFeature();

  // Captured once per mount — this is presentation data (greeting + day
  // grouping), not a reactive dependency.
  const [now] = useState(() => Date.now());

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Supplementary budget card data — hidden (not fatal) when it fails. */
  const [budgetSummary, setBudgetSummary] =
    useState<DashboardBudgetSummary | null>(null);
  /** True when the budget card itself failed to load (distinct from "not set"). */
  const [budgetFailed, setBudgetFailed] = useState(false);

  const loadSeq = useRef(0);
  const budgetLoadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const next = await feature.getDashboardSnapshot();
      if (seq !== loadSeq.current) {
        return;
      }
      setSnapshot(next);
      setError(null);
    } catch {
      if (seq !== loadSeq.current) {
        return;
      }
      setError(describeLoadError());
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [feature]);

  const loadBudget = useCallback(async () => {
    if (!budgetFeature) {
      return;
    }
    const seq = ++budgetLoadSeq.current;
    try {
      const next = await budgetFeature.getDashboardBudgetSummary();
      if (seq !== budgetLoadSeq.current) {
        return;
      }
      setBudgetSummary(next);
      setBudgetFailed(false);
    } catch {
      if (seq !== budgetLoadSeq.current) {
        return;
      }
      // The budget card is supplementary; keep the dashboard usable, but
      // show an inline retry so a transient failure is not mistaken for
      // "no budget set".
      setBudgetFailed(true);
    }
  }, [budgetFeature]);

  const onFocusReload = useCallback(() => {
    void load();
    void loadBudget();
  }, [load, loadBudget]);
  useFocusEffect(onFocusReload);

  const retryAll = useCallback(() => {
    void load();
    void loadBudget();
  }, [load, loadBudget]);

  const openItem = useCallback(
    (transaction: TransactionItem) =>
      openTransaction(stackNavigation, transaction),
    [stackNavigation],
  );

  const hasNoDataAtAll =
    snapshot !== null &&
    snapshot.monthIncome === 0 &&
    snapshot.monthExpense === 0 &&
    snapshot.recent.length === 0;

  return (
    <Screen
      scroll
      style={styles.grow}
      contentContainerStyle={{paddingBottom: spacing.xl + 96}}
      refreshControl={
        <RefreshControl
          refreshing={loading && snapshot !== null}
          onRefresh={() => {
            void load();
            void loadBudget();
          }}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <Text variant="display">Good {greetingFor(now)} 👋</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Your money, tracked privately on this device.
      </Text>

      {snapshot === null ? (
        <View style={styles.fillCenter}>
          {error ? (
            <ErrorState
              icon="cloud-offline-outline"
              title="Could not load dashboard"
              message={error}
              onRetry={retryAll}
            />
          ) : (
            <LoadingIndicator minHeight={160} />
          )}
        </View>
      ) : (
        <>
          <Card style={{marginTop: spacing.md}}>
            <Text variant="label" color="textMuted">
              THIS MONTH
            </Text>
            <Text
              variant="display"
              style={{
                marginTop: spacing.xs,
                color: snapshot.monthBalance < 0 ? colors.danger : colors.text,
              }}
            >
              {formatCurrency(snapshot.monthBalance, currency)}
            </Text>

            <View
              style={[
                styles.monthRow,
                {
                  borderTopColor: colors.border,
                  marginTop: spacing.md,
                  paddingTop: spacing.md,
                },
              ]}
            >
              <Text variant="body">Income</Text>
              <Text variant="label" style={{color: colors.primary}}>
                +{formatCurrency(snapshot.monthIncome, currency)}
              </Text>
            </View>
            <View style={styles.monthRow}>
              <Text variant="body">Spent</Text>
              <Text variant="label">
                -{formatCurrency(snapshot.monthExpense, currency)}
              </Text>
            </View>

            <View
              style={[
                styles.todaySection,
                {
                  borderTopColor: colors.border,
                  marginTop: spacing.sm,
                  paddingTop: spacing.md,
                },
              ]}
            >
              <Text variant="label" color="textMuted">
                TODAY
              </Text>
              <View style={styles.todayColumns}>
                <View style={styles.todayColumn}>
                  <Text variant="caption">Received</Text>
                  <Text variant="label" style={{color: colors.primary}}>
                    +{formatCurrency(snapshot.todayIncome, currency)}
                  </Text>
                </View>
                <View style={styles.todayColumn}>
                  <Text variant="caption">Spent</Text>
                  <Text variant="label">
                    -{formatCurrency(snapshot.todayExpense, currency)}
                  </Text>
                </View>
                <View style={[styles.todayColumn, styles.todayColumnEnd]}>
                  <Text variant="caption">Balance</Text>
                  <Text
                    variant="label"
                    style={{
                      color:
                        snapshot.todayBalance < 0 ? colors.danger : colors.text,
                    }}
                  >
                    {formatCurrency(snapshot.todayBalance, currency)}
                  </Text>
                </View>
              </View>
            </View>
          </Card>

          {budgetFailed && !budgetSummary ? (
            <Card style={{marginTop: spacing.md, gap: spacing.sm}}>
              <Text variant="label" color="textMuted">
                MONTHLY BUDGET
              </Text>
              <Text variant="caption" color="textMuted">
                The budget summary could not be loaded.
              </Text>
              <Button
                title="Try again"
                variant="secondary"
                onPress={retryAll}
              />
            </Card>
          ) : null}

          {budgetSummary ? (
            <Card style={{marginTop: spacing.md, gap: spacing.sm}}>
              <Text variant="label" color="textMuted">
                MONTHLY BUDGET
              </Text>
              {budgetSummary.budget === null ? (
                <>
                  <Text variant="title">Not set</Text>
                  <Text variant="caption" color="textMuted">
                    Spent so far:{' '}
                    {formatCurrency(budgetSummary.spent, currency)}
                  </Text>
                  <View style={{marginTop: spacing.xs}}>
                    <Button
                      title="Set Budget"
                      variant="secondary"
                      fullWidth
                      onPress={() =>
                        stackNavigation.navigate('Budgets', {
                          year: budgetSummary.year,
                          month: budgetSummary.month,
                        })
                      }
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text
                    variant="title"
                    style={{
                      color:
                        budgetSummary.state === 'exceeded'
                          ? colors.danger
                          : colors.text,
                    }}
                  >
                    {formatCurrency(budgetSummary.budget, currency)}
                  </Text>
                  <ProgressBar
                    ratio={
                      budgetSummary.budget > 0
                        ? budgetSummary.spent / budgetSummary.budget
                        : 0
                    }
                    color={budgetStateColor(
                      budgetSummary.state === 'none'
                        ? 'ok'
                        : (budgetSummary.state as BudgetState),
                      colors,
                    )}
                  />
                  <View style={styles.budgetStatsRow}>
                    <Text variant="caption" color="textMuted">
                      Spent {formatCurrency(budgetSummary.spent, currency)}
                    </Text>
                    <Text
                      variant="caption"
                      style={{
                        color:
                          (budgetSummary.remaining ?? 0) < 0
                            ? colors.danger
                            : colors.textMuted,
                      }}
                    >
                      Remaining{' '}
                      {formatCurrency(budgetSummary.remaining ?? 0, currency)}
                    </Text>
                  </View>
                  <View style={styles.budgetFooterRow}>
                    <Text
                      variant="caption"
                      style={{
                        color: budgetStateColor(
                          budgetSummary.state === 'none'
                            ? 'ok'
                            : (budgetSummary.state as BudgetState),
                          colors,
                        ),
                      }}
                    >
                      {formatBudgetPercent(budgetSummary.percent ?? 0)}% used
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="View budget details"
                      hitSlop={8}
                      onPress={() =>
                        stackNavigation.navigate('Budgets', {
                          year: budgetSummary.year,
                          month: budgetSummary.month,
                        })
                      }
                    >
                      <Text variant="label" style={{color: colors.primary}}>
                        View Budget
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </Card>
          ) : null}

          {hasNoDataAtAll ? (
            <View style={{marginTop: spacing.lg}}>
              <EmptyState
                icon="wallet-outline"
                title="No transactions yet"
                message="Tap the + button below to record your first expense or income. Everything stays on this device."
              />
            </View>
          ) : (
            <>
              <Text
                variant="title"
                style={{marginTop: spacing.lg, marginBottom: spacing.sm}}
              >
                Spending by Category
              </Text>
              {snapshot.categoryTotals.length === 0 ? (
                <Text variant="caption" color="textMuted">
                  Nothing spent this month yet.
                </Text>
              ) : (
                <Card style={{gap: spacing.md}}>
                  {snapshot.categoryTotals.map(total => (
                    <View key={total.categoryId} style={styles.categoryRow}>
                      <View
                        style={[
                          styles.categoryIcon,
                          {backgroundColor: colors.surfaceMuted},
                        ]}
                      >
                        <Ionicons
                          name={categoryIconName(total.icon)}
                          size={16}
                          color={colors.textMuted}
                        />
                      </View>
                      <Text
                        variant="body"
                        numberOfLines={1}
                        style={styles.categoryName}
                      >
                        {total.name}
                      </Text>
                      <Text variant="label">
                        {formatCurrency(total.total, currency)}
                      </Text>
                    </View>
                  ))}
                </Card>
              )}

              <View style={styles.recentHeader}>
                <Text variant="title">Recent Transactions</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="See all transactions"
                  hitSlop={8}
                  onPress={() => tabNavigation.navigate('Transactions')}
                >
                  <Text variant="label" style={{color: colors.primary}}>
                    See all
                  </Text>
                </Pressable>
              </View>
              {snapshot.recent.length === 0 ? (
                <Text variant="caption" color="textMuted">
                  Your latest transactions will appear here.
                </Text>
              ) : (
                <View style={{gap: spacing.sm}}>
                  {snapshot.recent.map(transaction => (
                    <TransactionRow
                      key={transaction.key}
                      transaction={transaction}
                      currency={currency}
                      onPress={openItem}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: {flex: 1},
  fillCenter: {
    marginTop: spacing.xl * 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  budgetFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  todaySection: {borderTopWidth: 1},
  todayColumns: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: spacing.lg,
  },
  todayColumn: {flex: 1, gap: 2},
  todayColumnEnd: {flex: 0},
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {flex: 1},
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
});
