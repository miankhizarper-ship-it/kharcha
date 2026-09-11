/**
 * Translates report-load failures into short, actionable, user-facing
 * messages. Technical details (SQL, stack traces) never reach the UI.
 */
export function describeReportLoadError(): string {
  return 'Could not load your report. Please try again.';
}

/**
 * Thrown when a report drill-down scope no longer resolves — e.g. the user
 * taps a category that was deleted before the detail screen loaded. The
 * screen shows a friendly "no longer exists" message, never the raw error.
 */
export class CategoryReportScopeError extends Error {
  constructor(message = 'The selected report scope no longer exists') {
    super(message);
    this.name = 'CategoryReportScopeError';
  }
}

export function describeCategoryDetailLoadError(error: unknown): string {
  if (error instanceof CategoryReportScopeError) {
    return 'This category is no longer available. It may have been deleted.';
  }
  return 'Could not load this report. Please try again.';
}
