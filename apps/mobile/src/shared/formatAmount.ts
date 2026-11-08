import { getCurrency, err, ok, type Result } from '@wmbugo/core';

/**
 * The only way to turn money into display text. Takes a magnitude plus a
 * direction and never emits a minus sign: expenses are unsigned, income gets
 * '+', neutral (transfers, balances) is unsigned.
 */
export type AmountDirection = 'expense' | 'income' | 'neutral';

export interface FormatAmountInput {
  /** Minor units. The sign is ignored: direction carries the meaning. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly direction: AmountDirection;
  /** BCP-47 locale; defaults to the currency's default locale. */
  readonly locale?: string;
}

import { SYMBOL_OVERRIDE } from './currencySymbol';

const SIGN_CHARS = /[-‐-―−﹣－]/g;

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: string, currency: string, exponent: number): Intl.NumberFormat {
  const key = `${locale}|${currency}|${exponent}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
      useGrouping: true,
    });
    formatters.set(key, f);
  }
  return f;
}

export function formatAmount(input: FormatAmountInput): Result<string, 'AMOUNT_INVALID' | 'CURRENCY_UNSUPPORTED'> {
  const cur = getCurrency(input.currency);
  if (!cur.ok) return cur;
  if (!Number.isSafeInteger(input.amountMinor)) return err('AMOUNT_INVALID');

  const exponent = cur.value.exponent;
  const magnitude = Math.abs(input.amountMinor);
  const scale = 10 ** exponent; // exact: 1, 100 or 1000
  const whole = Math.floor(magnitude / scale);
  const fraction = String(magnitude - whole * scale).padStart(exponent, '0');

  const locale = input.locale ?? cur.value.defaultLocale;
  let parts: Intl.NumberFormatPart[];
  try {
    parts = formatterFor(locale, cur.value.code, exponent).formatToParts(whole);
  } catch {
    parts = formatterFor('en-US', cur.value.code, exponent).formatToParts(whole);
  }

  // Integer part and grouping come from Intl on an exact integer; the fraction
  // digits are substituted from the exact minor units, so nothing is ever rounded.
  const override = SYMBOL_OVERRIDE[cur.value.code];
  let out = '';
  let skipNextSpace = false;
  for (const p of parts) {
    if (p.type === 'fraction') {
      out += fraction;
    } else if (p.type === 'currency' && override !== undefined && /^[A-Z]{3}$|^\$$/.test(p.value)) {
      out += override;
      skipNextSpace = true;
    } else if (p.type === 'literal' && skipNextSpace) {
      skipNextSpace = false; // 'SGD 1.00' becomes 'S$1.00'
    } else {
      out += p.value;
      skipNextSpace = false;
    }
  }

  out = out.replace(SIGN_CHARS, '');
  return ok(input.direction === 'income' ? `+${out}` : out);
}

const plainFormatters = new Map<string, Intl.NumberFormat>();

/** Grouped number with the currency's exact minor digits and no symbol (for spoken labels). */
export function formatPlainNumber(amountMinor: number, currency: string, locale?: string): Result<string, 'AMOUNT_INVALID' | 'CURRENCY_UNSUPPORTED'> {
  const cur = getCurrency(currency);
  if (!cur.ok) return cur;
  if (!Number.isSafeInteger(amountMinor)) return err('AMOUNT_INVALID');
  const exponent = cur.value.exponent;
  const magnitude = Math.abs(amountMinor);
  const scale = 10 ** exponent;
  const whole = Math.floor(magnitude / scale);
  const fraction = String(magnitude - whole * scale).padStart(exponent, '0');
  const loc = locale ?? cur.value.defaultLocale;
  const key = `${loc}|${exponent}`;
  let f = plainFormatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(loc, { minimumFractionDigits: exponent, maximumFractionDigits: exponent, useGrouping: true });
    } catch {
      f = new Intl.NumberFormat('en-US', { minimumFractionDigits: exponent, maximumFractionDigits: exponent, useGrouping: true });
    }
    plainFormatters.set(key, f);
  }
  let out = '';
  for (const part of f.formatToParts(whole)) out += part.type === 'fraction' ? fraction : part.value;
  return ok(out.replace(SIGN_CHARS, ''));
}

