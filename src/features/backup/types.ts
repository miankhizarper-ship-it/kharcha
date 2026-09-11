import type {Category, Expense, RecurringFrequency} from '@/database/models';

/**
 * The backup file format, version 2.
 *
 * The format is intentionally designed around Kharcha's DOMAIN models (see
 * `src/database/models.ts`) — not a raw SQLite dump:
 * - money is copied as the exact integer minor-unit values stored in the
 *   database (no floats, no conversion, no formatting);
 * - dates are copied as the exact epoch-millisecond integers;
 * - booleans that SQLite stores as 0/1 are serialized as real JSON booleans;
 * - IDs and relationships (categoryId, recurringRuleId) are preserved so a
 *   restore keeps every historical record linked to its category and to
 *   the recurring rule that generated it.
 *
 * VERSION HISTORY
 * - v1 (Phase 7B): the six core datasets. Still restorable — parseBackup
 *   migrates v1 files to v2 by adding an empty `recurringTransactions`
 *   list and `recurringRuleId: null` on transactions; the meaning of
 *   every v1 record is unchanged (spec §24).
 * - v2 (Phase 7C): adds `data.recurringTransactions` and the nullable
 *   `recurringRuleId` on expense/income records.
 */

/** Identifies every Kharcha backup file. Restore rejects anything else. */
export const BACKUP_FORMAT = 'kharcha-backup';

/** The only backup version this app can restore (v1 is migrated on parse). */
export const BACKUP_VERSION = 2 as const;

/** The v1 marker, used by the v1 → v2 migration step in `validation.ts`. */
export const BACKUP_VERSION_V1 = 1 as const;

export interface BackupCategory {
  id: number;
  name: string;
  icon: string;
  type: Category['type'];
  isDefault: boolean;
  isActive: boolean;
  createdAt: number;
}

export interface BackupExpense {
  id: number;
  /** Minor units (paisa) — copied verbatim, never converted. */
  amount: number;
  title: string;
  categoryId: number;
  /** Epoch millis — copied verbatim. */
  date: number;
  paymentMethod: Expense['paymentMethod'];
  note: string | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Reference to the recurring rule that GENERATED this row (v2+);
   * null for manual records. Restored verbatim so provenance survives
   * a backup round trip.
   */
  recurringRuleId: number | null;
}

export interface BackupIncome {
  id: number;
  amount: number;
  source: string;
  date: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  /** Reference to the recurring rule that GENERATED this row (v2+). */
  recurringRuleId: number | null;
}

export interface BackupBudget {
  id: number;
  categoryId: number;
  amount: number;
  month: number;
  year: number;
  createdAt: number;
  updatedAt: number;
}

export interface BackupMonthlyBudget {
  id: number;
  amount: number;
  month: number;
  year: number;
  createdAt: number;
  updatedAt: number;
}

export interface BackupSetting {
  key: string;
  value: string;
}

/**
 * A recurring RULE (v2+) — not a transaction. Amounts/dates copy the exact
 * stored integers (occurrences are local-noon epoch millis); ids and the
 * category relationship are preserved so generation continues seamlessly
 * after a restore.
 */
export interface BackupRecurringRule {
  id: number;
  type: Category['type'];
  /** Minor units (paisa) — copied verbatim, never converted. */
  amount: number;
  /** Expense title, or the income source of generated rows. */
  title: string;
  /** Expense rules only; null for income rules. */
  categoryId: number | null;
  frequency: RecurringFrequency;
  startDate: number;
  nextOccurrenceAt: number;
  /** Inclusive last occurrence; null = indefinite. */
  endDate: number | null;
  /** Expense rules only; null for income rules. */
  paymentMethod: Expense['paymentMethod'] | null;
  note: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BackupData {
  categories: BackupCategory[];
  expenses: BackupExpense[];
  income: BackupIncome[];
  budgets: BackupBudget[];
  monthlyBudgets: BackupMonthlyBudget[];
  /** v2+. v1 files migrate to an empty list (see version history above). */
  recurringTransactions: BackupRecurringRule[];
  settings: BackupSetting[];
}

/** The complete, versioned backup envelope — what the JSON file contains. */
export interface KharchaBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** ISO 8601 timestamp of when the backup was created. */
  createdAt: string;
  /** App version from the Expo project configuration (informational). */
  appVersion: string;
  /** Display currency at backup time (informational; settings also carry it). */
  currency: string;
  data: BackupData;
}

/** Record counts used for the pre-restore summary and the success message. */
export interface BackupCounts {
  categories: number;
  expenses: number;
  income: number;
  budgets: number;
  monthlyBudgets: number;
  recurringTransactions: number;
  settings: number;
}

/**
 * A backup that has passed full structural + relationship validation and is
 * safe to hand to the restore transaction.
 */
export interface ValidatedBackup {
  meta: {
    createdAt: string;
    appVersion: string;
  };
  data: BackupData;
  counts: BackupCounts;
}

/** What the restore actually wrote — confirmed with counts after the fact. */
export type RestoreResult = BackupCounts;
