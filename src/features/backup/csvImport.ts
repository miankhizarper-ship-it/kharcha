import {PAYMENT_METHODS, type PaymentMethod} from '@/database/models';
import type {DatabaseService} from '@/database/service';
import {atNoon} from '@/utils/date';
import {parseAmountToMinor} from '@/utils/money';
import {InvalidCsvError} from './errors';
import {CSV_COLUMNS, formatDateColumn} from './csv';
import {parseCsv} from './csvParse';

/**
 * CSV import (Phase 10) — parse → validate → resolve → preview, all BEFORE
 * any database write. This module owns the pure logic:
 *
 * - header recognition (canonical 11-column format incl. `Recurring`, plus
 *   the pre-Phase-10 legacy 10-column format; unknown columns are REJECTED
 *   with a clear error, never silently accepted — spec §9);
 * - per-row validation with row-level errors (one malformed row never
 *   crashes the import — spec §11);
 * - safe category matching: exact name, then normalized (trim + collapsed
 *   whitespace + case-insensitive). No icon matching, no similarity
 *   guessing (spec §13);
 * - deterministic duplicate fingerprints over stable business fields
 *   (spec §15) — conservative by construction: more distinguishing fields
 *   means fewer false positives, and false positives are the dangerous
 *   direction.
 *
 * The atomic write itself lives in `csvImportService.ts`.
 */

/* --------------------------------- headers -------------------------------- */

/** Column indexes for a recognized header. */
export type CsvColumnIndex = Record<(typeof CSV_COLUMNS)[number], number>;

export interface RecognizedCsvHeader {
  /** `legacy` = pre-Phase-10 export without the Recurring column. */
  kind: 'canonical' | 'legacy';
  index: CsvColumnIndex;
}

const LEGACY_COLUMNS = CSV_COLUMNS.filter(name => name !== 'Recurring');

function sameColumn(actual: string, expected: string): boolean {
  return actual.trim().toLowerCase() === expected.toLowerCase();
}

/**
 * Recognizes the Kharcha CSV header. Case/whitespace-insensitive on each
 * column name; accepts the canonical 11-column format or the legacy
 * 10-column one. Anything else — missing required columns, unknown extra
 * columns — is a typed error (spec §9: unknown columns are only ignored
 * when documented; here they are not ignored at all).
 */
export function recognizeCsvHeader(headerRow: string[]): RecognizedCsvHeader {
  const header = headerRow.map(name => name.trim());
  const isCanonical =
    header.length === CSV_COLUMNS.length &&
    CSV_COLUMNS.every((name, position) => sameColumn(header[position], name));
  const isLegacy =
    header.length === LEGACY_COLUMNS.length &&
    LEGACY_COLUMNS.every((name, position) =>
      sameColumn(header[position], name),
    );

  if (!isCanonical && !isLegacy) {
    const unknown = header.filter(
      name =>
        !CSV_COLUMNS.some(expected => sameColumn(name, expected)) &&
        name.length > 0,
    );
    throw new InvalidCsvError(
      unknown.length > 0
        ? `This file has column(s) Kharcha does not import: ${unknown
            .slice(0, 3)
            .join(
              ', ',
            )}${unknown.length > 3 ? '…' : ''}. Export a fresh CSV from Kharcha and try again.`
        : 'This file is missing required Kharcha columns. Export a fresh CSV from Kharcha and try again.',
    );
  }

  const names = isCanonical ? CSV_COLUMNS : LEGACY_COLUMNS;
  const index = {} as CsvColumnIndex;
  names.forEach((name, position) => {
    index[name] = position;
  });
  // The legacy format simply has no Recurring column; point it at a
  // position that always reads as empty (columns beyond the row end are
  // '' by contract of `cellAt`).
  if (isLegacy) {
    index.Recurring = -1;
  }
  return {kind: isCanonical ? 'canonical' : 'legacy', index};
}

/* --------------------------------- rows ----------------------------------- */

/** A problem with one CSV row, shown verbatim in the preview. */
export interface CsvImportRowError {
  /** 1-based DATA row number (the header is not counted). */
  row: number;
  message: string;
}

/** One expense row that passed validation (nothing written yet). */
export interface CsvImportExpenseRow {
  kind: 'expense';
  row: number;
  /** Record date at local noon (app convention) — already calendar-valid. */
  dateMs: number;
  /** "YYYY-MM-DD" as written in the file. */
  dateLabel: string;
  amountMinor: number;
  title: string;
  /** Raw category text from the file (kept for creation + display). */
  categoryName: string;
  /** Resolved category id; null while the category is missing locally. */
  categoryId: number | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  /** Informational provenance only — never rehydrated into a rule. */
  recurring: boolean;
  /**
   * Creation timestamp from the file (Kharcha exports copy it verbatim);
   * null when absent/unparseable. NOT written to the database — imported
   * rows are new records — it only sharpens duplicate fingerprints.
   */
  createdAtMs: number | null;
  /** True when the fingerprint matches an existing transaction. */
  duplicate: boolean;
}

/** One income row that passed validation (nothing written yet). */
export interface CsvImportIncomeRow {
  kind: 'income';
  row: number;
  dateMs: number;
  dateLabel: string;
  amountMinor: number;
  source: string;
  note: string | null;
  recurring: boolean;
  /** See `CsvImportExpenseRow.createdAtMs`. */
  createdAtMs: number | null;
  /** True when the fingerprint matches an existing transaction. */
  duplicate: boolean;
}

export type CsvImportRow = CsvImportExpenseRow | CsvImportIncomeRow;

/** A valid row that matches an existing transaction by fingerprint. */
export interface CsvDuplicateCandidate {
  row: number;
  kind: 'expense' | 'income';
  /** Title (expense) or source (income). */
  label: string;
  amountMinor: number;
  dateLabel: string;
}

/** Everything the preview screen shows (spec §12). */
export interface CsvImportPreview {
  headerKind: 'canonical' | 'legacy';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  expenseCount: number;
  incomeCount: number;
  /** Minor units. */
  totalExpenseAmount: number;
  /** Minor units. */
  totalIncomeAmount: number;
  /** Valid rows matching existing transactions (fingerprint match). */
  duplicateCount: number;
  duplicates: CsvDuplicateCandidate[];
  /** Distinct category names that do not exist locally, first-seen order. */
  missingCategories: string[];
  /** Every row-level problem (screens cap how many are rendered). */
  errors: CsvImportRowError[];
  rows: CsvImportRow[];
}

/* ------------------------------ field limits ------------------------------ */

/** Mirrors the repository/migration limits so validated rows cannot violate them. */
const TITLE_MAX = 200;
const NOTE_MAX = 2000;
const SOURCE_MAX = 120;

/**
 * Default payment method for expense rows that omit the column — same
 * default the Add Expense form uses. A SUPPLIED but invalid value is an
 * error (spec §11); absence falls back to the form default.
 */
const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'cash';

/* ------------------------------ normalization ----------------------------- */

/** Trim + collapse internal whitespace runs. Case is preserved. */
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Normalized category key: trim + collapsed whitespace + case-insensitive.
 * Used for the normalized-match step only — exact matches win first. Also
 * keys the executor's created-category map and the missing-category dedupe,
 * so "Utilities" / "utilities " resolve to ONE created category.
 */
export function normalizedCategoryKey(name: string): string {
  return normalizeText(name).toLowerCase();
}

/**
 * Strict local calendar date parser: "YYYY-MM-DD" only, then verified
 * against the real calendar (rejects 2026-99-44, Feb 30, non-leap Feb 29).
 * Returns the record date at LOCAL NOON — the app's DST-safe storage
 * convention — so imported days line up with every existing day/bucket
 * query. No UTC arithmetic anywhere (spec §21).
 */
export function parseCsvDate(raw: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const ms = atNoon(year, month - 1, day);
  const check = new Date(ms);
  return check.getFullYear() === year &&
    check.getMonth() === month - 1 &&
    check.getDate() === day
    ? ms
    : null;
}

/** Lenient provenance reader — `Yes/true/1` (any case) means recurring. */
function parseRecurringIndicator(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === 'yes' || value === 'true' || value === '1';
}

/* ----------------------------- fingerprints ------------------------------- */

/**
 * Deterministic duplicate fingerprint (spec §15) over the stable business
 * fields: type | local date | amount (minor units) | title/source |
 * category | payment method | note | creation timestamp.
 *
 * Rules (documented contract):
 * - Text is normalized (trim + collapsed whitespace) but case-sensitive —
 *   stricter matching means fewer false positives, which is the safe
 *   direction for financial data (spec §15).
 * - `createdAt` participates — beyond the spec's example field list —
 *   because it is the ONLY field that distinguishes two same-day identical
 *   purchases (the classic false-positive trap), and it survives every
 *   legitimate round trip (Kharcha exports and JSON restores copy it
 *   verbatim). Hand-made files without it fingerprint as '' there and
 *   simply never match timestamped records — the conservative direction
 *   (never skip a real record).
 * - Matching is COUNT-BASED: duplicates = the first min(csvCount,
 *   dbCount) rows per fingerprint; extras import as new.
 * - The Recurring indicator does NOT participate: it is provenance, not
 *   business data, and legacy files do not carry it.
 */
export function transactionFingerprint(parts: {
  type: 'expense' | 'income';
  dateMs: number;
  amountMinor: number;
  titleOrSource: string;
  /** Resolved category id (expenses) as a string; '' when unresolved. */
  categoryKey: string;
  paymentMethod: string;
  note: string | null;
  createdAtMs: number | null;
}): string {
  return [
    parts.type,
    formatDateColumn(parts.dateMs),
    String(parts.amountMinor),
    normalizeText(parts.titleOrSource),
    parts.categoryKey,
    parts.paymentMethod,
    normalizeText(parts.note ?? ''),
    parts.createdAtMs === null ? '' : new Date(parts.createdAtMs).toISOString(),
  ].join('|');
}

/** Fingerprint of an existing DB expense row (minimal columns). */
function expenseFingerprint(row: {
  amount: number;
  title: string;
  categoryId: number;
  date: number;
  paymentMethod: string;
  note: string | null;
  createdAt: number;
}): string {
  return transactionFingerprint({
    type: 'expense',
    dateMs: row.date,
    amountMinor: row.amount,
    titleOrSource: row.title,
    categoryKey: String(row.categoryId),
    paymentMethod: row.paymentMethod,
    note: row.note,
    createdAtMs: row.createdAt,
  });
}

/** Fingerprint of an existing DB income row (minimal columns). */
function incomeFingerprint(row: {
  amount: number;
  source: string;
  date: number;
  note: string | null;
  createdAt: number;
}): string {
  return transactionFingerprint({
    type: 'income',
    dateMs: row.date,
    amountMinor: row.amount,
    titleOrSource: row.source,
    categoryKey: '',
    paymentMethod: '',
    note: row.note,
    createdAtMs: row.createdAt,
  });
}

function fingerprintOfRow(row: CsvImportRow): string {
  const categoryKey =
    row.kind === 'expense'
      ? row.categoryId !== null
        ? String(row.categoryId)
        : `missing:${normalizedCategoryKey(row.categoryName)}`
      : '';
  return transactionFingerprint({
    type: row.kind,
    dateMs: row.dateMs,
    amountMinor: row.amountMinor,
    titleOrSource: row.kind === 'expense' ? row.title : row.source,
    categoryKey,
    paymentMethod: row.kind === 'expense' ? row.paymentMethod : '',
    note: row.note,
    createdAtMs: row.createdAtMs,
  });
}

/* --------------------------- category resolution -------------------------- */

/**
 * Category lookup built from ONE `categories.list()` read. Exact match
 * first, then the normalized key; normalized collisions resolve to the
 * lowest id (deterministic). Both maps include ARCHIVED categories —
 * historical rows belong to them and must stay resolvable. Only EXPENSE
 * categories are matchable (income has no category FK by design); a name
 * that exists exclusively as an income category is reported by
 * `matchesOtherType` so validation can reject the impossible relationship
 * instead of treating it as a creatable "missing" category (spec §11/§13).
 */
export interface CategoryMatcher {
  match(name: string): number | null;
  /** The name exists (exact or normalized) as a non-expense category. */
  matchesOtherType(name: string): boolean;
}

export function createCategoryMatcher(
  categories: {id: number; name: string; type: string}[],
): CategoryMatcher {
  const exact = new Map<string, number>();
  const normalized = new Map<string, number>();
  const otherExact = new Set<string>();
  const otherNormalized = new Set<string>();
  for (const category of categories) {
    if (category.type !== 'expense') {
      otherExact.add(category.name);
      otherNormalized.add(normalizedCategoryKey(category.name));
      continue;
    }
    if (!exact.has(category.name)) {
      exact.set(category.name, category.id);
    }
    const key = normalizedCategoryKey(category.name);
    const existing = normalized.get(key);
    if (existing === undefined || category.id < existing) {
      normalized.set(key, category.id);
    }
  }
  return {
    match(name: string): number | null {
      const raw = name.trim();
      const byExact = exact.get(raw);
      if (byExact !== undefined) {
        return byExact;
      }
      return normalized.get(normalizedCategoryKey(raw)) ?? null;
    },
    matchesOtherType(name: string): boolean {
      const raw = name.trim();
      return (
        otherExact.has(raw) || otherNormalized.has(normalizedCategoryKey(raw))
      );
    },
  };
}

/* ------------------------------- validation ------------------------------- */

function cellAt(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index] : '';
}

function invalidAmountMessage(raw: string): string {
  return raw.trim().length === 0
    ? 'Missing amount'
    : `Invalid amount "${raw.trim()}"`;
}

/**
 * Validates parsed rows against a recognized header + category matcher.
 * Every row produces either a valid row or a row-level error — never a
 * crash (spec §11). Rows referencing unknown categories stay VALID with
 * `categoryId: null`; what happens to them is an explicit user choice
 * (create / skip — spec §13), reported via `missingCategories`.
 */
export function validateCsvRows(
  header: RecognizedCsvHeader,
  dataRows: string[][],
  matcher: CategoryMatcher,
): {rows: CsvImportRow[]; errors: CsvImportRowError[]} {
  const rows: CsvImportRow[] = [];
  const errors: CsvImportRowError[] = [];
  const columnIndex = header.index;

  dataRows.forEach((fields, position) => {
    const rowNumber = position + 1;
    const fail = (message: string) => {
      errors.push({row: rowNumber, message});
    };

    const type = normalizeText(cellAt(fields, columnIndex.Type));
    if (type.length === 0) {
      fail('Missing transaction type');
      return;
    }
    const kind = type.toLowerCase();
    if (kind !== 'expense' && kind !== 'income') {
      fail(`Unknown transaction type "${type}"`);
      return;
    }

    const dateLabel = cellAt(fields, columnIndex.Date).trim();
    if (dateLabel.length === 0) {
      fail('Missing date');
      return;
    }
    const dateMs = parseCsvDate(dateLabel);
    if (dateMs === null) {
      fail(`Invalid date "${dateLabel}"`);
      return;
    }

    const amountRaw = cellAt(fields, columnIndex.Amount).trim();
    const amountMinor = parseAmountToMinor(amountRaw);
    if (amountMinor === null) {
      fail(invalidAmountMessage(amountRaw));
      return;
    }
    if (amountMinor <= 0) {
      fail('Amount must be greater than zero');
      return;
    }

    const noteRaw = cellAt(fields, columnIndex.Note);
    if (noteRaw.length > NOTE_MAX) {
      fail(`Note is longer than ${NOTE_MAX} characters`);
      return;
    }

    const recurring = parseRecurringIndicator(
      cellAt(fields, columnIndex.Recurring),
    );

    // Created At sharpens duplicate fingerprints (Kharcha exports copy it
    // verbatim; hand-made rows without it simply fingerprint as "no
    // timestamp"). Lenient parse — an unparseable value is treated as
    // absent, never a row error (the column is metadata, not data).
    const createdAtRaw = cellAt(fields, columnIndex['Created At']).trim();
    const parsedCreated = Date.parse(createdAtRaw);
    const createdAtMs =
      createdAtRaw.length > 0 && !Number.isNaN(parsedCreated)
        ? parsedCreated
        : null;

    if (kind === 'income') {
      const source = normalizeText(cellAt(fields, columnIndex.Source));
      if (source.length === 0) {
        fail('Missing income source');
        return;
      }
      if (source.length > SOURCE_MAX) {
        fail(`Income source is longer than ${SOURCE_MAX} characters`);
        return;
      }
      rows.push({
        kind: 'income',
        row: rowNumber,
        dateMs,
        dateLabel,
        amountMinor,
        source,
        note: noteRaw.length === 0 ? null : noteRaw,
        recurring,
        createdAtMs,
        duplicate: false,
      });
      return;
    }

    // ---- expense rows ----
    const title = normalizeText(cellAt(fields, columnIndex.Title));
    if (title.length === 0) {
      fail('Missing title');
      return;
    }
    if (title.length > TITLE_MAX) {
      fail(`Title is longer than ${TITLE_MAX} characters`);
      return;
    }

    const categoryRaw = normalizeText(cellAt(fields, columnIndex.Category));
    if (categoryRaw.length === 0) {
      // The data model has NO category-less expenses (NOT NULL FK), so an
      // empty category cannot be imported as-is — it is an error the user
      // resolves by fixing the file (spec §13's "import without category"
      // does not exist for expenses).
      fail('Missing category');
      return;
    }
    const categoryId = matcher.match(categoryRaw);
    if (categoryId === null && matcher.matchesOtherType(categoryRaw)) {
      // The name exists ONLY as an income category — writing an expense
      // against it would violate the FK type contract (spec §11).
      fail(
        `Category "${categoryRaw}" is an income category, not an expense category`,
      );
      return;
    }
    // categoryId === null otherwise: kept VALID — resolution is the
    // user's explicit choice (create / skip, spec §13), surfaced via
    // `missingCategories` in the preview.

    const paymentRaw = normalizeText(
      cellAt(fields, columnIndex['Payment Method']),
    );
    let paymentMethod = DEFAULT_PAYMENT_METHOD;
    if (paymentRaw.length > 0) {
      const candidate = paymentRaw.toLowerCase();
      if (!(PAYMENT_METHODS as readonly string[]).includes(candidate)) {
        fail(
          `Invalid payment method "${paymentRaw}" (use one of: ${PAYMENT_METHODS.join(', ')})`,
        );
        return;
      }
      paymentMethod = candidate as PaymentMethod;
    }

    rows.push({
      kind: 'expense',
      row: rowNumber,
      dateMs,
      dateLabel,
      amountMinor,
      title,
      categoryName: categoryRaw,
      categoryId,
      paymentMethod,
      note: noteRaw.length === 0 ? null : noteRaw,
      recurring,
      createdAtMs,
      duplicate: false,
    });
  });

  return {rows, errors};
}

/* -------------------------------- preview --------------------------------- */

/**
 * Loads every existing transaction fingerprint in TWO batched queries.
 * Returns a COUNT per fingerprint — count-based matching lets a CSV with
 * two identical rows import one and skip one when the database holds only
 * a single original (a Set would wrongly flag both).
 */
async function loadExistingFingerprints(
  db: DatabaseService,
): Promise<Map<string, number>> {
  const [expenses, income] = await Promise.all([
    db.driver.query<{
      amount: number;
      title: string;
      categoryId: number;
      date: number;
      paymentMethod: string;
      note: string | null;
      createdAt: number;
    }>(
      'SELECT amount, title, category_id AS categoryId, date, payment_method AS paymentMethod, note, created_at AS createdAt FROM expenses',
    ),
    db.driver.query<{
      amount: number;
      source: string;
      date: number;
      note: string | null;
      createdAt: number;
    }>(
      'SELECT amount, source, date, note, created_at AS createdAt FROM income',
    ),
  ]);

  const fingerprints = new Map<string, number>();
  const bump = (fingerprint: string) => {
    fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);
  };
  for (const row of expenses) {
    bump(expenseFingerprint(row));
  }
  for (const row of income) {
    bump(incomeFingerprint(row));
  }
  return fingerprints;
}

/**
 * Full read-only import preparation: parse → recognize header → validate →
 * resolve categories → flag duplicates. NEVER writes (spec §8) and never
 * queries per row (two batched fingerprint queries + one categories read).
 */
export async function prepareCsvImport(
  db: DatabaseService,
  csvText: string,
): Promise<CsvImportPreview> {
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) {
    throw new InvalidCsvError('The file is empty.');
  }
  const header = recognizeCsvHeader(parsed[0]);
  const dataRows = parsed.slice(1);

  const [matcher, existingFingerprints] = await Promise.all([
    db.categories.list().then(categories => createCategoryMatcher(categories)),
    loadExistingFingerprints(db),
  ]);

  const {rows, errors} = validateCsvRows(header, dataRows, matcher);

  const duplicates: CsvDuplicateCandidate[] = [];
  const csvCounts = new Map<string, number>();
  let duplicateCount = 0;
  for (const row of rows) {
    const fingerprint = fingerprintOfRow(row);
    const seenInFile = csvCounts.get(fingerprint) ?? 0;
    csvCounts.set(fingerprint, seenInFile + 1);
    // Count-based rule (deterministic by file order): the first
    // `existingCount` CSV rows sharing a fingerprint are duplicates;
    // any extras are new records the database does not have yet.
    row.duplicate = seenInFile < (existingFingerprints.get(fingerprint) ?? 0);
    if (row.duplicate) {
      duplicateCount += 1;
      if (duplicates.length < 50) {
        duplicates.push({
          row: row.row,
          kind: row.kind,
          label: row.kind === 'expense' ? row.title : row.source,
          amountMinor: row.amountMinor,
          dateLabel: row.dateLabel,
        });
      }
    }
  }

  const missingCategories: string[] = [];
  const seenMissing = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'expense' && row.categoryId === null) {
      // Dedupe by NORMALIZED key: two spellings of the same name resolve to
      // one created category (first-seen spelling is the display name).
      const key = normalizedCategoryKey(row.categoryName);
      if (!seenMissing.has(key)) {
        seenMissing.add(key);
        missingCategories.push(row.categoryName);
      }
    }
  }

  const expenses = rows.filter(row => row.kind === 'expense');
  const income = rows.filter(row => row.kind === 'income');

  return {
    headerKind: header.kind,
    totalRows: dataRows.length,
    validRows: rows.length,
    invalidRows: errors.length,
    expenseCount: expenses.length,
    incomeCount: income.length,
    totalExpenseAmount: expenses.reduce((sum, row) => sum + row.amountMinor, 0),
    totalIncomeAmount: income.reduce((sum, row) => sum + row.amountMinor, 0),
    duplicateCount,
    duplicates,
    missingCategories,
    errors,
    rows,
  };
}

/* ------------------------------- import plan ------------------------------ */

export interface CsvImportOptions {
  /**
   * `skipDuplicates` (default, recommended): fingerprint matches are not
   * imported. `importAll`: the user explicitly accepts adding them again.
   * Never anything destructive — import only ever ADDS rows (spec §14).
   */
  mode: 'skipDuplicates' | 'importAll';
  /** Create the missing categories listed in the preview (spec §13). */
  createMissingCategories: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: CsvImportOptions = {
  mode: 'skipDuplicates',
  createMissingCategories: true,
};

/** The exact write set for one atomic import run. */
export interface CsvImportPlan {
  expenses: CsvImportExpenseRow[];
  income: CsvImportIncomeRow[];
  skippedDuplicates: number;
  /** Valid rows dropped because their category stays unresolved. */
  skippedNoCategory: number;
  /** Distinct category names that will be CREATED inside the transaction. */
  categoriesToCreate: string[];
  invalidRows: number;
}

/**
 * Applies the user's choices to a preview: which rows will be written,
 * which are skipped as duplicates, which are dropped for unresolved
 * categories, and which categories will be created. Pure selection — no
 * database access, so the confirmation dialog can show exact numbers
 * before anything is touched (spec §25).
 */
export function buildImportPlan(
  preview: CsvImportPreview,
  options: CsvImportOptions,
): CsvImportPlan {
  const expenses: CsvImportExpenseRow[] = [];
  const income: CsvImportIncomeRow[] = [];
  let skippedDuplicates = 0;
  let skippedNoCategory = 0;
  const categoriesToCreate = options.createMissingCategories
    ? [...preview.missingCategories]
    : [];

  for (const row of preview.rows) {
    if (options.mode === 'skipDuplicates' && row.duplicate) {
      skippedDuplicates += 1;
      continue;
    }
    if (row.kind === 'expense' && row.categoryId === null) {
      if (!options.createMissingCategories) {
        skippedNoCategory += 1;
        continue;
      }
    }
    if (row.kind === 'expense') {
      expenses.push(row);
    } else {
      income.push(row);
    }
  }

  return {
    expenses,
    income,
    skippedDuplicates,
    skippedNoCategory,
    categoriesToCreate,
    invalidRows: preview.invalidRows,
  };
}
