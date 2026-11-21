import { err, ok, type Result } from '../../shared/result';

/**
 * Amounts in a bank CSV (Story 9.1, NFR-09): exact minor units, no floating-point step anywhere, and text that is not a number is an
 * error, never 0. The style says which character groups thousands and which marks the decimals.
 */
export type NumberStyle = '1,234.56' | '1.234,56' | '1 234,56';
export const NUMBER_STYLES: readonly NumberStyle[] = ['1,234.56', '1.234,56', '1 234,56'];

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

const SEPARATORS: Record<NumberStyle, { group: string; decimal: string }> = {
  '1,234.56': { group: ',', decimal: '.' },
  '1.234,56': { group: '.', decimal: ',' },
  '1 234,56': { group: ' ', decimal: ',' },
};

const CURRENCY_SYMBOLS = /[£$€₹¥₩₽₺฿₫₪₦]/g;
/** No-break, narrow no-break and thin spaces: banks put them between thousands. Built from code points so no invisible character sits in the source. */
const SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f, 0x2009)}]`, 'g');
/** The Unicode minus sign some banks write instead of a hyphen. */
const MINUS = String.fromCharCode(0x2212);

/**
 * Parses one amount cell into signed minor units. The sign comes from a leading `-` (or the Unicode minus), a trailing `-`,
 * parentheses, or `DR`; `CR` and a leading `+` are positive. A currency symbol or a three-letter code is ignored. More decimals than
 * the currency has are refused unless they are zeros (`3.500` is 3.50): nothing is ever rounded.
 */
export function parseCsvAmount(text: string, style: NumberStyle, exponent = 2): Result<number, 'INVALID_AMOUNT'> {
  if (typeof text !== 'string' || !Number.isInteger(exponent) || exponent < 0) return err('INVALID_AMOUNT');
  let s = text.replace(SPACES, ' ').trim();
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const suffix = /\s*\b(CR|DR)\b\.?$/i.exec(s);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === 'DR') negative = true; // CR is a credit: positive
    s = s.slice(0, suffix.index).trim();
  }
  s = s.replace(CURRENCY_SYMBOLS, '').trim();
  // A three-letter currency code before or after the number (`GBP 3.50`, `3.50 GBP`) is ignored.
  const before = /^[A-Za-z]{3}\s*(.*)$/.exec(s);
  if (before && /\d/.test(before[1]!)) s = before[1]!.trim();
  const after = /^(.*?)\s*[A-Za-z]{3}$/.exec(s);
  if (after && /\d/.test(after[1]!)) s = after[1]!.trim();
  if (s.startsWith('-') || s.startsWith(MINUS)) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.endsWith('-') || s.endsWith(MINUS)) {
    negative = true;
    s = s.slice(0, -1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(CURRENCY_SYMBOLS, '').trim(); // a symbol after the sign (`-£3.50`)

  const { group, decimal } = SEPARATORS[style];
  const g = group === ' ' ? ' ' : `\\${group}`;
  const d = `\\${decimal}`;
  const grouped = new RegExp(`^\\d{1,3}(?:${g}\\d{3})+(?:${d}\\d+)?$`);
  const plain = new RegExp(`^(?:\\d+(?:${d}\\d*)?|${d}\\d+)$`);
  if (!grouped.test(s) && !plain.test(s)) return err('INVALID_AMOUNT');

  const at = s.indexOf(decimal);
  const intPart = (at === -1 ? s : s.slice(0, at)).split(group).join('');
  let frac = at === -1 ? '' : s.slice(at + 1);
  if (frac.length > exponent) {
    if (/[^0]/.test(frac.slice(exponent))) return err('INVALID_AMOUNT'); // a digit that would be lost
    frac = frac.slice(0, exponent);
  }
  const minor = BigInt((intPart === '' ? '0' : intPart) + frac.padEnd(exponent, '0'));
  if (minor > MAX) return err('INVALID_AMOUNT');
  const value = Number(minor);
  return ok(negative && value !== 0 ? -value : value);
}

export interface NumberStyleDetection {
  readonly style: NumberStyle;
  /** 0 to 1. Low when the values never show a decimal or a grouping that decides it. */
  readonly confidence: number;
}

/**
 * Finds the number style from the first 25 values. A comma followed by one or two digits at the end (or by four or more) is a decimal
 * comma, as is a comma after dots; a dot is the same the other way round. A single separator followed by exactly three digits could
 * be either, so it counts for nothing. A space grouping thousands with a decimal comma is its own style.
 */
export function detectNumberStyle(values: readonly string[]): NumberStyleDetection {
  const score: Record<NumberStyle, number> = { '1,234.56': 0, '1.234,56': 0, '1 234,56': 0 };
  let decided = 0;
  for (const raw of values.slice(0, 25)) {
    const v = raw
      .replace(SPACES, ' ')
      .replace(CURRENCY_SYMBOLS, '')
      .replace(/\s*\b(?:CR|DR)\b\.?$/i, '')
      .replace(/[()+-]/g, '')
      .replace(MINUS, '')
      .trim();
    if (!/\d/.test(v)) continue;
    const lastComma = v.lastIndexOf(',');
    const lastDot = v.lastIndexOf('.');
    const spaceGrouped = /^\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(v);
    if (spaceGrouped && lastComma > -1) {
      score['1 234,56'] += 2;
      decided += 1;
    } else if (lastComma > -1 && lastDot > -1) {
      score[lastComma > lastDot ? '1.234,56' : '1,234.56'] += 2;
      decided += 1;
    } else if (lastComma > -1) {
      const after = v.length - lastComma - 1;
      if (v.indexOf(',') !== lastComma || after !== 3) {
        score['1.234,56'] += 1; // 12,34 or 1,5 or 1234,5678: only a decimal comma reads that way
        decided += 1;
      }
    } else if (lastDot > -1) {
      const after = v.length - lastDot - 1;
      if (v.indexOf('.') !== lastDot) {
        score['1.234,56'] += 1; // 1.234.567: dots group thousands
        decided += 1;
      } else if (after !== 3) {
        score['1,234.56'] += 1;
        decided += 1;
      }
    }
  }
  const best = NUMBER_STYLES.reduce((a, b) => (score[b] > score[a] ? b : a), '1,234.56' as NumberStyle);
  const total = score['1,234.56'] + score['1.234,56'] + score['1 234,56'];
  if (decided === 0 || total === 0) return { style: '1,234.56', confidence: 0.3 };
  return { style: best, confidence: Math.min(0.99, score[best] / total) };
}
