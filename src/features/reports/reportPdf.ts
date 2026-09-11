import type {
  CategoryBudgetProgress,
  OverallBudgetProgress,
} from '@/features/budgets/types';
import {formatBudgetPercent} from '@/features/budgets/progress';
import {buildReportInsights} from '@/features/reports/insights';
import type {
  ReportInsight,
  ReportSelection,
  ReportSnapshot,
} from '@/features/reports/types';
import {formatShortDate} from '@/utils/date';
import {formatCurrency} from '@/utils/format';

/**
 * Pure PDF builder for the Reports feature.
 *
 * Produces the print-ready HTML consumed by `expo-print`'s
 * `printToFileAsync`, plus the export filename. Everything here is pure
 * string/date math — no React Native, no file I/O — so the exact document
 * the user receives is unit-testable (the I/O half lives in
 * `exportReportPdf.ts`, mirroring the backup feature's split).
 *
 * The document deliberately renders with a fixed light palette: print
 * output is read on paper/PDF viewers, not inside the dark app theme.
 */

/** Brand green sampled from the app icon artwork (header/table accents). */
const BRAND_GREEN = '#1E5D4B';

/** Budget-state wording shared by the budget table rows. */
const BUDGET_STATE_LABEL: Record<string, string> = {
  ok: 'On track',
  warning: 'Approaching limit',
  exceeded: 'Exceeded',
  zero: 'No budget',
};

/** Escapes user-entered text (titles, categories, sources) for HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local (year, month, day) parts of an epoch-millis timestamp. */
function localDateParts(ms: number): [number, number, number] {
  const date = new Date(ms);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

/**
 * Deterministic export filename for the share sheet:
 * - month selections:  `Kharcha-Report-2026-09.pdf`
 * - week/custom:       `Kharcha-Report-2026-09-01_to_2026-09-07.pdf`
 */
export function buildReportPdfFilename(
  selection: ReportSelection,
  period: {fromDate: number; toDate: number},
): string {
  if (selection.kind === 'month') {
    return `Kharcha-Report-${selection.year}-${pad2(selection.month)}.pdf`;
  }
  const [fy, fm, fd] = localDateParts(period.fromDate);
  const [ty, tm, td] = localDateParts(period.toDate);
  return `Kharcha-Report-${fy}-${pad2(fm)}-${pad2(fd)}_to_${ty}-${pad2(tm)}-${pad2(td)}.pdf`;
}

function summaryTable(snapshot: ReportSnapshot, currency: string): string {
  const rows: [string, string][] = [
    ['Income', formatCurrency(snapshot.income, currency)],
    ['Expenses', formatCurrency(snapshot.expenses, currency)],
    ['Balance', formatCurrency(snapshot.balance, currency)],
    [
      'Average daily spend',
      formatCurrency(snapshot.averageDailySpend, currency),
    ],
    ['Expenses recorded', String(snapshot.expenseCount)],
    ['Income entries recorded', String(snapshot.incomeCount)],
    [
      'Average transaction',
      formatCurrency(snapshot.averageTransaction, currency),
    ],
  ];
  return `<table><tbody>${rows
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${label}</th><td>${value}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function dailySpendingTable(
  snapshot: ReportSnapshot,
  currency: string,
): string | null {
  if (snapshot.dailySpending.length === 0) {
    return null;
  }
  const rows = snapshot.dailySpending
    .map(
      point =>
        `<tr><td>${formatShortDate(point.date)}</td><td>${formatCurrency(
          point.total,
          currency,
        )}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Day</th><th>Spent</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function categoryTable(
  snapshot: ReportSnapshot,
  currency: string,
): string | null {
  if (snapshot.categoryBreakdown.length === 0) {
    return null;
  }
  const rows = snapshot.categoryBreakdown
    .map(
      slice =>
        `<tr><td>${escapeHtml(slice.name)}</td><td>${
          slice.transactionCount !== undefined ? slice.transactionCount : '—'
        }</td><td>${formatCurrency(slice.total, currency)}</td><td>${formatBudgetPercent(
          slice.percent,
        )}%</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Category</th><th>Transactions</th><th>Spent</th><th>Share</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function incomeSourcesTable(
  snapshot: ReportSnapshot,
  currency: string,
): string | null {
  if (snapshot.incomeSources.length === 0) {
    return null;
  }
  const rows = snapshot.incomeSources
    .map(
      source =>
        `<tr><td>${escapeHtml(source.source)}</td><td>${
          source.transactionCount
        }</td><td>${formatCurrency(source.total, currency)}</td><td>${formatBudgetPercent(
          source.percent,
        )}%</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Source</th><th>Entries</th><th>Received</th><th>Share</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function budgetRows(
  budgets: (OverallBudgetProgress | CategoryBudgetProgress)[],
  currency: string,
): string {
  return budgets
    .map(
      budget =>
        `<tr><td>${escapeHtml(
          'categoryName' in budget ? budget.categoryName : 'Overall budget',
        )}</td><td>${formatCurrency(budget.amount, currency)}</td><td>${formatCurrency(
          budget.spent,
          currency,
        )}</td><td>${formatCurrency(budget.remaining, currency)}</td><td>${formatBudgetPercent(
          budget.percent,
        )}% · ${BUDGET_STATE_LABEL[budget.state] ?? budget.state}</td></tr>`,
    )
    .join('');
}

function budgetSection(
  snapshot: ReportSnapshot,
  currency: string,
): string | null {
  const performance = snapshot.budgetPerformance;
  if (!performance) {
    return null;
  }
  const blocks: string[] = [];
  if (performance.overall) {
    blocks.push(
      `<table><tbody>${budgetRows([performance.overall], currency)}</tbody></table>`,
    );
  }
  if (performance.topCategories.length > 0) {
    blocks.push(
      `<table><thead><tr><th>Category budget</th><th>Budgeted</th><th>Spent</th><th>Remaining</th><th>Status</th></tr></thead><tbody>${budgetRows(
        performance.topCategories,
        currency,
      )}</tbody></table>`,
    );
  }
  if (blocks.length === 0) {
    return null;
  }
  return blocks.join('');
}

function comparisonSection(
  snapshot: ReportSnapshot,
  currency: string,
): string | null {
  const comparison = snapshot.previousPeriodComparison;
  if (!comparison) {
    return null;
  }
  const direction =
    comparison.direction === 'up'
      ? 'more'
      : comparison.direction === 'down'
        ? 'less'
        : 'the same';
  const percent =
    comparison.percentChange !== null
      ? `${formatBudgetPercent(Math.abs(comparison.percentChange))}% `
      : '';
  return `<p class="muted">You spent ${percent}${direction} than the previous month — ${formatCurrency(
    comparison.currentTotal,
    currency,
  )} vs ${formatCurrency(comparison.previousTotal, currency)} (difference ${formatCurrency(
    comparison.difference,
    currency,
  )}).</p>`;
}

function insightsSection(insights: ReportInsight[]): string | null {
  if (insights.length === 0) {
    return null;
  }
  return `<ul>${insights
    .map(
      insight =>
        `<li><strong>${escapeHtml(insight.title)}</strong>${
          insight.detail ? ` — ${escapeHtml(insight.detail)}` : ''
        }</li>`,
    )
    .join('')}</ul>`;
}

function largestTransactionLine(
  snapshot: ReportSnapshot,
  currency: string,
): string | null {
  const largest = snapshot.largestTransaction;
  if (!largest) {
    return null;
  }
  return `<p><strong>Largest transaction</strong> — ${escapeHtml(
    largest.title,
  )} · ${escapeHtml(largest.categoryName ?? (largest.type === 'income' ? 'Income' : 'Uncategorized'))} · ${formatShortDate(
    largest.date,
  )} · ${formatCurrency(largest.amount, currency)}</p>`;
}

export interface ReportPdfInput {
  snapshot: ReportSnapshot;
  currency: string;
  /** Human label of the selected period, e.g. "September 2026". */
  periodLabel: string;
  /** Label of the previous month for the comparison section. */
  previousLabel?: string;
  /** Anchor instant for the "Generated on" stamp (captured on device). */
  generatedAt: number;
}

/** Builds the complete standalone HTML document for the PDF. */
export function buildReportHtml(input: ReportPdfInput): string {
  const {snapshot, currency, periodLabel, previousLabel, generatedAt} = input;

  const insights: ReportInsight[] = buildReportInsights(snapshot, {
    formatCurrency: minor => formatCurrency(minor, currency),
    formatPercent: formatBudgetPercent,
    formatShortDate,
  });

  const sections: [string, string | null][] = [
    ['Summary', summaryTable(snapshot, currency)],
    [
      'Daily Spending',
      snapshot.expenses > 0 ? dailySpendingTable(snapshot, currency) : null,
    ],
    ['By Category', categoryTable(snapshot, currency)],
    ['Income Sources', incomeSourcesTable(snapshot, currency)],
    // Income/expense/balance are covered by the Summary table's rows.
    ['Budget Performance', budgetSection(snapshot, currency)],
    ['Month-over-Month', comparisonSection(snapshot, currency)],
    ['Largest Transaction', largestTransactionLine(snapshot, currency)],
    ['Insights', insightsSection(insights)],
  ];

  const body = sections
    .filter(([, content]) => content !== null)
    .map(
      ([title, content]) =>
        `<section><h2>${title}</h2>${content ?? ''}</section>`,
    )
    .join('');

  const previousNote =
    previousLabel && snapshot.previousPeriodComparison
      ? `<p class="muted">Compared against ${escapeHtml(previousLabel)}.</p>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 40px 36px; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, Roboto, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #17252A; margin: 0; font-size: 12px; line-height: 1.45;
  }
  header { border-bottom: 3px solid ${BRAND_GREEN}; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0 0 2px; color: ${BRAND_GREEN}; letter-spacing: 0.5px; }
  .period { font-size: 15px; font-weight: 600; margin: 0; }
  .stamp { color: #5B6B70; font-size: 10.5px; margin: 4px 0 0; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 1px;
    color: ${BRAND_GREEN}; border-bottom: 1px solid #D8E2E0;
    padding-bottom: 4px; margin: 18px 0 8px;
  }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }
  th, td { border: 1px solid #D8E2E0; padding: 5px 8px; text-align: left; }
  thead th { background: #EEF4F2; color: #1E5D4B; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; }
  tbody th { font-weight: 600; background: #F7FAF9; width: 40%; }
  td:nth-child(n + 2) { text-align: right; }
  .muted { color: #5B6B70; }
  ul { margin: 4px 0 8px; padding-left: 18px; }
  li { margin-bottom: 4px; }
  footer {
    margin-top: 22px; padding-top: 8px; border-top: 1px solid #D8E2E0;
    color: #5B6B70; font-size: 10px;
  }
</style>
</head>
<body>
<header>
  <h1>Kharcha</h1>
  <p class="period">${escapeHtml(periodLabel)}</p>
  <p class="stamp">Generated ${formatShortDate(generatedAt)} · computed locally on your device</p>
</header>
${body}
${previousNote}
<footer>Kharcha — offline personal expense tracker. This report reflects the data stored on this device at the time it was generated.</footer>
</body>
</html>`;
}
