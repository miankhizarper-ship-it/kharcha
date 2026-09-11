import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

import {
  EmptyState,
  ErrorState,
  LoadingIndicator,
  Screen,
  Text,
  TextInput,
} from '@/components/ui';
import type {Category} from '@/database/models';
import {TRANSACTION_TYPE_FILTERS} from '@/features/transactions/types';
import type {
  TransactionItem,
  TransactionTypeFilter,
} from '@/features/transactions/types';
import {TransactionRow} from '@/features/transactions/components/TransactionRow';
import {FilterChip} from '@/features/transactions/components/FilterChip';
import {FilterSheet} from '@/features/transactions/components/FilterSheet';
import {openTransaction} from '@/features/transactions/navigation';
import {useTransactionsFeature} from '@/features/transactions/useTransactionsFeature';
import {describeLoadError} from '@/features/expenses/errors';
import {useSettingsStore} from '@/store/settingsStore';
import {useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';
import type {ActiveFilterChipKind} from '@/features/transactions/filters';
import {
  buildActiveFilterChips,
  buildTransactionSummary,
  defaultTransactionFilters,
  filtersToQuery,
  hasActiveFilters,
  removeFilterChip,
  summarizeCountForAccessibility,
} from '@/features/transactions/filters';

/**
 * Transactions — the combined ledger. Searchable, filterable (type,
 * category, payment method, recurrence, date window, amount range), sortable
 * and paginated, all read from SQLite through the transactions feature
 * service: expenses and income live in separate tables and are merged into
 * one deterministic list where every row shows whether money was spent or
 * received.
 *
 * Filter state lives in ONE object (`TransactionFilters`), so any change
 * produces a new `load` identity → focus effect re-runs → pagination resets.
 * The load-sequence ref (Phase 8 race fix) still guards every in-flight
 * response against superseded queries.
 */
export function TransactionsScreen() {
  const {colors, spacing} = useTheme();
  const stackNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const currency = useSettingsStore(state => state.currency);
  const {feature} = useTransactionsFeature();

  const [filters, setFilters] = useState(defaultTransactionFilters);
  const [searchInput, setSearchInput] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [items, setItems] = useState<TransactionItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** SQL COUNT of matching rows (constraining filters only). */
  const [resultCount, setResultCount] = useState<number | null>(null);

  const loadSeq = useRef(0);

  // Debounce search input so typing does not hammer SQLite. The timer is
  // cleaned up on every change/unmount; committing the SAME search value
  // returns the previous state object, which skips the reload entirely.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      setFilters(previous =>
        previous.search === next ? previous : {...previous, search: next},
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load EVERY expense category (archived included) for the filter sheet —
  // historical transactions must stay discoverable under archived
  // categories. Income has no categories; its rows simply never match a
  // category-filtered query.
  useEffect(() => {
    if (!feature) {
      return;
    }
    let active = true;
    feature
      .listFilterCategories()
      .then(rows => {
        if (active) {
          setCategories(rows);
        }
      })
      .catch(() => {
        if (active) {
          setCategories([]);
        }
      });
    return () => {
      active = false;
    };
  }, [feature]);

  const load = useCallback(async () => {
    if (!feature) {
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    const active = hasActiveFilters(filters);
    try {
      const [result, count] = await Promise.all([
        feature.getTransactionPage(filtersToQuery(filters, 0)),
        // The count is supplementary — a failure never blocks the list.
        active
          ? feature
              .getTransactionCount(filtersToQuery(filters, 0))
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      if (seq !== loadSeq.current) {
        return; // A newer load superseded this one.
      }
      setItems(result.items);
      setHasMore(result.hasMore);
      setPage(0);
      setLoadMoreError(false);
      setError(null);
      setResultCount(active ? count : null);
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
  }, [feature, filters]);

  // Reload on focus, on filter change, and when a mutation bumps the
  // version (react-navigation re-runs this when the callback identity
  // changes while the screen is focused). Returning from an edit keeps the
  // filters — they live in state and are never reset here.
  const onFocusReload = useCallback(() => {
    void load();
  }, [load]);

  useFocusEffect(onFocusReload);

  // Pull-to-refresh only spins its own indicator — filter/search reloads
  // must not flash the native refresh spinner at the top of the list.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!feature || !items || loading || loadingMore || !hasMore) {
      return;
    }
    // Capture the load generation so a filter/search/sort change that fires
    // `load()` mid-flight cannot let this older page still append rows
    // (which would corrupt the list with rows from the previous query).
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const result = await feature.getTransactionPage(
        filtersToQuery(filters, page + 1),
      );
      if (seq !== loadSeq.current) {
        return; // Filters changed while this page was in flight.
      }
      setItems(previous => {
        const known = new Set((previous ?? []).map(item => item.key));
        return [
          ...(previous ?? []),
          ...result.items.filter(i => !known.has(i.key)),
        ];
      });
      setHasMore(result.hasMore);
      setPage(page + 1);
      setLoadMoreError(false);
    } catch {
      if (seq === loadSeq.current) {
        setLoadMoreError(true);
      }
    } finally {
      if (seq === loadSeq.current) {
        setLoadingMore(false);
      }
    }
  }, [feature, items, loading, loadingMore, hasMore, filters, page]);

  const changeType = useCallback((next: TransactionTypeFilter) => {
    setFilters(previous => {
      if (previous.type === next) {
        return previous;
      }
      // Category and payment method apply to expenses only; reset them when
      // switching to income so the filters can never contradict each other.
      return next === 'income'
        ? {...previous, type: next, categoryId: null, paymentMethod: null}
        : {...previous, type: next};
    });
  }, []);

  const categoryNameOf = useCallback(
    (id: number | null): string | undefined =>
      id === null
        ? undefined
        : categories?.find(category => category.id === id)?.name,
    [categories],
  );

  const filtersActive = hasActiveFilters(filters);

  const activeChips = buildActiveFilterChips(filters, {
    categoryName: categoryNameOf(filters.categoryId),
    currency,
  });

  const removeChip = useCallback((kind: ActiveFilterChipKind) => {
    if (kind === 'search') {
      setSearchInput('');
    }
    setFilters(previous => removeFilterChip(previous, kind));
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setFilters(defaultTransactionFilters());
  }, []);

  const openItem = useCallback(
    (transaction: TransactionItem) =>
      openTransaction(stackNavigation, transaction),
    [stackNavigation],
  );

  const renderItem = useCallback(
    ({item}: {item: TransactionItem}) => (
      <TransactionRow
        transaction={item}
        currency={currency}
        onPress={openItem}
      />
    ),
    [currency, openItem],
  );

  const summary =
    filtersActive && resultCount !== null
      ? buildTransactionSummary(resultCount, filters, {
          categoryName: categoryNameOf(filters.categoryId),
          currency,
        })
      : null;

  const renderFilters = () => (
    <View style={{gap: spacing.sm, marginTop: spacing.sm}}>
      <View style={styles.filterRow}>
        {TRANSACTION_TYPE_FILTERS.map(option => (
          <FilterChip
            key={option.value}
            label={option.label}
            selected={option.value === filters.type}
            onPress={() => changeType(option.value)}
            accessibilityLabel={`${option.label} type filter, ${
              option.value === filters.type ? 'selected' : 'not selected'
            }`}
          />
        ))}
        <FilterChip
          label={
            filtersActive ? `Filters (${countConstraints(filters)})` : 'Filters'
          }
          selected={false}
          onPress={() => {
            Keyboard.dismiss();
            setSheetVisible(true);
          }}
          icon="options-outline"
          accessibilityLabel={`Open filter options${
            filtersActive ? `, ${countConstraints(filters)} active` : ''
          }`}
        />
      </View>
      {activeChips.length > 0 ? (
        <View style={styles.filterRow}>
          {activeChips.map(chip => (
            <FilterChip
              key={chip.kind}
              label={chip.label}
              selected
              onPress={() => removeChip(chip.kind)}
              icon="close"
              accessibilityLabel={chip.accessibilityLabel}
            />
          ))}
          <FilterChip
            label="Clear all"
            selected={false}
            onPress={clearAllFilters}
            icon="close-circle-outline"
            accessibilityLabel="Clear all filters"
          />
        </View>
      ) : null}
      {summary ? (
        <Text
          variant="caption"
          accessibilityLiveRegion="polite"
          accessibilityLabel={summarizeCountForAccessibility(
            resultCount ?? 0,
            filters,
          )}
        >
          {summary}
        </Text>
      ) : null}
    </View>
  );

  const isStale = loading && items !== null;

  let body: React.ReactNode;
  if (items === null) {
    body = error ? (
      <View style={styles.fill}>
        <ErrorState
          icon="cloud-offline-outline"
          title="Could not load transactions"
          message={error}
          onRetry={() => void load()}
        />
      </View>
    ) : (
      <View style={styles.fill}>
        <LoadingIndicator />
      </View>
    );
  } else {
    body = (
      <View style={[styles.fill, isStale ? styles.stale : null]}>
        <FlatList
          style={styles.fill}
          data={items}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          pointerEvents={isStale ? 'none' : undefined}
          contentContainerStyle={{
            gap: spacing.sm,
            // Matches Home so the last row clears the center FAB on both tabs.
            paddingBottom: spacing.xl + 96,
            flexGrow: 1,
          }}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.fill}>
              <EmptyState
                icon="receipt-outline"
                title={
                  filtersActive
                    ? 'No transactions match these filters'
                    : 'No transactions yet'
                }
                message={
                  filtersActive
                    ? 'Nothing matches the current search and filters. Try changing them, or clear everything to see the full history.'
                    : 'Tap the + button below to record your first expense or income.'
                }
                action={
                  filtersActive ? (
                    <ButtonLikeReset resetFilters={clearAllFilters} />
                  ) : null
                }
              />
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={{marginVertical: spacing.md}}
                color={colors.primary}
              />
            ) : loadMoreError ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Could not load more. Tap to retry."
                onPress={() => void loadMore()}
                style={{alignItems: 'center', paddingVertical: spacing.md}}
              >
                <Text variant="caption" style={{color: colors.danger}}>
                  Could not load more. Tap to retry.
                </Text>
              </Pressable>
            ) : null
          }
        />
      </View>
    );
  }

  return (
    <Screen>
      <Text variant="display">Transactions</Text>
      <View style={{marginTop: spacing.md}}>
        <View>
          <TextInput
            placeholder="Search title, category, method or note"
            value={searchInput}
            onChangeText={setSearchInput}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            accessibilityLabel="Search transactions"
          />
          {searchInput.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              onPress={() => {
                // Immediate commit keeps clearing snappy; the debounced
                // effect later sees the same value and skips the reload.
                setSearchInput('');
                setFilters(previous =>
                  previous.search === '' ? previous : {...previous, search: ''},
                );
              }}
              style={[
                styles.searchClear,
                {
                  backgroundColor: colors.surfaceMuted,
                },
              ]}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {renderFilters()}
      <View style={{marginTop: spacing.md, flex: 1}}>{body}</View>

      <FilterSheet
        visible={sheetVisible}
        initialFilters={filters}
        categories={categories ?? []}
        currency={currency}
        onApply={next => {
          setSheetVisible(false);
          setFilters(next);
        }}
        onClose={() => setSheetVisible(false)}
      />
    </Screen>
  );
}

/** Number of rows-CONSTRAINING filters (sort excluded) for the badge. */
function countConstraints(
  filters: Parameters<typeof hasActiveFilters>[0],
): number {
  let count = 0;
  if (filters.search.length > 0) {
    count++;
  }
  if (filters.type !== 'all') {
    count++;
  }
  if (filters.categoryId !== null) {
    count++;
  }
  if (filters.paymentMethod !== null) {
    count++;
  }
  if (filters.recurring !== 'all') {
    count++;
  }
  if (filters.period !== 'all') {
    count++;
  }
  if (filters.minAmount !== null) {
    count++;
  }
  if (filters.maxAmount !== null) {
    count++;
  }
  return count;
}

/** Small clear-filters button used in the filtered empty state. */
function ButtonLikeReset({resetFilters}: {resetFilters: () => void}) {
  const {colors, radius, spacing, typography} = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear all filters"
      onPress={resetFilters}
      style={[
        styles.retryButton,
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
        },
      ]}
    >
      <Text
        variant="label"
        style={{
          color: colors.text,
          fontSize: typography.size.label,
          fontWeight: typography.weight.medium,
        }}
      >
        Clear filters
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  /** Predictable in-place transition while a new query runs (spec §21). */
  stale: {opacity: 0.45},
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchClear: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
