import { parseAmountInput } from '../../shared/money';

/** Regions whose receipts write `1.234,56`. Other Phase 1 regions use a decimal point (Indian grouping `1,23,456.00` included). */
const DECIMAL_COMMA_REGIONS = new Set(['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'PT', 'FI', 'GR', 'SE', 'NO', 'DK', 'PL', 'CZ', 'HU', 'ID', 'VN']);

export const usesDecimalComma = (region: string): boolean => DECIMAL_COMMA_REGIONS.has(region.toUpperCase());

export interface AmountToken {
  /** Signed minor units. */
  readonly minor: number;
  readonly start: number;
  readonly end: number;
}

const MASKS = [/\b\d{4}-\d{1,2}-\d{1,2}\b/g, /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, /\b\d{1,2}:\d{2}(?::\d{2})?\b/g];
const MINUS = String.fromCharCode(0x2212);
/** Regions that write a space between thousands. Elsewhere a space separates columns: in "1 649.00" the 1 is a quantity. */
const SPACE_GROUP_REGIONS = new Set(['FR', 'SE', 'NO', 'FI', 'PL', 'CZ', 'SK', 'HU', 'PT', 'ZA']);

/** A currency mark may be printed against the digits, and a tax-class letter after the cents (`12.50A`). */
const PREFIX = String.raw`(?:(?:RM|Rs\.?|INR|SGD|MYR|USD|GBP|EUR|AED|CHF|[£$€₹¥])\s?)?`;
const SPACED = String.raw`\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|`;
const token = (spaced: boolean): RegExp =>
  new RegExp(String.raw`(?<![\p{L}\d])([-(]|−)?${PREFIX}(${spaced ? SPACED : ''}\d(?:[\d.,'’]*\d)?)(?:(?<=[.,]\d\d)[ABCDEFHNTZ](?![\p{L}\d]))?(?![\p{L}\d])(?!\s?%)(-|\))?`, 'gu');
const TOKEN = token(false);
const TOKEN_SPACED = token(true);

/**
 * One digit string to minor units. Both separators present: the last one is the decimal mark. One kind repeated: grouping only.
 * One separator once: the region's decimal mark is a decimal; the other mark is a decimal unless exactly three digits follow it
 * (then it groups thousands). More decimals than the currency has are refused unless they are zeros. Only ASCII digits are read.
 */
export function parseDigits(raw: string, exponent: number, regionDecimal: '.' | ','): { minor: number; hasDecimal: boolean } | null {
  const s = raw.replace(/['\u2019\s\u00a0\u202f]/g, '');
  let int = s;
  let frac = '';
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (last >= 0) {
    const c = s[last]!;
    const kinds = new Set(s.replace(/[\d]/g, '').split(''));
    const afterLen = s.length - last - 1;
    if (afterLen === 0) return null;
    const count = s.split(c).length - 1;
    let decimal: boolean;
    if (kinds.size === 2) decimal = true;
    else if (count > 1) decimal = false;
    else decimal = c === regionDecimal || afterLen !== 3;
    if (decimal) {
      int = s.slice(0, last).replace(/[.,]/g, '');
      frac = s.slice(last + 1);
    } else int = s.replace(/[.,]/g, '');
  }
  if (!/^\d+$/.test(int) || (frac !== '' && !/^\d+$/.test(frac))) return null;
  if (frac.length > exponent) {
    if (/[^0]/.test(frac.slice(exponent))) return null;
    frac = frac.slice(0, exponent);
  }
  const hasDecimal = frac !== '';
  const canonical = exponent === 0 ? int : `${int}.${frac.padEnd(exponent, '0')}`;
  const r = parseAmountInput(canonical, exponent);
  return r.ok ? { minor: r.value, hasDecimal } : null;
}

/** Replaces dates and times by spaces (same length) so their digits are never read as amounts. */
export function maskDatesAndTimes(text: string): string {
  let s = text;
  for (const m of MASKS) s = s.replace(m, (x) => ' '.repeat(x.length));
  return s;
}

/**
 * Amount tokens in a line of text, left to right. With cents (exponent above 0) only a token with a decimal part counts, so quantities and
 * sizes (`2`, `500g`) are not amounts. A leading minus, trailing minus or brackets make it negative.
 */
export function findAmounts(text: string, exponent: number, region: string): AmountToken[] {
  const masked = maskDatesAndTimes(text);
  const decimal = usesDecimalComma(region) ? ',' : '.';
  const out: AmountToken[] = [];
  const pattern = SPACE_GROUP_REGIONS.has(region.toUpperCase()) ? TOKEN_SPACED : TOKEN;
  pattern.lastIndex = 0;
  for (let m = pattern.exec(masked); m; m = pattern.exec(masked)) {
    const p = parseDigits(m[2]!, exponent, decimal);
    if (!p || (exponent > 0 && !p.hasDecimal)) continue;
    const lead = m[1];
    const negative = lead === '-' || lead === MINUS || m[3] === '-' || (lead === '(' && m[3] === ')');
    out.push({ minor: negative ? -p.minor : p.minor, start: m.index, end: m.index + m[0].length });
  }
  return out;
}
