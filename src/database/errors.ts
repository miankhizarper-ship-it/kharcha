/** Base class for every error thrown by the database layer. */
export class DatabaseError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message);
    this.name = 'DatabaseError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Thrown when applying a schema migration fails. */
export class MigrationError extends DatabaseError {
  readonly version: number;
  readonly migrationName: string;

  constructor(version: number, migrationName: string, cause?: unknown) {
    super(
      `Migration ${version} (${migrationName}) failed${
        cause instanceof Error ? `: ${cause.message}` : ''
      }`,
      {cause},
    );
    this.name = 'MigrationError';
    this.version = version;
    this.migrationName = migrationName;
  }
}

/** Thrown when caller-supplied data violates a domain invariant. */
export class ValidationError extends DatabaseError {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** Thrown when a read/write targets an entity that does not exist. */
export class NotFoundError extends DatabaseError {
  constructor(entity: string, id: number) {
    super(`${entity} with id ${id} was not found`);
    this.name = 'NotFoundError';
  }
}
