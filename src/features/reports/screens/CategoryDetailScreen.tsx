import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import React, {useCallback, useRef, useState} from 'react';
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
import {categoryIconName} from '@/features/expenses/categoryIcons';
import {
  budgetStateColor,
  budgetStateIcon,
} from '@/features/budgets/components/budgetStateVisuals';
import {
  budgetStateLabel,
  formatBudgetPercent,
} from '@/features/budgets/progress';
import {ProgressBar} from '@/features/budgets/components/ProgressBar';
import {DailyTrendChart} from '@/features/reports/components/DailyTrendChart';
import {MonthOverMonthCard} from '@/features/reports/components/MonthOverMonthCard';
import {describeCategoryDetailLoadError} from '@/features/reports/errors';
import {formatDateRangeLabel} from '@/features/reports/period';
import {CATEGORY_PAGE_SIZE} from '@/features/reports/service';
import {useReportFeature} from '@/features/reports/useReportFeature';
import type {CategoryReportDetail} from '@/features/reports/types';
import {TransactionRow} from '@/features/transactions/components/TransactionRow';
import {openTransaction} from '@/features/transactions/navigation';
import type {TransactionItem} from '@/features/transactions/types';
import type {RootStackParamList} from '@/navigation/types';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import {formatMonthLabel, formatShortDate} from '@/utils/date';
import {formatCurrency} from '@/utils/format';

/**
 * Category Detail — the Reports drill-down (Phase 9). Receives a scope
 * (category id or exact income source) plus the overview's period, and
 * RELOADS everything from the database — no transaction objects travel
 * through navigation. Metrics are aggregate queries; the transaction list
 * pages on demand so a long period never loads its full dataset.
 */
export function CategoryDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'CategoryDetail'>>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {scope, selection, period} = route.params;
  const {colors, radius, spacing} = useTheme();
  const currency = useSettingsStore(state => state.currency);
  const {feature, loadError} = useReportFeature();

  const [detail, setDetail] = useState<CategoryReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const [nextDetail, firstPage] = await Promise.all([
        feature.getCategoryReportDetail(scope, selection, period),
        feature.getCategoryTransactionPage(scope, period, 0),
      ]);
      if (seq !== loadSeq.current) {
        return;
      }
      setDetail(nextDetail);
      setTransactions(firstPage.items);
      setHasMore(firstPage.hasMore);
      setError(null);
    } catch (caught) {
      if (seq !== loadSeq.current) {
        return;
      }
      setDetail(null);
      setTransactions([]);
      setHasMore(false);
      setError(describeCategoryDetailLoadError(caught));
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [feature, scope, selection, period]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (!feature || loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      // The next page index derives from the loaded count, so a refetch
      // that reset the list can never skip or duplicate rows.
      const nextPage = await feature.getCategoryTransactionPage(
        scope,
        period,
        Math.floor(transactions.length / CATEGORY_PAGE_SIZE),
      );
      setTransactions(current => [...current, ...nextPage.items]);
      setHasMore(nextPage.hasMore);
    } catch {
      // Appending more is best-effort; the already-loaded rows stay valid.
    } finally {
      setLoadingMore(false);
    }
  }, [feature, scope, period, transactions.length, hasMore, loadingMore]);

  const openTransactionById = useCallback(
    (type: 'expense' | 'income', id: number) => {
      if (type === 'expense') {
        navigation.navigate('AddExpense', {expenseId: id});
      } else {
        navigation.navigate('AddIncome', {incomeId: id});
      }
    },
    [navigation],
  );

  if (loadError) {
    return (
      <Screen scroll>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const periodLabel = formatDateRangeLabel(period.fromDate, period.toDate);

  const previousLabel =
    selection.kind === 'month'
      ? // Month labels depend only on (year, month) — no clock read needed.
        formatMonthLabel(selection.year, selection.month)
      : 'Previous period';

  if (detail === null) {
    return (
      <Screen scroll>
        {error ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Could not load this report"
            message={error}
            action={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try again"
                onPress={() => void load()}
                style={[
                  styles.retryButton,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text variant="label">Try again</Text>
              </Pressable>
            }
          />
        ) : (
          <LoadingIndicator minHeight={200} />
        )}
      </Screen>
    );
  }

  const totalLabel =
    scope.kind === 'expense' ? 'Total spent' : 'Total received';
  const shareLabel = scope.kind === 'expense' ? 'expenses' : 'income';
  const scopeNoun = scope.kind === 'expense' ? 'category' : 'source';
  const largest = detail.largestTransaction;

  return (
    <Screen
      scroll
      contentContainerStyle={{paddingBottom: spacing.xl}}
      refreshControl={
        <RefreshControl
          refreshing={loading && detail !== null}
          onRefresh={() => void load()}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* -------------------------- identity header -------------------------- */}
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconCircle,
            {backgroundColor: colors.surfaceMuted, borderRadius: radius.full},
          ]}
        >
          <Ionicons
            name={categoryIconName(detail.icon)}
            size={22}
            color={colors.textMuted}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text variant="title" numberOfLines={1}>
            {detail.name}
          </Text>
          <Text variant="caption" color="textMuted">
            {periodLabel}
          </Text>
        </View>
      </View>
      {detail.isActive === false ? (
        <Text
          variant="caption"
          color="textMuted"
          style={{marginTop: spacing.xs}}
        >
          Archived — hidden from new transactions, history kept.
        </Text>
      ) : null}

      {/* ------------------------------ summary ------------------------------ */}
      <Card style={{marginTop: spacing.md, gap: spacing.md}}>
        <View style={styles.metricRow}>
          <Text variant="body" color="textMuted">
            {totalLabel}
          </Text>
          <Text
            variant="title"
            accessibilityLabel={`${totalLabel} ${formatCurrency(detail.total, currency)}`}
          >
            {formatCurrency(detail.total, currency)}
          </Text>
        </View>
        <View style={styles.metricRow}>
          <Text variant="body" color="textMuted">
            Share of {shareLabel}
          </Text>
          {detail.percent !== null ? (
            <Text
              variant="label"
              accessibilityLabel={`${formatBudgetPercent(detail.percent)} percent of ${shareLabel}`}
            >
              {formatBudgetPercent(detail.percent)}%
            </Text>
          ) : (
            <Text variant="label" color="textMuted">
              Nothing to compare yet
            </Text>
          )}
        </View>
        <View style={styles.metricRow}>
          <Text variant="body" color="textMuted">
            Transactions
          </Text>
          <Text variant="label">{detail.transactionCount}</Text>
        </View>
        <View style={styles.metricRow}>
          <Text variant="body" color="textMuted">
            Average Transaction
          </Text>
          <Text
            variant="label"
            accessibilityLabel={`Average transaction ${formatCurrency(detail.averageTransaction, currency)}`}
          >
            {formatCurrency(detail.averageTransaction, currency)}
          </Text>
        </View>
        {largest ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Largest transaction ${largest.title}, ${formatCurrency(largest.amount, currency)}. Open transaction`}
            onPress={() => openTransactionById(largest.type, largest.id)}
            android_ripple={{color: colors.overlay, foreground: true}}
            style={({pressed}) => [
              styles.metricRow,
              styles.largestRow,
              {borderRadius: radius.md, opacity: pressed ? 0.85 : 1},
            ]}
          >
            <View style={styles.largestCopy}>
              <Text variant="body" color="textMuted">
                Largest Transaction
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {largest.title} · {formatShortDate(largest.date)}
              </Text>
            </View>
            <View style={styles.largestValue}>
              <Text variant="label">
                {formatCurrency(largest.amount, currency)}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={colors.textMuted}
              />
            </View>
          </Pressable>
        ) : null}
      </Card>

      {/* ------------------------------- trend ------------------------------- */}
      {detail.total > 0 ? (
        <DailyTrendChart
          points={detail.trend}
          currency={currency}
          bucketDays={detail.trendBucketDays}
        />
      ) : (
        <Card style={{marginTop: spacing.md}}>
          <Text variant="title">
            {scope.kind === 'expense' ? 'Spending Trend' : 'Income Trend'}
          </Text>
          <Text
            variant="caption"
            color="textMuted"
            style={{marginTop: spacing.xs}}
          >
            No transactions in this {scopeNoun} for {periodLabel}.
          </Text>
        </Card>
      )}

      {/* ------------------------------- budget ------------------------------ */}
      <BudgetBlock detail={detail} currency={currency} />

      {/* ------------------------ previous comparison ------------------------ */}
      <MonthOverMonthCard
        comparison={detail.previousComparison}
        currentLabel={periodLabel}
        previousLabel={previousLabel}
        currency={currency}
      />

      {/* ---------------------------- transactions ---------------------------- */}
      <Card style={{marginTop: spacing.md, gap: spacing.md}}>
        <View style={styles.metricRow}>
          <Text variant="title">Transactions</Text>
          {detail.transactionCount > 0 ? (
            <Text variant="caption" color="textMuted">
              {detail.transactionCount} total
            </Text>
          ) : null}
        </View>
        {transactions.length === 0 ? (
          <Text variant="caption" color="textMuted">
            No transactions in this {scopeNoun} for {periodLabel}.
          </Text>
        ) : (
          <>
            {transactions.map(transaction => (
              <TransactionRow
                key={transaction.key}
                transaction={transaction}
                currency={currency}
                onPress={item => openTransaction(navigation, item)}
              />
            ))}
            {hasMore ? (
              <Button
                title={loadingMore ? 'Loading…' : 'Load more'}
                variant="secondary"
                fullWidth
                onPress={() => void loadMore()}
                disabled={loadingMore}
              />
            ) : null}
          </>
        )}
      </Card>
    </Screen>
  );
}

/**
 * The drill-down's budget block, driven by the service's budget status so
 * the three situations never blur together (spec §7/§20):
 * `set` — live progress with the Budget feature's own math and colors;
 * `notSet` — an explicit "Budget not set" (never treated as zero);
 * `notMonthly` — an explanation that budgets are month-scoped. Income has
 * no budget concept at all, so the section is omitted for income scopes.
 */
function BudgetBlock({
  detail,
  currency,
}: {
  detail: CategoryReportDetail;
  currency: string;
}) {
  const {colors, spacing} = useTheme();

  if (detail.scope.kind === 'income') {
    return null;
  }

  return (
    <Card style={{marginTop: spacing.md, gap: spacing.sm}}>
      <Text variant="title">Budget</Text>
      {detail.budgetStatus === 'set' && detail.budget ? (
        <>
          <Text
            variant="title"
            style={{
              color:
                detail.budget.state === 'exceeded'
                  ? colors.danger
                  : colors.text,
            }}
            accessibilityLabel={`Budget ${formatCurrency(detail.budget.amount, currency)}`}
          >
            {formatCurrency(detail.budget.amount, currency)}
          </Text>
          <ProgressBar
            ratio={
              detail.budget.amount > 0
                ? detail.budget.spent / detail.budget.amount
                : 0
            }
            color={budgetStateColor(detail.budget.state, colors)}
          />
          <View style={styles.metricRow}>
            <Text variant="caption" color="textMuted">
              Spent {formatCurrency(detail.budget.spent, currency)}
            </Text>
            <Text
              variant="caption"
              style={{
                color:
                  detail.budget.remaining < 0
                    ? colors.danger
                    : colors.textMuted,
              }}
            >
              Remaining {formatCurrency(detail.budget.remaining, currency)}
            </Text>
          </View>
          <View style={styles.stateRow}>
            <Ionicons
              name={budgetStateIcon(detail.budget.state)}
              size={14}
              color={budgetStateColor(detail.budget.state, colors)}
            />
            <Text
              variant="caption"
              style={{color: budgetStateColor(detail.budget.state, colors)}}
              accessibilityLabel={`${budgetStateLabel(detail.budget.state)}, ${formatBudgetPercent(detail.budget.percent)} percent used`}
            >
              {budgetStateLabel(detail.budget.state)} —{' '}
              {formatBudgetPercent(detail.budget.percent)}% used
            </Text>
          </View>
        </>
      ) : detail.budgetStatus === 'notSet' ? (
        <Text variant="body" color="textMuted">
          Budget not set. Create a budget for this category on the Budget screen
          to track it here.
        </Text>
      ) : (
        <Text variant="body" color="textMuted">
          Budgets are set per month. Open a month in Reports to compare this
          category against its budget.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  iconCircle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {flex: 1, minWidth: 0},
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  largestRow: {paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8},
  largestCopy: {flex: 1, minWidth: 0, gap: 2},
  largestValue: {flexDirection: 'row', alignItems: 'center', gap: 4},
  stateRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
