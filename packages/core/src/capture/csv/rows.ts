import { getCurrency } from '../../shared/currency';
import { normalizeMerchant } from '../../shared/merchant';
import { parseCsvAmount } from './amount';
import type { CsvMapping } from './mapping';
import { parseCsvDate } from './date';
import type { CsvDataRow } from './read';

/**
 * Turning rows into candidates and checking every one before anything is saved (Story 9.2, IMP-002, IMP-003). A bad row gets its own
 * errors, with a fixed code and copy, and never stops the others.
 */
export type CsvRowErrorCode = 'INVALID_DATE' | 'INVALID_AMOUNT' | 'MISSING_AMOUNT' | 'BOTH_DEBIT_AND_CREDIT' | 'UNKNOWN_CURRENCY' | 'UNMAPPED_ACCOUNT';

export interface CsvRowError {
  readonly code: CsvRowErrorCode;
  /** The cell text that was wrong, for the message. */
  readonly value?: string;
  /** The copy shown against the row. */
  readonly message: string;
}

const rowError = (code: CsvRowErrorCode, value?: string): CsvRowError => {
  const v = value ?? '';
  switch (code) {
    case 'INVALID_DATE':
      return { code, value: v, message: `Date "${v}" isn't a real date` };
    case 'INVALID_AMOUNT':
      return { code, value: v, message: `Amount "${v}" isn't a number` };
    case 'MISSING_AMOUNT':
      return { code, message: 'No amount in this row' };
    case 'BOTH_DEBIT_AND_CREDIT':
      return { code, message: 'This row has both a debit and a credit' };
    case 'UNKNOWN_CURRENCY':
      return { code, value: v, message: `"${v}" isn't a currency wmbugo knows` };
    case 'UNMAPPED_ACCOUNT':
      return { code, value: v, message: `No account chosen for "${v}"` };
  }
};

export interface CsvProfile {
  /** The profile currency (an ISO code the app supports). */
  readonly currency: string;
  readonly timezoneId: string;
}

/** Where the rows go: one account for the whole file, or the file's own `account` column mapped value by value. */
export type CsvAccountChoice =
  | { readonly kind: 'single'; readonly accountId: string }
  /** `null` means `Don't import these rows`. A value with no entry is `UNMAPPED_ACCOUNT`. */
  | { readonly kind: 'column'; readonly map: Readonly<Record<string, string | null>> };

export interface CsvCandidate {
  /** The row's 1-based position in the file. */
  readonly row: number;
  readonly direction: 'out' | 'in';
  /** Unsigned minor units, in the row's own currency. */
  readonly amountMinor: number;
  readonly localDate: string;
  /** Present when the row carried a time of day. */
  readonly instantMs?: number;
  /** As written. */
  readonly description: string;
  /** Story 3.1 normalizer, from the merchant column or else the description. */
  readonly merchant: string;
  readonly reference?: string;
  readonly categoryName?: string;
  /** The row's currency code, always set; `foreign` says it differs from the profile's. */
  readonly currency: string;
  readonly foreign: boolean;
  /** The account the row goes to (null when the account column maps it to `Don't import these rows`). */
  readonly accountId: string | null;
  /** The raw value in the account column, if there is one. */
  readonly accountValue?: string;
  /** The balance after the row, signed, when a balance column parses. */
  readonly balanceMinor?: number;
}

const cell = (cells: readonly string[], i: number | undefined): string => (i === undefined ? '' : (cells[i] ?? '').trim());

/** The `HH:mm[:ss]` of a time column joined to the date cell, when the date has none of its own. */
function dateText(cells: readonly string[], mapping: CsvMapping): string {
  const d = cell(cells, mapping.columns.date);
  const t = cell(cells, mapping.columns.time);
  return t === '' || /\d:\d{2}/.test(d) ? d : `${d} ${t}`;
}

/**
 * One row to a candidate, or the errors that stop it being one. With `debit` and `credit` columns a value in `debit` is money out and
 * in `credit` money in; with a signed `amount` a negative value is money out. `flipSign` swaps the direction either way.
 */
export function normalizeCsvRow(
  row: CsvDataRow,
  mapping: CsvMapping,
  profile: CsvProfile,
  account?: CsvAccountChoice,
): { candidate: CsvCandidate | null; errors: CsvRowError[] } {
  const errors: CsvRowError[] = [];
  const c = row.cells;
  const cols = mapping.columns;

  // The currency decides how many decimals the amount has.
  const rawCurrency = cell(c, cols.currency).toUpperCase();
  const profileCurrency = getCurrency(profile.currency);
  let currencyCode = profile.currency.toUpperCase();
  let exponent = profileCurrency.ok ? profileCurrency.value.exponent : 2;
  let foreign = false;
  if (rawCurrency !== '') {
    const known = getCurrency(rawCurrency);
    if (!known.ok) errors.push(rowError('UNKNOWN_CURRENCY', cell(c, cols.currency)));
    else {
      currencyCode = known.value.code;
      exponent = known.value.exponent;
      foreign = known.value.code !== (profileCurrency.ok ? profileCurrency.value.code : currencyCode);
    }
  }

  // Date.
  const dText = dateText(c, mapping);
  let localDate = '';
  let instantMs: number | undefined;
  if (mapping.dateFormat === null) errors.push(rowError('INVALID_DATE', dText));
  else {
    const d = parseCsvDate(dText, mapping.dateFormat, profile.timezoneId);
    if (!d.ok) errors.push(rowError('INVALID_DATE', dText));
    else {
      localDate = d.value.localDate;
      instantMs = d.value.instantMs;
    }
  }

  // Amount and direction.
  let amountMinor = 0;
  let direction: 'out' | 'in' = 'out';
  const style = mapping.numberStyle;
  if (cols.debit !== undefined && cols.credit !== undefined) {
    const debitText = cell(c, cols.debit);
    const creditText = cell(c, cols.credit);
    const debit = debitText === '' ? null : parseCsvAmount(debitText, style, exponent);
    const credit = creditText === '' ? null : parseCsvAmount(creditText, style, exponent);
    if (debit && !debit.ok) errors.push(rowError('INVALID_AMOUNT', debitText));
    else if (credit && !credit.ok) errors.push(rowError('INVALID_AMOUNT', creditText));
    else {
      const d = debit && debit.ok ? Math.abs(debit.value) : 0;
      const k = credit && credit.ok ? Math.abs(credit.value) : 0;
      if (d > 0 && k > 0) errors.push(rowError('BOTH_DEBIT_AND_CREDIT'));
      else if (d === 0 && k === 0) errors.push(rowError('MISSING_AMOUNT'));
      else {
        amountMinor = d > 0 ? d : k;
        direction = d > 0 ? 'out' : 'in';
      }
    }
  } else if (cols.amount !== undefined) {
    const text = cell(c, cols.amount);
    if (text === '') errors.push(rowError('MISSING_AMOUNT'));
    else {
      const a = parseCsvAmount(text, style, exponent);
      if (!a.ok) errors.push(rowError('INVALID_AMOUNT', text));
      else if (a.value === 0) errors.push(rowError('MISSING_AMOUNT'));
      else {
        amountMinor = Math.abs(a.value);
        direction = a.value < 0 ? 'out' : 'in';
      }
    }
  } else errors.push(rowError('MISSING_AMOUNT'));
  if (mapping.flipSign) direction = direction === 'out' ? 'in' : 'out';

  // Account.
  let accountId: string | null = null;
  const accountValue = cols.account === undefined ? undefined : cell(c, cols.account);
  if (account?.kind === 'single') accountId = account.accountId;
  else if (account?.kind === 'column') {
    const key = accountValue ?? '';
    if (Object.prototype.hasOwnProperty.call(account.map, key)) accountId = account.map[key] ?? null;
    else errors.push(rowError('UNMAPPED_ACCOUNT', key));
  }

  if (errors.length > 0) return { candidate: null, errors };

  const description = cell(c, cols.description);
  const merchantText = cell(c, cols.merchant);
  const reference = cell(c, cols.reference);
  const category = cell(c, cols.category);
  let balanceMinor: number | undefined;
  const balanceText = cell(c, cols.balance);
  if (balanceText !== '') {
    const b = parseCsvAmount(balanceText, style, exponent);
    if (b.ok) balanceMinor = b.value;
  }
  return {
    candidate: {
      row: row.row,
      direction,
      amountMinor,
      localDate,
      ...(instantMs === undefined ? {} : { instantMs }),
      description,
      merchant: normalizeMerchant(merchantText !== '' ? merchantText : description),
      ...(reference === '' ? {} : { reference }),
      ...(category === '' ? {} : { categoryName: category }),
      currency: currencyCode,
      foreign,
      accountId,
      ...(accountValue === undefined ? {} : { accountValue }),
      ...(balanceMinor === undefined ? {} : { balanceMinor }),
    },
    errors: [],
  };
}

export interface ValidatedRow {
  readonly row: number;
  readonly candidate: CsvCandidate | null;
  readonly errors: readonly CsvRowError[];
  /** True when the account column maps this row to `Don't import these rows`: it is neither imported nor an error. */
  readonly skipped: boolean;
}

export type CsvFileWarning = 'SIGN_LOOKS_REVERSED' | 'SIGN_CONFIRMED';
export const SIGN_LOOKS_REVERSED_COPY = 'Amounts look reversed: payments out should lower the balance.';

export interface CsvValidation {
  readonly rows: readonly ValidatedRow[];
  /** At most one: the balance column either contradicts the signs or agrees with every checkable pair. */
  readonly warning: CsvFileWarning | null;
  readonly okCount: number;
  readonly errorCount: number;
  readonly skippedCount: number;
  /** The distinct values of the `account` column, in file order, for the caller to map. */
  readonly accountValues: readonly string[];
}

/** Whether the running balance agrees with the signs, in whichever order the statement is written (oldest or newest first). */
function signWarning(rows: readonly ValidatedRow[]): CsvFileWarning | null {
  const usable = rows.filter((r): r is ValidatedRow & { candidate: CsvCandidate } => r.candidate !== null && r.candidate.balanceMinor !== undefined);
  const signed = (c: CsvCandidate) => (c.direction === 'in' ? c.amountMinor : -c.amountMinor);
  let forward = 0;
  let backward = 0;
  let total = 0;
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1]!.candidate;
    const cur = usable[i]!.candidate;
    const delta = cur.balanceMinor! - prev.balanceMinor!;
    if (delta === 0) continue;
    total += 1;
    if (Math.sign(delta) === Math.sign(signed(cur))) forward += 1;
    if (Math.sign(-delta) === Math.sign(signed(prev))) backward += 1;
  }
  if (total === 0) return null;
  const agree = Math.max(forward, backward);
  if (agree === total) return 'SIGN_CONFIRMED';
  return total - agree > total / 2 ? 'SIGN_LOOKS_REVERSED' : null;
}

/** Validates every row against the mapping (IMP-003). Rows are independent: one error never stops another from validating. */
export function validateCsvRows(rows: readonly CsvDataRow[], mapping: CsvMapping, profile: CsvProfile, account?: CsvAccountChoice): CsvValidation {
  const out: ValidatedRow[] = [];
  const accountValues: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (mapping.columns.account !== undefined) {
      const v = cell(row.cells, mapping.columns.account);
      if (!seen.has(v)) {
        seen.add(v);
        accountValues.push(v);
      }
    }
    const { candidate, errors } = normalizeCsvRow(row, mapping, profile, account);
    out.push({ row: row.row, candidate, errors, skipped: candidate !== null && candidate.accountId === null && account?.kind === 'column' });
  }
  return {
    rows: out,
    warning: signWarning(out),
    okCount: out.filter((r) => r.candidate !== null && !r.skipped).length,
    errorCount: out.filter((r) => r.errors.length > 0).length,
    skippedCount: out.filter((r) => r.skipped).length,
    accountValues,
  };
}
