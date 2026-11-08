import { getCurrency, type CurrencyCode } from './currency';
import { err, ok, type Result } from './result';

/**
 * Money is an integer count of minor units plus the currency and its exponent.
 * There is no float arithmetic anywhere: sums are computed with BigInt and
 * rejected with AMOUNT_TOO_LARGE if they would leave the safe-integer range.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly exponent: number;
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = -MAX;

function inRange(v: bigint): boolean {
  return v >= MIN && v <= MAX;
}

export function makeMoney(
  amountMinor: number,
  currencyCode: string,
): Result<Money, 'AMOUNT_INVALID' | 'AMOUNT_TOO_LARGE' | 'CURRENCY_UNSUPPORTED'> {
  const currency = getCurrency(currencyCode);
  if (!currency.ok) return currency;
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) return err('AMOUNT_INVALID');
  if (!Number.isSafeInteger(amountMinor)) {
    return Number.isInteger(amountMinor) ? err('AMOUNT_TOO_LARGE') : err('AMOUNT_INVALID');
  }
  return ok({
    // Normalise -0 to 0 so equality and formatting are stable.
    amountMinor: amountMinor === 0 ? 0 : amountMinor,
    currency: currency.value.code,
    exponent: currency.value.exponent,
  });
}

/** Adds two minor-unit integers exactly, or AMOUNT_TOO_LARGE if the sum is unsafe. */
export function addMinor(a: number, b: number): Result<number, 'AMOUNT_INVALID' | 'AMOUNT_TOO_LARGE'> {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return err('AMOUNT_INVALID');
  const sum = BigInt(a) + BigInt(b);
  return inRange(sum) ? ok(Number(sum)) : err('AMOUNT_TOO_LARGE');
}

export function subtractMinor(a: number, b: number): Result<number, 'AMOUNT_INVALID' | 'AMOUNT_TOO_LARGE'> {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return err('AMOUNT_INVALID');
  const diff = BigInt(a) - BigInt(b);
  return inRange(diff) ? ok(Number(diff)) : err('AMOUNT_TOO_LARGE');
}

export function addMoney(a: Money, b: Money): Result<Money, 'CURRENCY_MISMATCH' | 'AMOUNT_TOO_LARGE'> {
  if (a.currency !== b.currency) return err('CURRENCY_MISMATCH');
  const sum = addMinor(a.amountMinor, b.amountMinor);
  if (!sum.ok) return err('AMOUNT_TOO_LARGE');
  return ok({ ...a, amountMinor: sum.value === 0 ? 0 : sum.value });
}

export function subtractMoney(a: Money, b: Money): Result<Money, 'CURRENCY_MISMATCH' | 'AMOUNT_TOO_LARGE'> {
  if (a.currency !== b.currency) return err('CURRENCY_MISMATCH');
  const diff = subtractMinor(a.amountMinor, b.amountMinor);
  if (!diff.ok) return err('AMOUNT_TOO_LARGE');
  return ok({ ...a, amountMinor: diff.value === 0 ? 0 : diff.value });
}

export type ParseAmountCode = 'AMOUNT_INVALID' | 'AMOUNT_NEGATIVE' | 'AMOUNT_TOO_LARGE' | 'EXCESS_DECIMALS';

/**
 * Parses keypad text ('.' as the only decimal separator) into exact minor
 * units for a currency exponent. Excess decimals are rejected, never rounded.
 * A leading '-' is AMOUNT_NEGATIVE: callers pass magnitudes and a direction.
 */
export function parseAmountInput(text: string, exponent: number): Result<number, ParseAmountCode> {
  if (typeof text !== 'string' || !Number.isInteger(exponent) || exponent < 0) return err('AMOUNT_INVALID');
  let s = text.trim();
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return err('AMOUNT_INVALID');
  const intPart = m[1] ?? '';
  const fracPart = m[2] ?? '';
  if (intPart === '' && fracPart === '') return err('AMOUNT_INVALID');
  if (negative) return err('AMOUNT_NEGATIVE');
  if (fracPart.length > exponent) return err('EXCESS_DECIMALS');
  const minor = BigInt((intPart === '' ? '0' : intPart) + fracPart.padEnd(exponent, '0'));
  if (minor > MAX) return err('AMOUNT_TOO_LARGE');
  return ok(Number(minor));
}

/**
 * Canonical keypad text for a non-negative minor amount ('1250', exp 2 -> '12.50').
 * This is the inverse of parseAmountInput and is used for the LIR-07 round trip.
 */
export function formatMinorPlain(amountMinor: number, exponent: number): Result<string, 'AMOUNT_INVALID' | 'AMOUNT_NEGATIVE'> {
  if (!Number.isSafeInteger(amountMinor) || !Number.isInteger(exponent) || exponent < 0) return err('AMOUNT_INVALID');
  if (amountMinor < 0) return err('AMOUNT_NEGATIVE');
  const digits = String(amountMinor).padStart(exponent + 1, '0');
  if (exponent === 0) return ok(digits);
  return ok(`${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`);
}
