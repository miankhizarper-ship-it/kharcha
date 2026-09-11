/**
 * Money input helpers for the Add/Edit Expense form.
 *
 * The database stores amounts as integers in minor units (paisa/cents, see
 * `src/database/models.ts`). These helpers convert what the user types into
 * that representation — exactly, without floating-point drift — and keep the
 * on-screen text valid while typing.
 */

/** Longest raw amount string accepted ("99999999.99"). */
const MAX_INPUT_LENGTH = 11;

/**
 * Normalizes free-typed text into a strict decimal amount string:
 * digits and a single dot only, at most two fraction digits, no leading
 * zero runs. Safe to call on every keystroke.
 *
 * Examples: "abc1.999x" -> "1.99", "00.5" -> "0.5", "1.2.3" -> "1.23".
 */
export function sanitizeAmountInput(raw: string): string {
  let text = raw.replace(/[^0-9.]/g, '').slice(0, MAX_INPUT_LENGTH);

  const firstDot = text.indexOf('.');
  if (firstDot !== -1) {
    // Drop any dot after the first one.
    text =
      text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '');
  }

  const dot = text.indexOf('.');
  if (dot !== -1 && text.length - dot - 1 > 2) {
    text = text.slice(0, dot + 3);
  }

  // "00" -> "0", "01.50" -> "1.50"; keeps "0." so the user can type cents.
  text = text.replace(/^0+(?=\d)/, '');

  return text;
}

/**
 * Parses a sanitized decimal string into an exact integer amount of minor
 * units. Returns `null` for empty or malformed input ("", "12.", "1.234").
 * "0" and "0.00" parse to 0 — callers decide whether that is valid.
 *
 * Implemented on the string, not via `parseFloat`, so results are exact
 * ("8.20" -> 820, never 820.0000000000001).
 */
export function parseAmountToMinor(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return null;
  }

  const dot = text.indexOf('.');
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? '00' : `${text.slice(dot + 1)}00`.slice(0, 2);

  const wholeNumber = Number(whole);
  if (!Number.isSafeInteger(wholeNumber)) {
    return null;
  }

  const minor = wholeNumber * 100 + Number(fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}
