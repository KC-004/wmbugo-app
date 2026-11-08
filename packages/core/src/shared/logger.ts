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

// Field names whose values never reach a sink, whatever they contain.
const SENSITIVE_KEY =
  /amount|balance|minor|total|price|spent|income|note|memo|merchant|payee|vendor|account|mask|iban|card|upi|sms|body|message|text|title|description|name|key|token|secret|pass|pin|otp|phone|email|address/i;

// Money and account-mask shapes inside otherwise harmless strings.
const AMOUNT_IN_TEXT =
  /(?:[₹$€£¥]|\b(?:INR|USD|CAD|GBP|EUR|AED|SAR|QAR|BHD|KWD|OMR|SGD|MYR|CHF|SEK|NOK|DKK|PLN|CZK|HUF|THB|IDR|PHP|VND|Rs\.?)\s?)\d[\d,.\s]*\d|\d[\d,]*(?:\.\d+)?\s?(?:[₹$€£¥]|\b(?:INR|USD|EUR|GBP|SGD|Rs\.?)\b)/gi;
const MASK_IN_TEXT = /(?:x{2,}|\*{2,}|•{2,}|#)\s?\d{3,}|\b\d{4,}\b/gi;

function redactString(s: string): string {
  return s.replace(AMOUNT_IN_TEXT, REDACTED).replace(MASK_IN_TEXT, REDACTED);
}

function redactValue(key: string, value: LogValue, depth: number): LogValue {
  if (SENSITIVE_KEY.test(key)) return value === undefined || value === null ? value : REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return depth > 4 ? REDACTED : value.map((v) => redactValue(key, v, depth + 1));
  if (value !== null && typeof value === 'object') {
    if (depth > 4) return REDACTED;
    const out: Record<string, LogValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(k, v, depth + 1);
    return out;
  }
  return value;
}

/** Redacts every field of an entry. Pure; exported for tests. */
export function redactEntry(level: LogLevel, event: string, fields: Record<string, LogValue> = {}): LogEntry {
  const out: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = redactValue(k, v, 0);
  return { level, event: redactString(event), fields: out };
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
