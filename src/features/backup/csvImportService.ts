import type {DatabaseService} from '@/database/service';
import {withTransaction} from '@/database/transaction';
import {ImportDatabaseError} from './errors';
import {
  buildImportPlan,
  createCategoryMatcher,
  normalizedCategoryKey,
  prepareCsvImport,
  type CsvImportOptions,
  type CsvImportPreview,
} from './csvImport';

/**
 * The write half of CSV import (Phase 10): preview in `csvImport.ts`,
 * ATOMIC execution here.
 *
 * Transaction contract (spec §17–§18): BEGIN IMMEDIATE → re-resolve
 * categories against fresh in-transaction reads → create missing
 * categories (same transaction) → insert every selected expense/income →
 * verify foreign keys and exact inserted counts → COMMIT. ANY failure —
 * constraint violation, engine error, count mismatch — rolls the whole
 * transaction back, leaving the previous dataset byte-identical. No
 * half-imported datasets, no orphan category references, no partially
 * created categories.
 *
 * Performance contract (spec §31): no per-row database lookups anywhere.
 * Categories are read once and matched in memory; inserts are sequential
 * parameterized statements inside the single transaction (the standard
 * SQLite batch pattern — one statement per row IS the batch insert, and
 * all of them share one COMMIT fsync).
 */

/** Confirmed outcome of a successful import (spec §19). */
export interface CsvImportResult {
  importedExpenses: number;
  importedIncome: number;
  skippedDuplicates: number;
  /** Valid rows dropped because their category was left unresolved. */
  skippedNoCategory: number;
  /** Rows that were never candidates (invalid in the preview). */
  invalidRows: number;
  createdCategories: number;
  /** Minor units. */
  importedExpenseAmount: number;
  /** Minor units. */
  importedIncomeAmount: number;
}

/** The import feature — same injectable-`DatabaseService` style as backup. */
export interface CsvImportFeature {
  /** Read-only parse + validate + duplicate detection (spec §8: preview first). */
  prepareImport(csvText: string): Promise<CsvImportPreview>;
  /** Atomically writes the planned rows. Throws `ImportDatabaseError` on failure. */
  executeImport(
    preview: CsvImportPreview,
    options: CsvImportOptions,
  ): Promise<CsvImportResult>;
}

/** Insert statements — identical column contracts to migration 001. */
const INSERT_EXPENSE = `
  INSERT INTO expenses
    (amount, title, category_id, date, payment_method, note, created_at, updated_at, recurring_rule_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
`;

const INSERT_INCOME = `
  INSERT INTO income
    (amount, source, date, note, created_at, updated_at, recurring_rule_id)
  VALUES (?, ?, ?, ?, ?, ?, NULL)
`;

/** Neutral icon for categories created by import (same default as tests). */
const IMPORTED_CATEGORY_ICON = 'pricetag';

export function createCsvImportFeature(db: DatabaseService): CsvImportFeature {
  return {
    prepareImport(csvText: string): Promise<CsvImportPreview> {
      return prepareCsvImport(db, csvText);
    },

    async executeImport(
      preview: CsvImportPreview,
      options: CsvImportOptions,
    ): Promise<CsvImportResult> {
      const plan = buildImportPlan(preview, options);
      const nothingToWrite =
        plan.expenses.length === 0 &&
        plan.income.length === 0 &&
        plan.categoriesToCreate.length === 0;

      const result: CsvImportResult = {
        importedExpenses: plan.expenses.length,
        importedIncome: plan.income.length,
        skippedDuplicates: plan.skippedDuplicates,
        skippedNoCategory: plan.skippedNoCategory,
        invalidRows: plan.invalidRows,
        createdCategories: plan.categoriesToCreate.length,
        importedExpenseAmount: plan.expenses.reduce(
          (sum, row) => sum + row.amountMinor,
          0,
        ),
        importedIncomeAmount: plan.income.reduce(
          (sum, row) => sum + row.amountMinor,
          0,
        ),
      };

      if (nothingToWrite) {
        // Nothing will change — do not open a write transaction at all.
        return result;
      }

      try {
        await withTransaction(db.driver, async () => {
          // Fresh in-transaction read: category ids are resolved against
          // the data that is actually being written to, never against a
          // stale preview-time snapshot.
          const matcher = createCategoryMatcher(await db.categories.list());
          const now = Date.now();

          // 1) Create missing categories — INSIDE the transaction (§18).
          // Keyed by NORMALIZED name so case/spelling variants in the file
          // resolve to the ONE created category (never duplicates/orphans).
          const createdIds = new Map<string, number>();
          for (const name of plan.categoriesToCreate) {
            const existing = matcher.match(name);
            if (existing !== null) {
              // Appeared between preview and commit — reuse, never duplicate.
              createdIds.set(normalizedCategoryKey(name), existing);
              continue;
            }
            const inserted = await db.driver.query<{id: number}>(
              'INSERT INTO categories (name, icon, type, is_default, created_at) VALUES (?, ?, ?, 0, ?) RETURNING id',
              [name, IMPORTED_CATEGORY_ICON, 'expense', now],
            );
            const id = inserted[0]?.id;
            if (typeof id !== 'number') {
              throw new Error('Creating a category did not return an id');
            }
            createdIds.set(normalizedCategoryKey(name), id);
          }

          let insertedExpenses = 0;
          for (const row of plan.expenses) {
            const categoryId =
              row.categoryId ??
              createdIds.get(normalizedCategoryKey(row.categoryName));
            if (categoryId === undefined) {
              // Should be impossible (plan guarantees resolution); throw so
              // the transaction rolls back instead of writing anything.
              throw new Error(
                `Unresolved category "${row.categoryName}" during import`,
              );
            }
            const outcome = await db.driver.run(INSERT_EXPENSE, [
              row.amountMinor,
              row.title,
              categoryId,
              row.dateMs,
              row.paymentMethod,
              row.note,
              now,
              now,
            ]);
            insertedExpenses += outcome.rowsAffected;
          }

          let insertedIncome = 0;
          for (const row of plan.income) {
            const outcome = await db.driver.run(INSERT_INCOME, [
              row.amountMinor,
              row.source,
              row.dateMs,
              row.note,
              now,
              now,
            ]);
            insertedIncome += outcome.rowsAffected;
          }

          // 2) Final verification (§17): referential integrity + exact
          // counts. Any mismatch throws → ROLLBACK → zero partial state.
          const violations = await db.driver.query('PRAGMA foreign_key_check');
          if (violations.length > 0) {
            throw new Error('Foreign key integrity check failed');
          }
          if (
            insertedExpenses !== plan.expenses.length ||
            insertedIncome !== plan.income.length
          ) {
            throw new Error('Imported row count does not match the plan');
          }
        });
      } catch (error) {
        // The transaction already rolled back — the previous dataset is
        // intact. Surface a calm, generic message; never raw SQL errors.
        throw new ImportDatabaseError(
          'The import failed and nothing was changed. Your existing data is untouched.',
          {cause: error},
        );
      }

      return result;
    },
  };
}
