export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null | undefined | LogValue[] | { [key: string]: LogValue };

export interface LogEntry {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: Record<string, LogValue>;
}

/** Where redacted entries finally go (e.g. a size-capped private file). */
export interface LogSink {
  write(entry: LogEntry): void;
}

/** Logger port. Core and the app log only through this; there is no console.log. */
export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, LogValue>): void;
  debug(event: string, fields?: Record<string, LogValue>): void;
  info(event: string, fields?: Record<string, LogValue>): void;
  warn(event: string, fields?: Record<string, LogValue>): void;
  error(event: string, fields?: Record<string, LogValue>): void;
}

export const REDACTED = '[redacted]';

// The only field names whose values reach a sink: ids, counts, codes, durations, versions and flags. Every other key is
// redacted whatever its value, so a new field name can never leak money by accident (Story 8.1, AD-19).
const ALLOWED_KEY =
  /^(id|ids|code|errorCode|errorType|ok|event|kind|tab|route|step|useCase|invariant|flavor|level|reason|schemaVersion|appVersion|version|databaseExists|migrationsApplied|enabled|durationMs|errorMessage|stack|stackFrames)$|(Id|Ids|Count|Ms|Version|Code)$/;
// Free-text keys: allowed, but scrubbed.
const FREE_TEXT_KEY = /^(errorMessage|stack|stackFrames)$/;
const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Keys whose string value must be an id (a UUID), a code (no spaces), or a number. A value of another shape under such a key
// is redacted: the key being allowed says what the field is meant to hold, not that anything may be put in it.
const ID_KEY = /^(id|ids)$|(Id|Ids)$/;
const CODE_KEY = /^(code|errorCode|errorType|kind|tab|route|step|useCase|invariant|flavor|level|reason|event)$|Code$/;
const NUMBER_KEY = /(Count|Ms)$|^(durationMs)$/;
const VERSION_KEY = /^(schemaVersion|appVersion|version)$|Version$/;
const CODE_VALUE = /^[A-Za-z0-9_.:/-]{1,64}$/;
const VERSION_VALUE = /^\d+(?:\.\d+){0,3}$/;

// Money inside otherwise harmless text, matched whole so partial digit groups (1,18,600) cannot survive.
const AMOUNT_IN_TEXT =
  /(?:[₹$€£¥]|\b(?:INR|USD|CAD|GBP|EUR|AED|SAR|QAR|BHD|KWD|OMR|SGD|MYR|CHF|SEK|NOK|DKK|PLN|CZK|HUF|THB|IDR|PHP|VND|Rs\.?)\s?)\d(?:[\d,.\s]*\d)?|\d[\d,]*(?:\.\d+)?\s?(?:[₹$€£¥]|\b(?:INR|USD|EUR|GBP|SGD|Rs\.?)\b)/gi;
// Masked account numbers: ••4821, XX4821, A/c *4821, a/c no. 4821.
const MASK_IN_TEXT = /(?:a\/c\s*(?:no\.?\s*)?[*x•#]*|x{2,}|\*{2,}|•{1,}|#)\s?\d{3,}/gi;
const EMAIL_OR_UPI = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g;

/**
 * Scrubs free text: masked accounts, emails and UPI ids, amounts, any amount written with two decimals, then any run of 3 or more
 * digits. Pure.
 */
export function scrubText(s: string): string {
  return s
    .replace(EMAIL_OR_UPI, '[id]')
    .replace(MASK_IN_TEXT, '[acct]')
    .replace(AMOUNT_IN_TEXT, '[n]')
    .replace(/\b\d+[.,]\d{2}\b/g, '[n]')
    .replace(/\d{3,}/g, '[n]');
}

/**
 * Scrubs a stack frame: the function name is scrubbed like free text, the location (`(file:line:column)` or `@file:line:column`) is
 * kept as it is, because line and column numbers are what a record is symbolicated with.
 */
export function scrubFrame(frame: string): string {
  const at = frame.search(/[(@]/);
  return at === -1 ? scrubText(frame) : scrubText(frame.slice(0, at)) + frame.slice(at);
}

function scrubAllowed(key: string, s: string): string {
  if (FREE_TEXT_KEY.test(key)) return scrubText(s);
  // Ids are opaque and useful in a log; a UUID is kept as it is, and nothing else may sit under an id key.
  if (ID_KEY.test(key)) return ID_LIKE.test(s) ? s : REDACTED;
  // A version is dotted digits; a number-valued key does not hold text; a code key holds a code, not a sentence.
  if (VERSION_KEY.test(key)) return VERSION_VALUE.test(s) ? s : REDACTED;
  if (NUMBER_KEY.test(key)) return /^\d{1,15}$/.test(s) ? s : REDACTED;
  if (CODE_KEY.test(key)) return CODE_VALUE.test(s) ? scrubText(s) : REDACTED;
  return scrubText(s);
}

function redactValue(key: string, value: LogValue, depth: number): LogValue {
  if (!ALLOWED_KEY.test(key)) return value === undefined || value === null ? value : REDACTED;
  if (typeof value === 'string') return scrubAllowed(key, value);
  if (Array.isArray(value)) return depth > 4 ? REDACTED : value.map((v) => (typeof v === 'string' ? scrubAllowed(key, v) : v === null || typeof v !== 'object' ? v : REDACTED));
  if (value !== null && typeof value === 'object') return REDACTED;
  return value;
}

/** Redacts every field of an entry. Pure; exported for tests. */
export function redactEntry(level: LogLevel, event: string, fields: Record<string, LogValue> = {}): LogEntry {
  const out: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = redactValue(k, v, 0);
  return { level, event: scrubText(event), fields: out };
}

/** Logger that redacts amounts, account masks and notes before anything reaches the sink. */
export function createRedactingLogger(sink: LogSink): Logger {
  const log = (level: LogLevel, event: string, fields?: Record<string, LogValue>): void => {
    sink.write(redactEntry(level, event, fields));
  };
  return {
    log,
    debug: (e, f) => log('debug', e, f),
    info: (e, f) => log('info', e, f),
    warn: (e, f) => log('warn', e, f),
    error: (e, f) => log('error', e, f),
  };
}
