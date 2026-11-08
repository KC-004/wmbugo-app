/**
 * Typed Result: expected failures are values with a named code, never thrown.
 * Each code maps to exactly one copy-catalogue entry in the UI layer.
 */
export type Result<T, C extends string = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: C };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<C extends string>(code: C): Result<never, C> {
  return { ok: false, code };
}

/** Named codes for the money, time and ID primitives (Story 1.4). */
export type PrimitiveErrorCode =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_NEGATIVE'
  | 'AMOUNT_TOO_LARGE'
  | 'EXCESS_DECIMALS'
  | 'CURRENCY_UNSUPPORTED'
  | 'CURRENCY_MISMATCH'
  | 'TIMEZONE_INVALID'
  | 'INSTANT_INVALID';
