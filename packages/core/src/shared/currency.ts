import { err, ok, type Result } from './result';

/**
 * Phase 1 currency table (PRD §13.0a). Exponent follows ISO 4217, except IDR
 * and HUF, which are stored, shown and accepted as whole units (exponent 0).
 * Adding a currency is a row here plus an INTL test row, not a code change.
 */
const ROWS = [
  ['INR', 2, 'en-IN'],
  ['USD', 2, 'en-US'],
  ['CAD', 2, 'en-CA'],
  ['GBP', 2, 'en-GB'],
  ['EUR', 2, 'de-DE'],
  ['AED', 2, 'en-AE'],
  ['SAR', 2, 'en-SA'],
  ['QAR', 2, 'en-QA'],
  ['BHD', 3, 'en-BH'],
  ['KWD', 3, 'en-KW'],
  ['OMR', 3, 'en-OM'],
  ['SGD', 2, 'en-SG'],
  ['MYR', 2, 'en-MY'],
  ['CHF', 2, 'de-CH'],
  ['SEK', 2, 'sv-SE'],
  ['NOK', 2, 'nb-NO'],
  ['DKK', 2, 'da-DK'],
  ['PLN', 2, 'pl-PL'],
  ['CZK', 2, 'cs-CZ'],
  ['HUF', 0, 'hu-HU'],
  ['THB', 2, 'th-TH'],
  ['IDR', 0, 'id-ID'],
  ['PHP', 2, 'en-PH'],
  ['VND', 0, 'vi-VN'],
] as const;

export type CurrencyCode = (typeof ROWS)[number][0];

export interface Currency {
  readonly code: CurrencyCode;
  /** Number of minor-unit decimal digits stored for this currency. */
  readonly exponent: number;
  readonly defaultLocale: string;
}

const TABLE: ReadonlyMap<string, Currency> = new Map(
  ROWS.map(([code, exponent, defaultLocale]) => [code, { code, exponent, defaultLocale }]),
);

export const SUPPORTED_CURRENCIES: readonly Currency[] = [...TABLE.values()];

/** Looks a currency up by ISO code. Unknown codes return CURRENCY_UNSUPPORTED. */
export function getCurrency(code: string): Result<Currency, 'CURRENCY_UNSUPPORTED'> {
  const found = TABLE.get(code);
  return found ? ok(found) : err('CURRENCY_UNSUPPORTED');
}
