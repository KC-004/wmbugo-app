import type { CurrencyCode } from '@wmbugo/core';
import { minorToInput } from '../minorInput';
import { isAmountsHidden } from '../state/amountsHidden';
import { formatAmount } from '../formatAmount';

/**
 * Money as text inside a sentence or a button label (`Keep ₹80,000`, `₹600 left`). Feature code never formats money itself;
 * this is the shared way to put an amount into a string. Hidden amounts keep the symbol and show four dots, whatever the value.
 */
export function moneyText(minor: number, currency: CurrencyCode, locale: string | undefined, hiddenOverride?: boolean): string {
  const hidden = hiddenOverride ?? isAmountsHidden();
  const f = formatAmount({ amountMinor: hidden ? 0 : minor, currency, direction: 'neutral', ...(locale ? { locale } : {}) });
  if (!f.ok) return '';
  return hidden ? f.value.replace(/[0-9٠-٩۰-۹]+([.,٫٬][0-9٠-٩]+)?/g, '••••').replace(/^([^\s•]+)(•)/, '$1 $2') : f.value;
}

/** An amount in a foreign currency as plain text (`USD 12.99`); masked to `USD ••••` while Hide amounts is on. */
export function foreignMoneyText(currencyCode: string, minor: number, exponent: number, hiddenOverride?: boolean): string {
  return `${currencyCode} ${(hiddenOverride ?? isAmountsHidden()) ? '••••' : minorToInput(minor, exponent)}`;
}
