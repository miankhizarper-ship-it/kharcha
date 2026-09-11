/**
 * RFC 4180-compatible CSV parser — pure string processing, no dependencies.
 *
 * Hand-rolled on purpose (spec §10): the parser is small, fully testable,
 * and avoids adding a runtime dependency to an offline-first app. It
 * handles everything the exporter produces and everything real-world
 * spreadsheet tools produce:
 * - quoted fields, including commas, CR, LF and doubled quotes inside them;
 * - CRLF and LF line endings (mixed too);
 * - Unicode content (no transformation — strings pass through verbatim);
 * - empty values and empty lines (skipped, like most spreadsheet tools);
 * - a leading UTF-8 BOM (Excel writes one), stripped before parsing.
 *
 * The parser is deliberately STRICT about one thing: a quoted field that is
 * never closed is a truncated file, and importing half a file silently
 * would be dangerous — so it fails fast with a typed error instead.
 */
import {InvalidCsvError} from './errors';

/**
 * Parses CSV text into rows of fields. Every data row has exactly the
 * number of fields its line contains — callers validate field counts (a
 * short row is a validation problem of that row, not a parse crash).
 */
export function parseCsv(text: string): string[][] {
  // Excel-exported files frequently start with a BOM; leaving it would
  // corrupt the first header name ("Type" would be "\uFEFFType").
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0 && !started) {
      inQuotes = true;
      started = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      started = false;
      continue;
    }

    if (char === '\r' || char === '\n') {
      // CRLF is one terminator; a lone CR or LF also ends the record.
      if (char === '\r' && input[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      // Blank lines between records carry no fields — skip them the way
      // spreadsheet tools do, so stray trailing newlines never surface as
      // phantom invalid rows.
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
      field = '';
      started = false;
      continue;
    }

    field += char;
    started = true;
  }

  // Final field/row without a trailing line terminator.
  if (field.length > 0 || row.length > 0 || started || inQuotes) {
    if (inQuotes) {
      throw new InvalidCsvError(
        'The file ends inside a quoted field — it looks truncated.',
      );
    }
    row.push(field);
    rows.push(row);
  }

  return rows;
}
