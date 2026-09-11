import {parseCsv} from './csvParse';
import {InvalidCsvError} from './errors';

/**
 * RFC 4180 parser — quoted fields, escaped quotes, commas/newlines inside
 * quotes, CRLF/LF/mixed, Unicode, empty values, BOM, blank lines.
 */

it('parses simple comma-separated rows', () => {
  expect(parseCsv('a,b,c\nd,e,f')).toEqual([
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
  ]);
});

it('parses quoted fields containing commas', () => {
  expect(parseCsv('"Tea, coffee",2\r\n')).toEqual([['Tea, coffee', '2']]);
});

it('parses quoted fields containing newlines', () => {
  expect(parseCsv('"two\nlines",x\r\n')).toEqual([['two\nlines', 'x']]);
  expect(parseCsv('"crlf\r\nline",y\r\n')).toEqual([['crlf\r\nline', 'y']]);
});

it('doubles embedded quotes per RFC 4180', () => {
  expect(parseCsv('"say ""hi""",1\r\n')).toEqual([['say "hi"', '1']]);
  expect(parseCsv('"a""b"\r\n')).toEqual([['a"b']]);
});

it('treats CRLF, LF and mixed endings as record separators', () => {
  expect(parseCsv('a,b\r\nc,d')).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  expect(parseCsv('a,b\nc,d')).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  expect(parseCsv('a,b\r\nc,d\ne,f')).toEqual([
    ['a', 'b'],
    ['c', 'd'],
    ['e', 'f'],
  ]);
});

it('keeps empty values and preserves their positions', () => {
  expect(parseCsv('a,,c\r\n,,\r\n')).toEqual([
    ['a', '', 'c'],
    ['', '', ''],
  ]);
});

it('keeps an empty trailing field from a trailing comma', () => {
  expect(parseCsv('a,\r\n')).toEqual([['a', '']]);
});

it('skips blank lines between records (spreadsheet behavior)', () => {
  expect(parseCsv('a,b\r\n\r\nc,d\r\n\r\n')).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

it('handles a trailing newline without a phantom empty row', () => {
  expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
  expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
});

it('keeps Unicode text verbatim', () => {
  expect(parseCsv('چائے,房租,café ☕\r\n')).toEqual([
    ['چائے', '房租', 'café ☕'],
  ]);
});

it('strips a leading UTF-8 BOM (Excel exports)', () => {
  expect(parseCsv('\uFEFFType,Date\r\n')).toEqual([['Type', 'Date']]);
});

it('returns [] for an empty string', () => {
  expect(parseCsv('')).toEqual([]);
});

it('parses a single field with no terminator', () => {
  expect(parseCsv('solo')).toEqual([['solo']]);
});

it('parses a quoted empty field as a real empty value', () => {
  expect(parseCsv('a,""\r\n')).toEqual([['a', '']]);
});

it('merges a stray quote inside an unquoted field (lenient, like real tools)', () => {
  expect(parseCsv('a"b,1\r\n')).toEqual([['a"b', '1']]);
});

it('rejects a file that ends inside a quoted field', () => {
  expect(() => parseCsv('a,"unterminated')).toThrow(InvalidCsvError);
});

it('rejects an empty file gracefully at higher level (returns [])', () => {
  // The import layer turns [] into "The file is empty." — the parser
  // itself just yields no rows.
  expect(parseCsv('\r\n\r\n')).toEqual([]);
});
