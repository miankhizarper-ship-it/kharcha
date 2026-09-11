/**
 * Escapes SQL LIKE wildcards (`\`, `%`, `_`) so user-provided search terms
 * are matched literally instead of acting as patterns.
 *
 * Shared by every repository that exposes a `search` filter; always pair the
 * escaped term with `LIKE ? ESCAPE '\'`.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/**
 * Normalizes a user search term before it becomes a LIKE pattern:
 * leading/trailing whitespace is trimmed and internal whitespace runs
 * collapse to single spaces, so accidental double spaces or newlines in the
 * query do not silently produce zero results (Phase 11). Case handling is
 * left to SQLite (LIKE is ASCII-case-insensitive by default).
 *
 * Returns the empty string when nothing searchable remains — callers treat
 * that as "no search filter".
 */
export function normalizeSearchTerm(term: string): string {
  return term.replace(/\s+/g, ' ').trim();
}

/** True when `search` carries a term that should reach the SQL layer. */
export function isSearchActive(search: string | undefined): boolean {
  return search !== undefined && normalizeSearchTerm(search).length > 0;
}
