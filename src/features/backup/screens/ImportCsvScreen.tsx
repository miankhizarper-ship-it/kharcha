import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Alert, StyleSheet, View} from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  LoadingIndicator,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import {useTheme} from '@/theme';
import {formatCurrency} from '@/utils/format';
import {useSettingsStore} from '@/store/settingsStore';
import type {RootStackParamList} from '@/navigation/types';
import {describeBackupError} from '@/features/backup/errors';
import {
  buildImportPlan,
  DEFAULT_IMPORT_OPTIONS,
  type CsvImportOptions,
  type CsvImportPreview,
} from '@/features/backup/csvImport';
import type {CsvImportResult} from '@/features/backup/csvImportService';
import {pickCsvFile} from '@/features/backup/fileSystem';
import {useCsvFeature} from '@/features/backup/useCsvFeature';

type ImportScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'ImportCsv'
>;

/** How many row errors are rendered before the "+N more" line. */
const MAX_VISIBLE_ERRORS = 8;
/** How many duplicate examples are rendered before the "+N more" line. */
const MAX_VISIBLE_DUPLICATES = 5;

/**
 * Import CSV (Phase 10) — select → parse → validate → preview → confirm →
 * import → summary.
 *
 * Nothing touches the database until the user confirms an EXACT statement
 * of consequences (spec §25). While the atomic import runs, every control
 * is disabled and Android back is intercepted (spec §28/§33) so the
 * transaction can never be dismissed mid-flight.
 */
export function ImportCsvScreen({navigation}: ImportScreenProps) {
  const {spacing} = useTheme();
  const currency = useSettingsStore(state => state.currency);
  const {importFeature, loadError} = useCsvFeature();

  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [options, setOptions] = useState<CsvImportOptions>(
    DEFAULT_IMPORT_OPTIONS,
  );
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Ref mirror for the beforeRemove listener (stable subscription).
  const importingRef = useRef(false);
  useEffect(() => {
    importingRef.current = importing;
  }, [importing]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (!importingRef.current) {
        return;
      }
      // An atomic transaction is in flight — dismissal is unsafe.
      event.preventDefault();
      Alert.alert(
        'Import in progress',
        'Please wait — your transactions are being saved.',
      );
    });
    return unsubscribe;
  }, [navigation]);

  const selectFile = useCallback(async () => {
    if (!importFeature || parsing || importing) {
      return;
    }
    setParsing(true);
    try {
      const picked = await pickCsvFile();
      if (picked === null) {
        return; // user cancelled — not an error
      }
      const prepared = await importFeature.prepareImport(picked.content);
      setFilename(picked.filename);
      setOptions(DEFAULT_IMPORT_OPTIONS);
      setResult(null);
      setPreview(prepared);
    } catch (error) {
      Alert.alert('Import failed', describeBackupError(error));
    } finally {
      setParsing(false);
    }
  }, [importFeature, parsing, importing]);

  const plan = useMemo(
    () => (preview ? buildImportPlan(preview, options) : null),
    [preview, options],
  );

  const confirmImport = useCallback(() => {
    if (!importFeature || !preview || !plan || importing) {
      return;
    }
    const toImport = plan.expenses.length + plan.income.length;
    if (toImport === 0) {
      return;
    }

    const consequences = [`You are about to add ${toImport} transactions.`];
    if (plan.skippedDuplicates > 0) {
      consequences.push(
        `${plan.skippedDuplicates} existing transactions will be skipped.`,
      );
    }
    if (plan.categoriesToCreate.length > 0) {
      consequences.push(
        `${plan.categoriesToCreate.length} missing ${
          plan.categoriesToCreate.length === 1 ? 'category' : 'categories'
        } will be created: ${plan.categoriesToCreate.join(', ')}.`,
      );
    }
    if (plan.skippedNoCategory > 0) {
      consequences.push(
        `${plan.skippedNoCategory} rows with unknown categories will be skipped.`,
      );
    }
    if (plan.invalidRows > 0) {
      consequences.push(
        `${plan.invalidRows} invalid rows will not be imported.`,
      );
    }

    Alert.alert('Import these transactions?', consequences.join('\n\n'), [
      {text: 'Cancel', style: 'cancel'},
      {
        text: `Add ${toImport} transactions`,
        onPress: () => {
          void (async () => {
            setImporting(true);
            try {
              const importResult = await importFeature.executeImport(
                preview,
                options,
              );
              setResult(importResult);
              setPreview(null);
              setFilename(null);
            } catch (error) {
              Alert.alert('Import failed', describeBackupError(error));
            } finally {
              setImporting(false);
            }
          })();
        },
      },
    ]);
  }, [importFeature, preview, plan, options, importing]);

  const reset = useCallback(() => {
    setPreview(null);
    setResult(null);
    setFilename(null);
    setOptions(DEFAULT_IMPORT_OPTIONS);
  }, []);

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Import CSV</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  if (importing) {
    return (
      <Screen>
        <Text variant="display">Import CSV</Text>
        <LoadingIndicator />
        <Text variant="body" style={styles.busyNote}>
          Importing transactions…
        </Text>
        <Text variant="caption" color="textMuted" style={styles.busyNote}>
          Saving safely — this only takes a moment. Nothing is added twice.
        </Text>
      </Screen>
    );
  }

  if (result) {
    const importedTotal = result.importedExpenses + result.importedIncome;
    return (
      <Screen scroll>
        <Text variant="display">Import complete</Text>
        <Card style={{marginTop: spacing.md, gap: spacing.xs}}>
          <Text variant="title">
            Imported: {importedTotal}{' '}
            {importedTotal === 1 ? 'transaction' : 'transactions'}
          </Text>
          <Text variant="body" color="textMuted">
            Expenses: {result.importedExpenses} ·{' '}
            {formatCurrency(result.importedExpenseAmount, currency)}
          </Text>
          <Text variant="body" color="textMuted">
            Income: {result.importedIncome} ·{' '}
            {formatCurrency(result.importedIncomeAmount, currency)}
          </Text>
          <Text variant="body" color="textMuted">
            Skipped duplicates: {result.skippedDuplicates}
          </Text>
          <Text variant="body" color="textMuted">
            Invalid rows: {result.invalidRows}
          </Text>
          <Text variant="body" color="textMuted">
            Created categories: {result.createdCategories}
          </Text>
          {result.skippedNoCategory > 0 ? (
            <Text variant="body" color="textMuted">
              Skipped rows with unresolved categories:{' '}
              {result.skippedNoCategory}
            </Text>
          ) : null}
        </Card>
        <View style={{marginTop: spacing.md, gap: spacing.sm}}>
          <Button title="Import Another File" onPress={reset} fullWidth />
          <Button
            title="Done"
            variant="secondary"
            onPress={() => navigation.goBack()}
            fullWidth
          />
        </View>
      </Screen>
    );
  }

  if (preview && plan) {
    const toImport = plan.expenses.length + plan.income.length;
    return (
      <Screen scroll contentContainerStyle={{paddingBottom: spacing.xl}}>
        <Text variant="display">Import CSV</Text>
        <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
          Review before anything is saved.
          {filename ? ` File: ${filename}` : ''}
        </Text>

        <Card
          style={{marginTop: spacing.md, gap: spacing.xs}}
          accessibilityLabel="Import preview summary"
        >
          <Text variant="title">Import summary</Text>
          <Text variant="body" color="textMuted">
            Rows: {preview.totalRows} · Valid: {preview.validRows} · Invalid:{' '}
            {preview.invalidRows}
          </Text>
          <Text variant="body" color="textMuted">
            Expenses: {preview.expenseCount} ·{' '}
            {formatCurrency(preview.totalExpenseAmount, currency)}
          </Text>
          <Text variant="body" color="textMuted">
            Income: {preview.incomeCount} ·{' '}
            {formatCurrency(preview.totalIncomeAmount, currency)}
          </Text>
          <Text variant="body" color="textMuted">
            Existing duplicates: {preview.duplicateCount}
          </Text>
          {preview.invalidRows > 0 ? (
            <Text variant="body">
              {preview.invalidRows} rows will not be imported.
            </Text>
          ) : null}
        </Card>

        {preview.errors.length > 0 ? (
          <Card style={{marginTop: spacing.md, gap: spacing.xs}}>
            <Text variant="title">Row problems</Text>
            {preview.errors.slice(0, MAX_VISIBLE_ERRORS).map(error => (
              <Text
                key={error.row}
                variant="caption"
                color="textMuted"
                accessibilityRole="text"
              >
                Row {error.row}: {error.message}
              </Text>
            ))}
            {preview.errors.length > MAX_VISIBLE_ERRORS ? (
              <Text variant="caption" color="textMuted">
                +{preview.errors.length - MAX_VISIBLE_ERRORS} more rows with
                problems.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {preview.duplicateCount > 0 ? (
          <Card style={{marginTop: spacing.md, gap: spacing.xs}}>
            <Text variant="title">Duplicates already in Kharcha</Text>
            {preview.duplicates
              .slice(0, MAX_VISIBLE_DUPLICATES)
              .map(duplicate => (
                <Text
                  key={duplicate.row}
                  variant="caption"
                  color="textMuted"
                  accessibilityRole="text"
                >
                  Row {duplicate.row}: {duplicate.label} ·{' '}
                  {formatCurrency(duplicate.amountMinor, currency)} ·{' '}
                  {duplicate.dateLabel}
                </Text>
              ))}
            {preview.duplicateCount > MAX_VISIBLE_DUPLICATES ? (
              <Text variant="caption" color="textMuted">
                +{preview.duplicateCount - MAX_VISIBLE_DUPLICATES} more
                duplicates.
              </Text>
            ) : null}
          </Card>
        ) : null}

        <Card style={{marginTop: spacing.md, gap: spacing.sm}}>
          <FieldLabel>Duplicates</FieldLabel>
          <SegmentedControl
            segments={['Skip duplicates', 'Import all rows']}
            selectedIndex={options.mode === 'skipDuplicates' ? 0 : 1}
            onSelect={index =>
              setOptions(previous => ({
                ...previous,
                mode: index === 0 ? 'skipDuplicates' : 'importAll',
              }))
            }
          />
          <Text variant="caption" color="textMuted">
            Skipping keeps matching records out — recommended when a file was
            exported from Kharcha before.
          </Text>

          {preview.missingCategories.length > 0 ? (
            <>
              <FieldLabel>Missing categories</FieldLabel>
              <SegmentedControl
                segments={['Create them', 'Skip those rows']}
                selectedIndex={options.createMissingCategories ? 0 : 1}
                onSelect={index =>
                  setOptions(previous => ({
                    ...previous,
                    createMissingCategories: index === 0,
                  }))
                }
              />
              <Text variant="caption" color="textMuted">
                Not in Kharcha yet: {preview.missingCategories.join(', ')}.
                Created categories are expense categories.
              </Text>
            </>
          ) : null}
        </Card>

        <View style={{marginTop: spacing.md, gap: spacing.sm}}>
          <Button
            title={
              toImport > 0
                ? `Add ${toImport} transactions`
                : 'Nothing to import'
            }
            onPress={confirmImport}
            disabled={toImport === 0}
            fullWidth
          />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={reset}
            fullWidth
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text variant="display">Import CSV</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Add transactions from a Kharcha CSV export. Every row is validated and
        shown to you before anything is saved.
      </Text>

      <Card style={{marginTop: spacing.md, gap: spacing.xs}}>
        <Text variant="body" color="textMuted">
          The file must be a Kharcha transactions export (the header row starts
          with Type, Date, Amount, Title…).
        </Text>
        <Text variant="body" color="textMuted">
          Importing only ADDS transactions — budgets, recurring rules and
          settings are never changed. For a complete restore, use the JSON
          backup instead.
        </Text>
        <View style={{marginTop: spacing.sm}}>
          <Button
            title={parsing ? 'Reading file…' : 'Select CSV File'}
            onPress={() => void selectFile()}
            loading={parsing}
            disabled={!importFeature || parsing}
            fullWidth
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  busyNote: {marginTop: 16, textAlign: 'center'},
});
