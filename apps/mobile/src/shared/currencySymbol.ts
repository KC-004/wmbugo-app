import { getCurrency } from '@wmbugo/core';

/** Where Intl prints the bare code or an ambiguous "$", show the short market symbol. */
export const SYMBOL_OVERRIDE: Readonly<Record<string, string>> = { SGD: 'S$' };

/** The currency symbol as shown next to amounts in this locale (S$ for SGD), e.g. for "Singapore · S$ SGD". */
export function currencySymbol(currency: string, locale?: string): string {
  const cur = getCurrency(currency);
  if (!cur.ok) return currency;
  const override = SYMBOL_OVERRIDE[cur.value.code];
  if (override) return override;
  try {
    const parts = new Intl.NumberFormat(locale ?? cur.value.defaultLocale, { style: 'currency', currency: cur.value.code }).formatToParts(1);
    return parts.find((x) => x.type === 'currency')?.value ?? cur.value.code;
  } catch {
    return cur.value.code;
  }
}
