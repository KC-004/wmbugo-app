import { err, ok, type Result } from '../../shared/result';
import { decodeCsvBytes, detectEncoding, type CsvEncoding } from './decode';
import { tokenizeCsv, type CsvTokenizer } from './tokenize';

/**
 * The CSV reader (Story 9.1, IMP-001): the raw bytes of a bank file in, what was found out of them (and how sure it is) plus the rows,
 * out. Pure; nothing is thrown. Detection can always be overridden, and an override always wins.
 */
export type CsvDelimiter = ',' | ';' | '\t';
export const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];

/** A file over this size is refused. */
export const MAX_CSV_BYTES = 20 * 1024 * 1024;
const SAMPLE_ROWS = 25;
const SNIFF_BYTES = 64 * 1024;
const NUL_SCAN_BYTES = 4096;

export type CsvReadError = 'EMPTY_FILE' | 'NO_ROWS' | 'NOT_A_CSV' | 'FILE_TOO_LARGE';

export interface CsvReadOptions {
  readonly encoding?: CsvEncoding;
  readonly delimiter?: CsvDelimiter;
  /** The 0-based index of the heading row among the file's rows. Rows before it are preamble. */
  readonly headerRow?: number;
  /** The file has no heading row: every row is data. Wins over `headerRow`. */
  readonly noHeader?: boolean;
  /** Papa Parse on the phone; the pure `tokenizeCsv` otherwise. */
  readonly tokenizer?: CsvTokenizer;
}

export interface Detected<T> {
  readonly value: T;
  /** 0 to 1. */
  readonly confidence: number;
  /** True when the caller's override decided it. */
  readonly overridden: boolean;
}

export interface CsvDataRow {
  /** The row's own position in the file, counting from 1 (blank and preamble rows count; a quoted line break does not). */
  readonly row: number;
  readonly cells: readonly string[];
}

export interface CsvReadResult {
  readonly encoding: Detected<CsvEncoding>;
  readonly delimiter: Detected<CsvDelimiter>;
  /** The heading row's 0-based index, or null for a file without one. */
  readonly headerRow: Detected<number | null>;
  /** Rows before the heading, as written. Reported, never imported. */
  readonly preamble: readonly (readonly string[])[];
  readonly header: readonly string[];
  /** Data rows (blank rows are left out). */
  readonly rowCount: number;
  /** The first 25 data rows as cells. */
  readonly sample: readonly (readonly string[])[];
  /** Every data row with its file row number. */
  readonly rows: readonly CsvDataRow[];
}

const isBlank = (r: readonly string[]) => r.every((c) => c.trim() === '');

/** True for a cell that is a money amount and nothing else: a heading never is. Dates (they hold `/`, `-` or `.` between digits) are not. */
/** The Unicode minus sign, built from its code point so no invisible character sits in the source. */
const MINUS = String.fromCharCode(0x2212);
const AMOUNT_LIKE = new RegExp(String.raw`^[(+${MINUS}-]?\s*[£$€₹¥]?\s*[+${MINUS}-]?\d[\d,.\s]*\)?(?:\s*(?:CR|DR))?\s*[-${MINUS}]?$`, 'i');
export const looksLikeAmount = (cell: string): boolean => {
  const c = cell.trim();
  if (c === '' || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(c) || /^\d{4}-\d{2}-\d{2}/.test(c)) return false;
  return AMOUNT_LIKE.test(c);
};

function detectDelimiter(text: string, tokenize: CsvTokenizer): Detected<CsvDelimiter> {
  const sample = text.length > SNIFF_BYTES ? text.slice(0, text.lastIndexOf('\n', SNIFF_BYTES) > 0 ? text.lastIndexOf('\n', SNIFF_BYTES) : SNIFF_BYTES) : text;
  let best: { d: CsvDelimiter; score: number; width: number } | null = null;
  for (const d of CSV_DELIMITERS) {
    const rows = tokenize(sample, d).filter((r) => !isBlank(r));
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let width = 0;
    let n = 0;
    for (const [w, c] of counts) {
      if (c > n || (c === n && w > width)) {
        width = w;
        n = c;
      }
    }
    if (width < 2) continue;
    const score = n / rows.length;
    if (best === null || score > best.score || (score === best.score && width > best.width)) best = { d, score, width };
  }
  return best ? { value: best.d, confidence: Math.min(0.99, best.score), overridden: false } : { value: ',', confidence: 0.3, overridden: false };
}

function detectHeader(rows: readonly (readonly string[])[]): { index: number | null; confidence: number } {
  const counts = new Map<number, number>();
  for (const r of rows.slice(0, 100)) if (!isBlank(r)) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  let dominant = 0;
  let n = 0;
  for (const [w, c] of counts) {
    if (c > n || (c === n && w > dominant)) {
      dominant = w;
      n = c;
    }
  }
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    const r = rows[i]!;
    if (r.length === dominant && !isBlank(r) && !r.some(looksLikeAmount)) return { index: i, confidence: i === 0 ? 0.9 : 0.8 };
  }
  return { index: null, confidence: 0.3 };
}

/** Reads a bank CSV from its bytes. */
export function readCsv(bytes: Uint8Array, options: CsvReadOptions = {}): Result<CsvReadResult, CsvReadError> {
  if (bytes.length === 0) return err('EMPTY_FILE');
  if (bytes.length > MAX_CSV_BYTES) return err('FILE_TOO_LARGE');

  const detected = detectEncoding(bytes);
  const encoding: Detected<CsvEncoding> = options.encoding
    ? { value: options.encoding, confidence: 1, overridden: true }
    : { value: detected.encoding, confidence: detected.confidence, overridden: false };

  // A binary file has NUL bytes near the start. UTF-16 text has them too, between every pair of letters, so it is exempt.
  if (!encoding.value.startsWith('UTF-16')) {
    const head = Math.min(bytes.length, NUL_SCAN_BYTES);
    for (let i = 0; i < head; i++) if (bytes[i] === 0) return err('NOT_A_CSV');
  }

  const text = decodeCsvBytes(bytes, encoding.value);
  if (text.trim() === '') return err('EMPTY_FILE');

  const tokenize = options.tokenizer ?? tokenizeCsv;
  const delimiter: Detected<CsvDelimiter> = options.delimiter ? { value: options.delimiter, confidence: 1, overridden: true } : detectDelimiter(text, tokenize);
  const all = tokenize(text, delimiter.value);

  let header: Detected<number | null>;
  if (options.noHeader) header = { value: null, confidence: 1, overridden: true };
  else if (options.headerRow !== undefined) header = { value: options.headerRow, confidence: 1, overridden: true };
  else {
    const h = detectHeader(all);
    header = { value: h.index, confidence: h.confidence, overridden: false };
  }

  const start = header.value === null ? 0 : header.value + 1;
  const rows: CsvDataRow[] = [];
  for (let i = start; i < all.length; i++) if (!isBlank(all[i]!)) rows.push({ row: i + 1, cells: all[i]! });
  if (rows.length === 0) return err('NO_ROWS');

  return ok({
    encoding,
    delimiter,
    headerRow: header,
    preamble: header.value === null ? [] : all.slice(0, Math.max(0, header.value)),
    header: header.value === null ? [] : (all[header.value] ?? []),
    rowCount: rows.length,
    sample: rows.slice(0, SAMPLE_ROWS).map((r) => r.cells),
    rows,
  });
}
