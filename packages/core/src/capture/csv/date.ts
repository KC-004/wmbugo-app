import { localToInstant } from '../../shared/clock';
import { err, ok, type Result } from '../../shared/result';

/**
 * Dates in a bank CSV (Story 9.1, FIN-002). A date alone becomes the `local_date` exactly as written, with no UTC shift. A date with a
 * time becomes a UTC instant in the profile timezone, and keeps the day that was written. A day/month order that cannot be told from
 * the values is asked about, never guessed.
 */
export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD.MM.YYYY' | 'DD-MM-YYYY' | 'D MMM YYYY';
export const DATE_FORMATS: readonly DateFormat[] = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'D MMM YYYY'];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const TIME = String.raw`(?:(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?)?`;
const PATTERNS: Record<DateFormat, RegExp> = {
  'YYYY-MM-DD': new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`),
  'DD/MM/YYYY': new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`),
  'MM/DD/YYYY': new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${TIME}$`),
  'DD.MM.YYYY': new RegExp(String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{4})${TIME}$`),
  'DD-MM-YYYY': new RegExp(String.raw`^(\d{1,2})-(\d{1,2})-(\d{4})${TIME}$`),
  'D MMM YYYY': new RegExp(String.raw`^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})${TIME}$`),
};

const daysIn = (year: number, month: number): number => (month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31);

export interface ParsedCsvDate {
  /** `YYYY-MM-DD`, exactly as written. */
  readonly localDate: string;
  /** Present when the value carried a time of day: the UTC instant of that wall clock in the given timezone. */
  readonly instantMs?: number;
  readonly hasTime: boolean;
}

interface Fields {
  y: number;
  m: number;
  d: number;
  h?: number;
  min?: number;
  s?: number;
}

function fieldsOf(text: string, format: DateFormat): Fields | null {
  const m = PATTERNS[format].exec(text.trim());
  if (!m) return null;
  let y: number;
  let mo: number;
  let d: number;
  if (format === 'YYYY-MM-DD') {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else if (format === 'MM/DD/YYYY') {
    mo = Number(m[1]);
    d = Number(m[2]);
    y = Number(m[3]);
  } else if (format === 'D MMM YYYY') {
    d = Number(m[1]);
    const named = MONTHS[m[2]!.toLowerCase()];
    if (named === undefined) return null;
    mo = named;
    y = Number(m[3]);
  } else {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || y < 1) return null;
  if (m[4] === undefined) return { y, m: mo, d };
  const h = Number(m[4]);
  const min = Number(m[5]);
  const s = m[6] === undefined ? 0 : Number(m[6]);
  if (h > 23 || min > 59 || s > 59) return null;
  return { y, m: mo, d, h, min, s };
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Parses one date cell in a known format. A date that is not on the calendar (`31/02/2026`) is `INVALID_DATE`. */
export function parseCsvDate(text: string, format: DateFormat, timezoneId: string): Result<ParsedCsvDate, 'INVALID_DATE'> {
  const f = fieldsOf(text, format);
  if (!f) return err('INVALID_DATE');
  const localDate = `${pad(f.y, 4)}-${pad(f.m, 2)}-${pad(f.d, 2)}`;
  if (f.h === undefined) return ok({ localDate, hasTime: false });
  const instant = localToInstant(localDate, f.h, f.min!, timezoneId);
  if (!instant.ok) return err('INVALID_DATE');
  return ok({ localDate, instantMs: instant.value + (f.s ?? 0) * 1000, hasTime: true });
}

export type DateFormatDetection =
  | { readonly kind: 'detected'; readonly format: DateFormat; readonly confidence: number }
  /** Every value reads under both orders (day and month are all 12 or under): the person is asked. */
  | { readonly kind: 'ambiguous'; readonly code: 'AMBIGUOUS_DATE_FORMAT'; readonly candidates: readonly [DateFormat, DateFormat] }
  | { readonly kind: 'none' };

/** Finds the format from the first 25 non-blank values. A format must read every one of them; `none` when no format does. */
export function detectDateFormat(values: readonly string[]): DateFormatDetection {
  const sample = values.map((v) => v.trim()).filter((v) => v !== '').slice(0, 25);
  if (sample.length === 0) return { kind: 'none' };
  const fits = DATE_FORMATS.filter((fmt) => sample.every((v) => fieldsOf(v, fmt) !== null));
  if (fits.length === 0) return { kind: 'none' };
  if (fits.includes('DD/MM/YYYY') && fits.includes('MM/DD/YYYY')) {
    return { kind: 'ambiguous', code: 'AMBIGUOUS_DATE_FORMAT', candidates: ['DD/MM/YYYY', 'MM/DD/YYYY'] };
  }
  return { kind: 'detected', format: fits[0]!, confidence: Math.min(0.99, 0.7 + sample.length / 100) };
}
