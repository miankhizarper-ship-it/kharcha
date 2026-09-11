/**
 * Display formatting for stored minor-unit amounts.
 *
 * Kharcha stores all money as integers in the database (minor units) to
 * avoid floating-point drift; conversion happens only at the display edge.
 */

/**
 * Formats an amount stored in minor units (e.g. paisa/cents) as a localized
 * currency string.
 *
 * Exactly two fraction digits are ALWAYS shown: every currency in Kharcha is
 * stored x100 (see `src/database/models.ts`), so honoring CLDR defaults
 * (PKR/JPY format with zero decimals) would silently round real money away
 * on every screen. Formatters are memoized per (locale, currency) — this
 * runs per transaction row on every list render.
 */
const formatterCache = new Map<string, Intl.NumberFormat>();

export function formatCurrency(
  amountMinor: number,
  currency = 'USD',
  locale = 'en-US',
): string {
  const key = `${locale}::${currency}`;
  let formatter = formatterCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatterCache.set(key, formatter);
  }
  return formatter.format(amountMinor / 100);
}

/**
 * Renders stored minor units as an exact plain decimal string
 * ("125050" -> "1250.50") using integer arithmetic only — no floats, no
 * rounding. Shared by forms pre-filling amount fields and by the CSV/backup
 * export (this is the single canonical implementation).
 */
export function formatMinorAsDecimal(amountMinor: number): string {
  if (
    typeof amountMinor !== 'number' ||
    !Number.isFinite(amountMinor) ||
    !Number.isInteger(amountMinor)
  ) {
    // Defensive: callers only ever pass stored integers.
    throw new Error(`Invalid minor-unit amount: ${String(amountMinor)}`);
  }

  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  // Exact integer math — no float division anywhere:
  const remainder = abs % 100;
  const whole = (abs - remainder) / 100;
  const fraction = remainder < 10 ? `0${remainder}` : `${remainder}`;
  return `${sign}${whole}.${fraction}`;
}
