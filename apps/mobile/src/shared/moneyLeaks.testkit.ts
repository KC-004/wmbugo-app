import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';

/**
 * Test helper for Hide amounts (Story 5.3): every money-looking string a rendered tree shows or speaks. It reads the text of
 * every <Text> and every accessibility label, hint and value. A currency symbol or spoken unit next to a digit is money; so is
 * a digit next to `%` (a ratio of money, which the mask also hides). Dates, counts and days are not.
 */
const MARK = '(?:[₹$£€¥₩₺₱₫₪]|S\\$|R\\$|Rs|CHF|AED|SAR|QAR|BHD|KWD|OMR|MYR|SEK|NOK|DKK|PLN|CZK|HUF|THB|IDR|PHP|VND|INR|USD|EUR|zł|Kč|kr)';
// A mark before the digits (₹5,000, S$12) or after them (5.000,00 €, 1 234 zł).
const SYMBOL = new RegExp(`${MARK}\\s?\\d|\\d[\\d.,\\s]*\\s?${MARK}`);
const SPOKEN = /\d[\d,.]*\s(?:rupees|US dollars|Singapore dollars|Canadian dollars|dollars|pounds|euros|dirhams|riyals|dinars|rials|ringgit|Swiss francs|kronor|kroner|zloty|koruna|forints|baht|rupiah|pesos|dong)/i;
const PERCENT = /\d\s?%/;

export const looksLikeMoney = (s: string): boolean => SYMBOL.test(s) || SPOKEN.test(s) || PERCENT.test(s);

export function moneyLeaks(r: ReactTestRenderer): string[] {
  const found = new Set<string>();
  const add = (v: unknown) => {
    const s = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('') : v;
    if (typeof s === 'string' && s !== '' && looksLikeMoney(s)) found.add(s);
  };
  for (const n of r.root.findAll(() => true)) {
    if (n.type === Text) add(n.props.children);
    if (typeof n.type === 'string') {
      add(n.props.accessibilityLabel);
      add(n.props.accessibilityHint);
      add(n.props.accessibilityValue?.text);
    }
  }
  return [...found];
}
