import type { LogValue } from './logger';

export const AUDIT_REDACTED = '[redacted]';

// The audit trail lives in the encrypted database and keeps the shape of a change (labels, kinds, ids) while masking money,
// notes and identifiers. Logs use the stricter allowlist in logger.ts; this deny-list is only for audit rows.
const SENSITIVE_KEY =
  /amount|balance|minor|total|price|spent|income|note|memo|merchant|payee|vendor|account|mask|iban|card|upi|sms|body|message|text|title|description|name|key|token|secret|pass|pin|otp|phone|email|address/i;

// Money and account-mask shapes inside otherwise harmless strings.
const AMOUNT_IN_TEXT =
  /(?:[₹$€£¥]|\b(?:INR|USD|CAD|GBP|EUR|AED|SAR|QAR|BHD|KWD|OMR|SGD|MYR|CHF|SEK|NOK|DKK|PLN|CZK|HUF|THB|IDR|PHP|VND|Rs\.?)\s?)\d[\d,.\s]*\d|\d[\d,]*(?:\.\d+)?\s?(?:[₹$€£¥]|\b(?:INR|USD|EUR|GBP|SGD|Rs\.?)\b)/gi;
const MASK_IN_TEXT = /(?:x{2,}|\*{2,}|•{2,}|#)\s?\d{3,}|\b\d{4,}\b/gi;

function redactString(s: string): string {
  return s.replace(AMOUNT_IN_TEXT, AUDIT_REDACTED).replace(MASK_IN_TEXT, AUDIT_REDACTED);
}

function redactValue(key: string, value: LogValue, depth: number): LogValue {
  if (SENSITIVE_KEY.test(key)) return value === undefined || value === null ? value : AUDIT_REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return depth > 4 ? AUDIT_REDACTED : value.map((v) => redactValue(key, v, depth + 1));
  if (value !== null && typeof value === 'object') {
    if (depth > 4) return AUDIT_REDACTED;
    const out: Record<string, LogValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(k, v, depth + 1);
    return out;
  }
  return value;
}

/** Redacts the fields of an audit change by key name and by money or mask shapes in text. Pure. */
export function redactAuditChange(fields: Record<string, LogValue> = {}): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = redactValue(k, v, 0);
  return out;
}
