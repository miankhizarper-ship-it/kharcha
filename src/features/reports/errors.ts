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

/**
 * Thrown when generating or sharing the PDF export of a report fails —
 * rendering (expo-print), staging the file, or opening the share sheet.
 * The message is user-facing; internal causes never surface.
 */
export class ReportPdfExportError extends Error {
  constructor(
    message = 'Could not export the report as a PDF',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ReportPdfExportError';
  }
}

export function describeReportExportError(): string {
  return 'Could not create the PDF. Please try again.';
}
