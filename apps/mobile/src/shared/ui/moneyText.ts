import type { CurrencyCode } from '@wmbugo/core';
import { formatAmount } from '../formatAmount';

/**
 * Money as text inside a sentence or a button label (`Keep ₹80,000`, `₹600 left`). Feature code never formats money itself;
 * this is the shared way to put an amount into a string. Hidden amounts keep the symbol and show four dots, whatever the value.
 */
export function moneyText(minor: number, currency: CurrencyCode, locale: string | undefined, hidden = false): string {
  const f = formatAmount({ amountMinor: hidden ? 0 : minor, currency, direction: 'neutral', ...(locale ? { locale } : {}) });
  if (!f.ok) return '';
  return hidden ? f.value.replace(/[0-9٠-٩۰-۹]+([.,٫٬][0-9٠-٩]+)?/g, '••••').replace(/^([^\s•]+)(•)/, '$1 $2') : f.value;
}
