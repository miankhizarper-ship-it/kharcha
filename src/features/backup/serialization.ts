import type {DatabaseService} from '@/database/service';
import {SETTINGS_KEYS} from '@/features/settings/service';
import {DEFAULT_CURRENCY} from '@/store/settingsStore';
import {formatDateColumn} from './csv';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupData,
  type KharchaBackup,
} from './types';

/**
 * Builds the typed backup object from the live database and serializes it.
 *
 * Pure data layer: no React, no file I/O. The repositories are the single
 * read path (including archived categories), amounts/dates are copied as the
 * exact stored integers, and SQLite's 0/1 flags become real JSON booleans.
 */

/** Builds the file name for a full backup created on the given day. */
export function buildBackupFilename(nowMs: number): string {
  return `Kharcha_Backup_${formatDateColumn(nowMs)}.json`;
}

// The CSV export filename builder moved to `csvExport.ts` (Phase 10) —
// range-aware and lowercase: `kharcha-transactions-<date>-to-<date>.csv`.

function toBackupData(db: DatabaseService): Promise<BackupData> {
  return (async () => {
    const [
      categories,
      expenses,
      income,
      budgets,
      monthlyBudgets,
      recurringTransactions,
      settings,
    ] = await Promise.all([
      // EVERY category (active + archived) — history must stay resolvable.
      db.categories.list(),
      db.expenses.list({order: 'dateAsc'}),
      db.income.list({order: 'dateAsc'}),
      db.budgets.listAll(),
      db.monthlyBudgets.listAll(),
      // EVERY rule — paused rules are data too and must survive a restore.
      db.recurring.list(),
      db.settings.getAll(),
    ]);

    return {
      categories: categories.map(category => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        type: category.type,
        isDefault: category.isDefault,
        isActive: category.isActive,
        createdAt: category.createdAt,
      })),
      expenses: expenses.map(expense => ({
        id: expense.id,
        amount: expense.amount,
        title: expense.title,
        categoryId: expense.categoryId,
        date: expense.date,
        paymentMethod: expense.paymentMethod,
        note: expense.note,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
        recurringRuleId: expense.recurringRuleId ?? null,
      })),
      income: income.map(record => ({
        id: record.id,
        amount: record.amount,
        source: record.source,
        date: record.date,
        note: record.note,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        recurringRuleId: record.recurringRuleId ?? null,
      })),
      budgets: budgets.map(budget => ({
        id: budget.id,
        categoryId: budget.categoryId,
        amount: budget.amount,
        month: budget.month,
        year: budget.year,
        createdAt: budget.createdAt,
        updatedAt: budget.updatedAt,
      })),
      monthlyBudgets: monthlyBudgets.map(budget => ({
        id: budget.id,
        amount: budget.amount,
        month: budget.month,
        year: budget.year,
        createdAt: budget.createdAt,
        updatedAt: budget.updatedAt,
      })),
      recurringTransactions: recurringTransactions.map(rule => ({
        id: rule.id,
        type: rule.type,
        amount: rule.amount,
        title: rule.title,
        categoryId: rule.categoryId,
        frequency: rule.frequency,
        startDate: rule.startDate,
        nextOccurrenceAt: rule.nextOccurrenceAt,
        endDate: rule.endDate,
        paymentMethod: rule.paymentMethod,
        note: rule.note,
        isActive: rule.isActive,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })),
      settings: settings.map(setting => ({
        key: setting.key,
        value: setting.value,
      })),
    };
  })();
}

function resolveCurrency(settings: BackupData['settings']): string {
  const stored = settings.find(
    setting => setting.key === SETTINGS_KEYS.currency,
  );
  return stored ? stored.value : DEFAULT_CURRENCY;
}

export interface BuildBackupOptions {
  /** App version from expo-constants (injected so tests stay deterministic). */
  appVersion?: string;
  /** Creation timestamp in epoch millis (defaults to Date.now()). */
  now?: number;
}

/** Reads everything required for a full backup and assembles the envelope. */
export async function buildBackup(
  db: DatabaseService,
  options: BuildBackupOptions = {},
): Promise<KharchaBackup> {
  const data = await toBackupData(db);
  const now = options.now ?? Date.now();

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date(now).toISOString(),
    appVersion: options.appVersion ?? 'unknown',
    currency: resolveCurrency(data.settings),
    data,
  };
}

/** Serializes the backup to pretty-printed JSON for the backup file. */
export function serializeBackup(backup: KharchaBackup): string {
  return JSON.stringify(backup, null, 2);
}
