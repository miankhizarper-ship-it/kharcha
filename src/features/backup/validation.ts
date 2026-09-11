import {PAYMENT_METHODS, RECURRING_FREQUENCIES} from '@/database/models';
import {
  BackupFormatError,
  BackupParseError,
  BackupValidationError,
  BackupVersionError,
} from './errors';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_VERSION_V1,
  type BackupBudget,
  type BackupCategory,
  type BackupData,
  type BackupExpense,
  type BackupIncome,
  type BackupMonthlyBudget,
  type BackupRecurringRule,
  type BackupSetting,
  type BackupCounts,
  type ValidatedBackup,
} from './types';

/**
 * Parse + validate a backup JSON string BEFORE any database is touched.
 *
 * Every entity is checked against the same invariants the database enforces
 * (CHECK constraints, FK types, unique indexes) so a fully validated backup
 * cannot fail mid-restore: the restore transaction either completes or the
 * original data survives untouched. Fail-fast with a precise, user-readable
 * reason — corrupted backups are never silently accepted (spec §3).
 */

/** Field-length limits mirrored from the repositories / migration 001. */
const NAME_MAX = 100;
const ICON_MAX = 50;
const TITLE_MAX = 200;
const NOTE_MAX = 2000;
const SOURCE_MAX = 120;
const KEY_MAX = 100;
const VALUE_MAX = 10_000;

const MONTH_MIN = 1;
const MONTH_MAX = 12;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInt(
  value: unknown,
  where: string,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new BackupValidationError(
      `${where}.${field} must be a positive integer`,
    );
  }
  return value;
}

function requireTimestamp(
  value: unknown,
  where: string,
  field: string,
): number {
  return requirePositiveInt(value, where, field);
}

function requireString(
  value: unknown,
  where: string,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackupValidationError(
      `${where}.${field} must be a non-empty string`,
    );
  }
  if (value.length > maxLength) {
    throw new BackupValidationError(
      `${where}.${field} must be at most ${maxLength} characters`,
    );
  }
  return value;
}

function requireOptionalText(
  value: unknown,
  where: string,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BackupValidationError(
      `${where}.${field} must be a string or null`,
    );
  }
  if (value.length > maxLength) {
    throw new BackupValidationError(
      `${where}.${field} must be at most ${maxLength} characters`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, where: string, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BackupValidationError(`${where}.${field} must be a boolean`);
  }
  return value;
}

/** Null or a positive integer — the nullable recurring reference column. */
function requireOptionalId(
  value: unknown,
  where: string,
  field: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new BackupValidationError(
      `${where}.${field} must be null or a positive integer`,
    );
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  where: string,
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BackupValidationError(
      `${where}.${field} must be one of: ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

function requireArray(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BackupValidationError(`data.${key} must be an array`);
  }
  return value;
}

function requireUniqueIds(ids: number[], where: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new BackupValidationError(`${where} contains duplicate ids`);
  }
}

function validateCategory(raw: unknown, index: number): BackupCategory {
  const where = `categories[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }
  return {
    id: requirePositiveInt(raw.id, where, 'id'),
    name: requireString(raw.name, where, 'name', NAME_MAX),
    icon: requireString(raw.icon, where, 'icon', ICON_MAX),
    type: requireEnum(raw.type, ['expense', 'income'], where, 'type'),
    isDefault: requireBoolean(raw.isDefault, where, 'isDefault'),
    isActive: requireBoolean(raw.isActive, where, 'isActive'),
    createdAt: requireTimestamp(raw.createdAt, where, 'createdAt'),
  };
}

function validateExpense(raw: unknown, index: number): BackupExpense {
  const where = `expenses[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }
  return {
    id: requirePositiveInt(raw.id, where, 'id'),
    amount: requirePositiveInt(raw.amount, where, 'amount'),
    title: requireString(raw.title, where, 'title', TITLE_MAX),
    categoryId: requirePositiveInt(raw.categoryId, where, 'categoryId'),
    date: requireTimestamp(raw.date, where, 'date'),
    paymentMethod: requireEnum(
      raw.paymentMethod,
      PAYMENT_METHODS,
      where,
      'paymentMethod',
    ),
    note: requireOptionalText(raw.note, where, 'note', NOTE_MAX),
    createdAt: requireTimestamp(raw.createdAt, where, 'createdAt'),
    updatedAt: requireTimestamp(raw.updatedAt, where, 'updatedAt'),
    recurringRuleId: requireOptionalId(
      raw.recurringRuleId,
      where,
      'recurringRuleId',
    ),
  };
}

function validateIncome(raw: unknown, index: number): BackupIncome {
  const where = `income[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }
  return {
    id: requirePositiveInt(raw.id, where, 'id'),
    amount: requirePositiveInt(raw.amount, where, 'amount'),
    source: requireString(raw.source, where, 'source', SOURCE_MAX),
    date: requireTimestamp(raw.date, where, 'date'),
    note: requireOptionalText(raw.note, where, 'note', NOTE_MAX),
    createdAt: requireTimestamp(raw.createdAt, where, 'createdAt'),
    updatedAt: requireTimestamp(raw.updatedAt, where, 'updatedAt'),
    recurringRuleId: requireOptionalId(
      raw.recurringRuleId,
      where,
      'recurringRuleId',
    ),
  };
}

function validateBudget(raw: unknown, index: number): BackupBudget {
  const where = `budgets[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }
  const month = requirePositiveInt(raw.month, where, 'month');
  if (month < MONTH_MIN || month > MONTH_MAX) {
    throw new BackupValidationError(
      `${where}.month must be between ${MONTH_MIN} and ${MONTH_MAX}`,
    );
  }
  const year = requirePositiveInt(raw.year, where, 'year');
  if (year < YEAR_MIN || year > YEAR_MAX) {
    throw new BackupValidationError(
      `${where}.year must be between ${YEAR_MIN} and ${YEAR_MAX}`,
    );
  }
  return {
    id: requirePositiveInt(raw.id, where, 'id'),
    categoryId: requirePositiveInt(raw.categoryId, where, 'categoryId'),
    amount: requirePositiveInt(raw.amount, where, 'amount'),
    month,
    year,
    createdAt: requireTimestamp(raw.createdAt, where, 'createdAt'),
    updatedAt: requireTimestamp(raw.updatedAt, where, 'updatedAt'),
  };
}

function validateMonthlyBudget(
  raw: unknown,
  index: number,
): BackupMonthlyBudget {
  const where = `monthlyBudgets[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }
  const month = requirePositiveInt(raw.month, where, 'month');
  if (month < MONTH_MIN || month > MONTH_MAX) {
    throw new BackupValidationError(
      `${where}.month must be between ${MONTH_MIN} and ${MONTH_MAX}`,
    );
  }
  const year = requirePositiveInt(raw.year, where, 'year');
  if (year < YEAR_MIN || year > YEAR_MAX) {
    throw new BackupValidationError(
      `${where}.year must be between ${YEAR_MIN} and ${YEAR_MAX}`,
    );
  }
  return {
    id: requirePositiveInt(raw.id, where, 'id'),
    amount: requirePositiveInt(raw.amount, where, 'amount'),
    month,
    year,
    createdAt: requireTimestamp(raw.createdAt, where, 'createdAt'),
    updatedAt: requireTimestamp(raw.updatedAt, where, 'updatedAt'),
  };
}

function validateSetting(raw: unknown, index: number): BackupSetting {
  const where = `settings[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }
  return {
    key: requireString(raw.key, where, 'key', KEY_MAX),
    value: requireString(raw.value, where, 'value', VALUE_MAX),
  };
}

function validateRecurringRule(
  raw: unknown,
  index: number,
): BackupRecurringRule {
  const where = `recurringTransactions[${index}]`;
  if (!isRecord(raw)) {
    throw new BackupValidationError(`${where} must be an object`);
  }

  const type = requireEnum(raw.type, ['expense', 'income'], where, 'type');
  const amount = requirePositiveInt(raw.amount, where, 'amount');
  const title = requireString(raw.title, where, 'title', TITLE_MAX);
  const frequency = requireEnum(
    raw.frequency,
    RECURRING_FREQUENCIES,
    where,
    'frequency',
  );
  const startDate = requireTimestamp(raw.startDate, where, 'startDate');
  const nextOccurrenceAt = requireTimestamp(
    raw.nextOccurrenceAt,
    where,
    'nextOccurrenceAt',
  );
  const endDate = requireOptionalId(raw.endDate, where, 'endDate');
  const note = requireOptionalText(raw.note, where, 'note', NOTE_MAX);
  const isActive = requireBoolean(raw.isActive, where, 'isActive');
  const createdAt = requireTimestamp(raw.createdAt, where, 'createdAt');
  const updatedAt = requireTimestamp(raw.updatedAt, where, 'updatedAt');

  // Mirrors migration 004's type/field CHECK constraints.
  let categoryId: number | null = null;
  let paymentMethod: BackupRecurringRule['paymentMethod'] = null;
  if (type === 'expense') {
    categoryId = requirePositiveInt(raw.categoryId, where, 'categoryId');
    paymentMethod = requireEnum(
      raw.paymentMethod,
      PAYMENT_METHODS,
      where,
      'paymentMethod',
    );
  } else {
    if (raw.categoryId !== null && raw.categoryId !== undefined) {
      throw new BackupValidationError(
        `${where}.categoryId must be null for income rules`,
      );
    }
    if (raw.paymentMethod !== null && raw.paymentMethod !== undefined) {
      throw new BackupValidationError(
        `${where}.paymentMethod must be null for income rules`,
      );
    }
  }

  if (endDate !== null && endDate < startDate) {
    throw new BackupValidationError(
      `${where}.endDate must be on or after startDate`,
    );
  }

  return {
    id: requirePositiveInt(raw.id, where, 'id'),
    type,
    amount,
    title,
    categoryId,
    frequency,
    startDate,
    nextOccurrenceAt,
    endDate,
    paymentMethod,
    note,
    isActive,
    createdAt,
    updatedAt,
  };
}

/**
 * Checks the relationships SQLite cannot see in the JSON itself:
 * - every expense/budget categoryId must reference a category INSIDE the
 *   backup of the matching type (expense records -> expense categories);
 * - every recurring rule's categoryId likewise (expense rules -> expense
 *   categories);
 * - every transaction's recurringRuleId must reference a rule INSIDE the
 *   backup of the matching type;
 * - duplicate ids / keys that mirror the database's UNIQUE indexes are
 *   rejected — a duplicate would abort the restore halfway through.
 */
function validateRelationships(data: BackupData): void {
  const byId = new Map(
    data.categories.map(category => [category.id, category]),
  );

  for (const [index, expense] of data.expenses.entries()) {
    const category = byId.get(expense.categoryId);
    if (!category) {
      throw new BackupValidationError(
        `expenses[${index}].categoryId ${expense.categoryId} does not exist in the backup categories`,
      );
    }
    if (category.type !== 'expense') {
      throw new BackupValidationError(
        `expenses[${index}].categoryId ${expense.categoryId} is not an expense category`,
      );
    }
  }

  for (const [index, budget] of data.budgets.entries()) {
    const category = byId.get(budget.categoryId);
    if (!category) {
      throw new BackupValidationError(
        `budgets[${index}].categoryId ${budget.categoryId} does not exist in the backup categories`,
      );
    }
    if (category.type !== 'expense') {
      throw new BackupValidationError(
        `budgets[${index}].categoryId ${budget.categoryId} is not an expense category`,
      );
    }
  }

  // Recurring rules: expense rules must point at expense categories.
  const ruleById = new Map(
    data.recurringTransactions.map(rule => [rule.id, rule]),
  );
  for (const [index, rule] of data.recurringTransactions.entries()) {
    if (rule.type !== 'expense') {
      continue;
    }
    const category =
      rule.categoryId === null ? undefined : byId.get(rule.categoryId);
    if (!category) {
      throw new BackupValidationError(
        `recurringTransactions[${index}].categoryId ${rule.categoryId} does not exist in the backup categories`,
      );
    }
    if (category.type !== 'expense') {
      throw new BackupValidationError(
        `recurringTransactions[${index}].categoryId ${rule.categoryId} is not an expense category`,
      );
    }
  }

  // Generated transactions must reference a rule of the matching type.
  for (const [index, expense] of data.expenses.entries()) {
    if (expense.recurringRuleId === null) {
      continue;
    }
    const rule = ruleById.get(expense.recurringRuleId);
    if (!rule) {
      throw new BackupValidationError(
        `expenses[${index}].recurringRuleId ${expense.recurringRuleId} does not exist in the backup recurringTransactions`,
      );
    }
    if (rule.type !== 'expense') {
      throw new BackupValidationError(
        `expenses[${index}].recurringRuleId ${expense.recurringRuleId} is not an expense rule`,
      );
    }
  }
  for (const [index, income] of data.income.entries()) {
    if (income.recurringRuleId === null) {
      continue;
    }
    const rule = ruleById.get(income.recurringRuleId);
    if (!rule) {
      throw new BackupValidationError(
        `income[${index}].recurringRuleId ${income.recurringRuleId} does not exist in the backup recurringTransactions`,
      );
    }
    if (rule.type !== 'income') {
      throw new BackupValidationError(
        `income[${index}].recurringRuleId ${income.recurringRuleId} is not an income rule`,
      );
    }
  }

  const nameType = new Set(
    data.categories.map(category => `${category.type}\u0000${category.name}`),
  );
  if (nameType.size !== data.categories.length) {
    throw new BackupValidationError(
      'categories contains duplicate name/type pairs',
    );
  }

  // Unique-index mirrors: a duplicate here would abort the restore halfway
  // through its transaction, so it is rejected before the database opens.
  const settingKeys = data.settings.map(setting => setting.key);
  if (new Set(settingKeys).size !== settingKeys.length) {
    throw new BackupValidationError('settings contains duplicate keys');
  }

  const budgetPeriods = data.budgets.map(
    budget => `${budget.categoryId}\u0000${budget.year}\u0000${budget.month}`,
  );
  if (new Set(budgetPeriods).size !== budgetPeriods.length) {
    throw new BackupValidationError(
      'budgets contains duplicate category/month/year rows',
    );
  }

  const monthlyPeriods = data.monthlyBudgets.map(
    budget => `${budget.year}\u0000${budget.month}`,
  );
  if (new Set(monthlyPeriods).size !== monthlyPeriods.length) {
    throw new BackupValidationError(
      'monthlyBudgets contains duplicate month/year rows',
    );
  }

  // Mirrors the partial UNIQUE indexes on (recurring_rule_id, date).
  const expenseOccurrences = data.expenses
    .filter(expense => expense.recurringRuleId !== null)
    .map(expense => `${expense.recurringRuleId}\u0000${expense.date}`);
  if (new Set(expenseOccurrences).size !== expenseOccurrences.length) {
    throw new BackupValidationError(
      'expenses contains duplicate recurring rule/occurrence date rows',
    );
  }
  const incomeOccurrences = data.income
    .filter(income => income.recurringRuleId !== null)
    .map(income => `${income.recurringRuleId}\u0000${income.date}`);
  if (new Set(incomeOccurrences).size !== incomeOccurrences.length) {
    throw new BackupValidationError(
      'income contains duplicate recurring rule/occurrence date rows',
    );
  }
}

function countBackup(data: BackupData): BackupCounts {
  return {
    categories: data.categories.length,
    expenses: data.expenses.length,
    income: data.income.length,
    budgets: data.budgets.length,
    monthlyBudgets: data.monthlyBudgets.length,
    recurringTransactions: data.recurringTransactions.length,
    settings: data.settings.length,
  };
}

/**
 * Validates an already-parsed backup OBJECT. Exported for tests and reused
 * by `parseBackup` after JSON decoding.
 */
export function validateBackupObject(raw: unknown): ValidatedBackup {
  if (!isRecord(raw)) {
    throw new BackupValidationError('backup must be a JSON object');
  }
  if (raw.format !== BACKUP_FORMAT) {
    throw new BackupFormatError();
  }
  if (raw.version !== BACKUP_VERSION) {
    // Future versions route through a migrator before reaching this check.
    throw new BackupVersionError(raw.version);
  }
  if (typeof raw.createdAt !== 'string' || raw.createdAt.length === 0) {
    throw new BackupValidationError('createdAt must be a non-empty string');
  }
  if (
    typeof raw.appVersion !== 'string' ||
    raw.appVersion.length === 0 ||
    raw.appVersion.length > 100
  ) {
    throw new BackupValidationError('appVersion must be a non-empty string');
  }
  if (typeof raw.currency !== 'string' || raw.currency.length > 10) {
    throw new BackupValidationError('currency must be a short string');
  }
  if (!isRecord(raw.data)) {
    throw new BackupValidationError('data must be an object');
  }

  const data: BackupData = {
    categories: requireArray(raw.data.categories, 'categories').map(
      validateCategory,
    ),
    expenses: requireArray(raw.data.expenses, 'expenses').map(validateExpense),
    income: requireArray(raw.data.income, 'income').map(validateIncome),
    budgets: requireArray(raw.data.budgets, 'budgets').map(validateBudget),
    monthlyBudgets: requireArray(raw.data.monthlyBudgets, 'monthlyBudgets').map(
      validateMonthlyBudget,
    ),
    recurringTransactions: requireArray(
      raw.data.recurringTransactions,
      'recurringTransactions',
    ).map(validateRecurringRule),
    settings: requireArray(raw.data.settings, 'settings').map(validateSetting),
  };

  requireUniqueIds(
    data.categories.map(category => category.id),
    'categories',
  );
  requireUniqueIds(
    data.expenses.map(expense => expense.id),
    'expenses',
  );
  requireUniqueIds(
    data.income.map(record => record.id),
    'income',
  );
  requireUniqueIds(
    data.budgets.map(budget => budget.id),
    'budgets',
  );
  requireUniqueIds(
    data.monthlyBudgets.map(budget => budget.id),
    'monthlyBudgets',
  );
  requireUniqueIds(
    data.recurringTransactions.map(rule => rule.id),
    'recurringTransactions',
  );
  validateRelationships(data);

  return {
    meta: {
      createdAt: raw.createdAt,
      appVersion: raw.appVersion,
    },
    data,
    counts: countBackup(data),
  };
}

/**
 * v1 → v2 migration (spec §24).
 *
 * v1 files predate recurring transactions: the upgrade adds an EMPTY
 * `recurringTransactions` list and `recurringRuleId: null` on every
 * transaction. The MEANING of every v1 record is unchanged — old backups
 * restore exactly as they always did, just without rules. Anything else a
 * v1 file got wrong surfaces as a precise v2 validation error afterwards.
 */
function migrateV1ToV2(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const data = isRecord(parsed.data) ? parsed.data : {};
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const income = Array.isArray(data.income) ? data.income : [];

  return {
    ...parsed,
    version: BACKUP_VERSION,
    data: {
      ...data,
      expenses: expenses.map(expense =>
        isRecord(expense) ? {...expense, recurringRuleId: null} : expense,
      ),
      income: income.map(income =>
        isRecord(income) ? {...income, recurringRuleId: null} : income,
      ),
      recurringTransactions: [],
    },
  };
}

/**
 * Version-migration step: routes older backups to the current format
 * before validation (spec §17 — the hook exists so future versions can
 * chain stepwise migrations v1 -> v2 -> ... without breaking old files).
 */
function migrateBackupToCurrentVersion(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }
  if (parsed.version === BACKUP_VERSION_V1) {
    return migrateV1ToV2(parsed);
  }
  return parsed;
}

/** Parses a backup JSON string and fully validates it. */
export function parseBackup(json: string): ValidatedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new BackupParseError({cause: error});
  }
  return validateBackupObject(migrateBackupToCurrentVersion(parsed));
}
