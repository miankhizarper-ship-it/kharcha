import Constants from 'expo-constants';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useCallback, useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';

import {Button, Card, EmptyState, Screen, Text} from '@/components/ui';
import {formatShortDate} from '@/utils/date';
import {useTheme} from '@/theme';
import {hydrateSettingsFromDatabase} from '@/features/settings/bootstrap';
import {buildBackupFilename} from '@/features/backup/serialization';
import {describeBackupError} from '@/features/backup/errors';
import type {ValidatedBackup} from '@/features/backup/types';
import {
  pickBackupFile,
  shareStagedFile,
  stageFile,
} from '@/features/backup/fileSystem';
import {useBackupFeature} from '@/features/backup/useBackupFeature';
import type {RootStackParamList} from '@/navigation/types';

/** Which flow is running — drives the loading/disabled state of all buttons. */
type BusyFlow = 'backup' | 'restore' | null;

/**
 * Backup & Data — the data-lifecycle hub (Phase 10).
 *
 * The four flows are deliberately distinct in wording (spec §24): JSON
 * backup/restore move the COMPLETE dataset (settings, budgets, recurring
 * rules, categories), while CSV export/import move TRANSACTIONS only.
 * CSV import is additive (add/merge rows); JSON restore is destructive
 * (replace everything) and says so.
 */
export function BackupScreen() {
  const {spacing} = useTheme();
  const {feature, loadError} = useBackupFeature();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [busy, setBusy] = useState<BusyFlow>(null);

  const guard = useCallback(
    (flow: Exclude<BusyFlow, null>): boolean => {
      if (feature === null) {
        return false;
      }
      setBusy(flow);
      return true;
    },
    [feature],
  );

  const finish = useCallback(() => setBusy(null), []);

  const fail = useCallback((title: string, error: unknown) => {
    Alert.alert(title, describeBackupError(error));
  }, []);

  const createBackup = useCallback(async () => {
    if (!feature || !guard('backup')) {
      return;
    }
    try {
      const json = await feature.generateBackupJson({
        appVersion: Constants.expoConfig?.version ?? 'unknown',
      });
      const staged = stageFile(buildBackupFilename(Date.now()), json);
      await shareStagedFile(staged, {
        mimeType: 'application/json',
        dialogTitle: 'Save Kharcha backup',
      });
    } catch (error) {
      fail('Backup failed', error);
    } finally {
      finish();
    }
  }, [feature, guard, finish, fail]);

  const restoreBackup = useCallback(async () => {
    if (!feature || !guard('restore')) {
      return;
    }
    try {
      const picked = await pickBackupFile();
      if (picked === null) {
        return;
      }

      let validated: ValidatedBackup;
      try {
        validated = feature.parseBackup(picked.content);
      } catch (error) {
        Alert.alert('Invalid backup', describeBackupError(error));
        return;
      }

      // Explicit confirmation with the backup summary (spec §11).
      const summary = [
        `Backup created: ${formatShortDate(new Date(validated.meta.createdAt).getTime())}`,
        `Expenses: ${validated.counts.expenses}`,
        `Income: ${validated.counts.income}`,
        `Categories: ${validated.counts.categories}`,
        `Budgets: ${validated.counts.budgets}`,
      ];
      if (validated.counts.monthlyBudgets > 0) {
        summary.push(`Monthly budgets: ${validated.counts.monthlyBudgets}`);
      }
      if (validated.counts.recurringTransactions > 0) {
        summary.push(
          `Recurring rules: ${validated.counts.recurringTransactions}`,
        );
      }
      if (validated.counts.settings > 0) {
        summary.push(`Settings: ${validated.counts.settings}`);
      }

      Alert.alert(
        'Restore this backup?',
        `${summary.join('\n')}\n\nEverything currently in Kharcha will be replaced. This cannot be undone.`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Replace my data',
            style: 'destructive',
            onPress: () => {
              // The picker/confirm phase cleared `busy` on the way out —
              // re-engage it so the restore itself stays single-flight.
              setBusy('restore');
              const runRestore = async () => {
                try {
                  const result = await feature.restoreBackup(validated);
                  // Settings (currency, theme) may have changed with the
                  // restored data — re-read them into the runtime store.
                  await hydrateSettingsFromDatabase();
                  Alert.alert(
                    'Backup restored',
                    `${result.expenses} expenses and ${result.income} income records were restored.`,
                  );
                } catch (error) {
                  fail('Restore failed', error);
                } finally {
                  finish();
                }
              };
              void runRestore();
            },
          },
        ],
      );
    } catch (error) {
      fail('Restore failed', error);
    } finally {
      finish();
    }
  }, [feature, guard, finish, fail]);

  if (loadError) {
    return (
      <Screen scroll>
        <Text variant="display">Backup &amp; Export</Text>
        <EmptyState
          icon="cloud-offline-outline"
          title="Database unavailable"
          message={loadError}
        />
      </Screen>
    );
  }

  const busyNow = busy !== null;

  return (
    <Screen scroll contentContainerStyle={{paddingBottom: spacing.xl}}>
      <Text variant="display">Backup &amp; Export</Text>
      <Text variant="body" color="textMuted" style={{marginTop: spacing.xs}}>
        Keep a copy of your ledger, or bring data in.
      </Text>

      <Text variant="title" style={{marginTop: spacing.lg}}>
        Export CSV
      </Text>
      <Card style={{marginTop: spacing.sm, gap: spacing.sm}}>
        <Text variant="caption" color="textMuted">
          Transactions for viewing, spreadsheets, or importing again — choose
          the type, date range and category, then preview before sharing.
        </Text>
        <Button
          title="Export CSV"
          onPress={() => navigation.navigate('ExportCsv', undefined)}
          disabled={busyNow}
          fullWidth
        />
      </Card>

      <Text variant="title" style={{marginTop: spacing.lg}}>
        Import CSV
      </Text>
      <Card style={{marginTop: spacing.sm, gap: spacing.sm}}>
        <Text variant="caption" color="textMuted">
          Add or merge transactions from a Kharcha CSV file. Every row is
          validated and previewed before anything is saved — invalid rows and
          duplicates are your choice, never a surprise.
        </Text>
        <Button
          title="Import CSV"
          onPress={() => navigation.navigate('ImportCsv', undefined)}
          disabled={busyNow}
          fullWidth
        />
      </Card>

      <Text variant="title" style={{marginTop: spacing.lg}}>
        Full Backup
      </Text>
      <Card style={{marginTop: spacing.sm, gap: spacing.sm}}>
        <Text variant="caption" color="textMuted">
          Complete Kharcha data: one JSON file with all categories,
          transactions, budgets, recurring rules and settings — everything
          needed to move your ledger to a new phone.
        </Text>
        <Button
          title="Create Backup"
          onPress={() => void createBackup()}
          loading={busy === 'backup'}
          disabled={busyNow}
          fullWidth
        />
      </Card>

      <Text variant="title" style={{marginTop: spacing.lg}}>
        Restore Backup
      </Text>
      <Card style={{marginTop: spacing.sm, gap: spacing.sm}}>
        <Text variant="caption" color="textMuted">
          Replaces the data currently in Kharcha with the contents of a complete
          JSON backup. You will see a summary and be asked to confirm before
          anything changes.
        </Text>
        <Button
          title="Restore Backup"
          variant="danger"
          onPress={() => void restoreBackup()}
          loading={busy === 'restore'}
          disabled={busyNow}
          fullWidth
        />
      </Card>

      <Card style={{marginTop: spacing.lg}}>
        <Text variant="caption" color="textMuted">
          JSON backup = complete Kharcha data. CSV = transactions for viewing,
          export and import. CSV import adds rows — it never replaces budgets,
          recurring rules or settings.
        </Text>
      </Card>

      <View style={styles.privacyNote}>
        <Text variant="caption" color="textMuted" style={styles.privacyText}>
          Your data stays on this device. Backups are files you can save or
          share yourself — nothing is uploaded anywhere.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  privacyNote: {marginTop: 24, paddingHorizontal: 8},
  privacyText: {textAlign: 'center'},
});
