import {ValidationError} from '../errors';

/**
 * Input guards used by repositories before any SQL runs. They mirror the
 * CHECK constraints in migration 001 so invalid data is rejected with a
 * readable `ValidationError` instead of an opaque SQLite error.
 *
 * All string values are trimmed; trimming happens at the data layer so the
 * stored data is always canonical.
 */

export function requireInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(field, 'must be an integer');
  }
  return value;
}

export function requirePositiveInt(value: unknown, field: string): number {
  const intValue = requireInt(value, field);
  if (intValue <= 0) {
    throw new ValidationError(field, 'must be a positive integer');
  }
  return intValue;
}

export function requireText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new ValidationError(field, 'must be a string');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(field, 'must not be empty');
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `must be at most ${maxLength} characters`);
  }
  return trimmed;
}

/** Null / undefined / blank collapse to `null`; anything else must be text. */
export function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(field, 'must be a string or null');
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `must be at most ${maxLength} characters`);
  }
  return trimmed.length === 0 ? null : trimmed;
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(field, `must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}
