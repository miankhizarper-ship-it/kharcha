/**
 * Typed errors for the backup feature plus user-facing descriptions.
 *
 * Raw SQLite/JSON/file errors are NEVER shown to the user (spec §21): the
 * `describe*` helpers translate them into short, actionable sentences while
 * the original error stays attached as `cause` for diagnostics.
 */

/** Base class — lets callers catch every backup error with one type. */
export class BackupError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'BackupError';
  }
}

/** The selected file could not be read, or the export file could not be written. */
export class BackupFileError extends BackupError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'BackupFileError';
  }
}

/** The file contents are not valid JSON. */
export class BackupParseError extends BackupError {
  constructor(options?: {cause?: unknown}) {
    super('The backup file does not contain valid JSON.', options);
    this.name = 'BackupParseError';
  }
}

/** Missing or wrong format identifier — not a Kharcha backup. */
export class BackupFormatError extends BackupError {
  constructor() {
    super('This file is not a Kharcha backup.');
    this.name = 'BackupFormatError';
  }
}

/** Unknown or unsupported backup version. */
export class BackupVersionError extends BackupError {
  readonly foundVersion: unknown;

  constructor(foundVersion: unknown) {
    super(
      'This backup uses a version this app cannot restore. Please update Kharcha and try again.',
    );
    this.name = 'BackupVersionError';
    this.foundVersion = foundVersion;
  }
}

/** The backup structure or one of its records failed validation. */
export class BackupValidationError extends BackupError {
  /** Human-readable description of the first problem found. */
  readonly detail: string;

  constructor(detail: string) {
    super(`This backup is corrupted or incomplete (${detail}).`);
    this.name = 'BackupValidationError';
    this.detail = detail;
  }
}

/** The restore transaction failed — the existing database was left unchanged. */
export class BackupRestoreError extends BackupError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'BackupRestoreError';
  }
}

/** Writing succeeded but the Android share sheet could not open. */
export class BackupShareError extends BackupError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'BackupShareError';
  }
}

/**
 * The selected CSV file is not readable as Kharcha CSV: unparseable
 * (truncated quote) or missing/unrecognized headers. Row-level problems are
 * NOT this error — they are reported per row in the import preview.
 */
export class InvalidCsvError extends BackupError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'InvalidCsvError';
  }
}

/**
 * The atomic import transaction failed and was rolled back — the existing
 * database is unchanged. Raw SQL/engine errors never surface (attached as
 * `cause` only).
 */
export class ImportDatabaseError extends BackupError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'ImportDatabaseError';
  }
}

/** Maps any error to the message a screen should display. */
export function describeBackupError(error: unknown): string {
  if (error instanceof BackupValidationError) {
    return error.message;
  }
  if (error instanceof BackupParseError) {
    return 'The selected file is not a valid backup (invalid JSON).';
  }
  if (error instanceof BackupFormatError) {
    return 'The selected file is not a Kharcha backup.';
  }
  if (error instanceof BackupVersionError) {
    return error.message;
  }
  if (error instanceof BackupFileError) {
    return error.message;
  }
  if (error instanceof BackupRestoreError) {
    return error.message;
  }
  if (error instanceof BackupShareError) {
    return error.message;
  }
  if (error instanceof InvalidCsvError) {
    return error.message;
  }
  if (error instanceof ImportDatabaseError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return `Something went wrong: ${error.message}`;
  }
  return 'Something went wrong. Please try again.';
}
