import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Pressable, StyleSheet, View} from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';
import {useSettingsStore} from '@/store/settingsStore';
import type {Category} from '@/database/models';
import {formatDateRangeLabel} from '@/features/reports/period';
import {CustomRangeSheet} from '@/features/reports/components/CustomRangeSheet';
import {CategoryChipPicker} from '@/features/expenses/components/CategoryChipPicker';
import {describeBackupError} from '@/features/backup/errors';
import {
  buildCsvFilename,
  prepareCsvExport,
  resolveExportPeriod,
  type CsvExportPeriod,
  type CsvExportType,
  type PreparedCsvExport,
} from '@/features/backup/csvExport';
import {shareStagedFile, stageFile} from '@/features/backup/fileSystem';
import {useCsvFeature} from '@/features/backup/useCsvFeature';

/** Which period chip is highlighted — custom keeps its own resolved label. */
type PeriodChip = 'all' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

const PERIOD_CHIPS: {value: PeriodChip; label: string}[] = [
  {value: 'all', label: 'All Time'},
  {value: 'thisWeek', label: 'This Week'},
  {value: 'thisMonth', label: 'This Month'},
  {value: 'lastMonth', label: 'Last Month'},
  {value: 'custom', label: 'Custom'},
];

const TYPE_SEGMENTS = ['All', 'Expenses', 'Income'] as const;

/**
 * Export CSV (Phase 10) — configuration → preview → share.
 *
 * The screen only orchestrates: filters map onto repository SQL filters
 * (never JS-side sifting), one read pass feeds both the preview summary
 * and the CSV text, and nothing is staged or shared until the user asks
 * for it (spec §7). Double-submits are prevented by the preparing/sharing
 * busy states.
 */
export function ExportCsvScreen() {
  const {spacing} = useTheme();
  const currency = useSettingsStore(state => state.currency);
  const {db, loadError} = useCsvFeature();

  const [type, setType] = useState<CsvExportType>('all');
  const [chip, setChip] = useState<PeriodChip>('all');
  const [period, setPeriod] = useState<CsvExportPeriod>({kind: 'all'});
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);

  const [prepared, setPrepared] = useState<PreparedCsvExport | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!db) {
      return;
    }
    let active = true;
    // EVERY expense category (archived ones included, muted): historical
    // transactions may live in archived categories and stay exportable.
    db.categories
      .list('expense')
      .then(list => {
        if (active) {
          setCategories(list);
        }
      })
      .catch(() => {
        // Non-fatal: the picker just stays empty; category filtering is
        // optional and everything else still works.
      });
    return () => {
      active = false;
    };
  }, [db]);

  const busy = preparing || sharing;

  const applyType = useCallback((index: number) => {
    const next = (['all', 'expenses', 'income'] as const)[index];
    setType(next);
    setPrepared(null);
    if (next === 'income') {
      // Income has no category FK — the filter is meaningless there.
      setCategoryId(null);
    }
  }, []);

  const applyChip = useCallback((next: PeriodChip) => {
    setChip(next);
    setPrepared(null);
    if (next === 'custom') {
      setRangeSheetVisible(true);
      return;
    }
    setPeriod({kind: next});
  }, []);

  const applyCategory = useCallback((id: number | null) => {
    setCategoryId(id);
    setPrepared(null);
  }, []);

  // Captured once per mount — period labels stay stable across re-renders
  // and no impure Date.now() runs during render (react-hooks/purity).
  const [nowMs] = useState(() => Date.now());

  const rangeLabel = useMemo(() => {
    if (period.kind === 'all') {
      return 'All recorded transactions.';
    }
    const bounds = resolveExportPeriod(period, nowMs);
    return `Covers ${formatDateRangeLabel(bounds.fromDate, bounds.toDate)}.`;
  }, [period, nowMs]);

  const prepare = useCallback(async () => {
    if (!db || busy) {
      return;
    }
    setPreparing(true);
    try {
      const result = await prepareCsvExport(db, {
        type,
        period,
        ...(categoryId !== null ? {categoryId} : {}),
      });
      setPrepared(result);
    } catch (error) {
      Alert.alert('Export failed', describeBackupError(error));
    } finally {
      setPreparing(false);
    }
  }, [db, busy, type, period, categoryId]);

  const share = useCallback(async () => {
    if (!prepared || sharing) {
      return;
    }
    setSharing(true);
    try {
      const filename = buildCsvFilename(Date.now(), prepared.config.period);
      const staged = stageFile(filename, prepared.csv);
      await shareStagedFile(staged, {
        mimeType: 'text/csv',
        dialogTitle: 'Export transactions',
      });
    } catch (error) {
      Alert.alert('Export failed', describeBackupError(error));
    } finally {
      setSharing(false);
    }
  }, [prepared, sharing]);

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Export CSV</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const summary = prepared?.summary ?? null;
  const categoryLocked = type !== 'income';
  const hasRows =
    summary !== null && summary.expenseCount + summary.incomeCount > 0;

  return (
    <Screen scroll contentContainerStyle={{paddingBottom: spacing.xl}}>
      <Text variant="display">Export CSV</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Choose what to include, preview the totals, then share the file.
      </Text>

      <Card style={{marginTop: spacing.md, gap: spacing.sm}}>
        <FieldLabel>Transactions</FieldLabel>
        <SegmentedControl
          segments={TYPE_SEGMENTS}
          selectedIndex={type === 'all' ? 0 : type === 'expenses' ? 1 : 2}
          onSelect={applyType}
        />

        <FieldLabel>Period</FieldLabel>
        <View style={styles.chipRow}>
          {PERIOD_CHIPS.map(item => {
            const isActive = chip === item.value;
            return (
              <PressableChip
                key={item.value}
                label={item.label}
                active={isActive}
                disabled={busy}
                onPress={() => applyChip(item.value)}
              />
            );
          })}
        </View>
        <Text variant="caption" color="textMuted">
          {rangeLabel}
        </Text>

        {categoryLocked ? (
          <>
            <FieldLabel>Category (optional)</FieldLabel>
            <View style={styles.chipRow}>
              <PressableChip
                label="All Categories"
                active={categoryId === null}
                disabled={busy}
                onPress={() => applyCategory(null)}
              />
            </View>
            <CategoryChipPicker
              categories={categories}
              selectedId={categoryId}
              onSelect={applyCategory}
              inactiveIds={categories
                .filter(category => !category.isActive)
                .map(category => category.id)}
            />
            <Text variant="caption" color="textMuted">
              {type === 'all' && categoryId !== null
                ? 'A category filter exports that category\u2019s expenses — income is left out.'
                : 'Income rows have no categories, so filtering applies to expenses only.'}
            </Text>
          </>
        ) : null}

        <Button
          title={prepared ? 'Refresh Preview' : 'Preview Export'}
          onPress={() => void prepare()}
          loading={preparing}
          disabled={!db || busy}
          fullWidth
        />
      </Card>

      {summary ? (
        <Card
          style={{marginTop: spacing.md, gap: spacing.xs}}
          accessibilityLabel="Export preview summary"
        >
          <Text variant="title">Preview</Text>
          <Text variant="body">
            {summary.expenseCount + summary.incomeCount} transactions ·{' '}
            {hasRows ? 'ready to export' : 'nothing to export'}
          </Text>
          <Text variant="body" color="textMuted">
            Expenses: {summary.expenseCount} ·{' '}
            {formatCurrency(summary.totalExpenses, currency)}
          </Text>
          <Text variant="body" color="textMuted">
            Income: {summary.incomeCount} ·{' '}
            {formatCurrency(summary.totalIncome, currency)}
          </Text>
          <Text variant="caption" color="textMuted">
            {summary.fromDate !== null && summary.toDate !== null
              ? formatDateRangeLabel(summary.fromDate, summary.toDate)
              : 'All time'}
          </Text>
          <View style={{marginTop: spacing.sm}}>
            <Button
              title="Export & Share"
              onPress={() => void share()}
              loading={sharing}
              disabled={!hasRows || busy}
              fullWidth
            />
          </View>
        </Card>
      ) : null}

      <Card style={{marginTop: spacing.md}}>
        <Text variant="caption" color="textMuted">
          CSV files contain the transaction ledger only — budgets, recurring
          rules and settings stay in Kharcha. For a complete copy, use the JSON
          backup.
        </Text>
      </Card>

      <CustomRangeSheet
        visible={rangeSheetVisible}
        initialFrom={period.kind === 'custom' ? period.fromDate : undefined}
        initialTo={period.kind === 'custom' ? period.toDate : undefined}
        onApply={(fromDate, toDate) => {
          setRangeSheetVisible(false);
          setPeriod({kind: 'custom', fromDate, toDate});
        }}
        onClose={() => {
          setRangeSheetVisible(false);
          // Closing without applying reverts to All Time only when no
          // custom range existed yet — a picked range stays selected.
          setChip(previous => {
            if (period.kind !== 'custom') {
              return previous === 'custom' ? 'all' : previous;
            }
            return previous;
          });
        }}
      />
    </Screen>
  );
}

/** One period / "all categories" chip — theme tokens only. */
function PressableChip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const {colors, radius, spacing, typography} = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: active, disabled: disabled === true}}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.surface,
          borderColor: active ? colors.primary : colors.border,
          borderRadius: radius.full,
          paddingHorizontal: spacing.sm + 2,
          paddingVertical: spacing.xs + 2,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontSize: typography.size.caption,
          fontWeight: active
            ? typography.weight.semibold
            : typography.weight.medium,
          color: active ? colors.onPrimary : colors.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
