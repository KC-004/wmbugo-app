/**
 * The merchant normalizer (LRN-009 rule). Duplicate matching and, later, learning compare merchants by this key, so
 * `SWIGGY*BLR 8821`, `Swiggy` and `SWIGGY  ORDER 4410` are all `swiggy`.
 *
 * Steps: lowercase and trim; keep what is before a `*` gateway separator; strip a leading gateway or rail prefix
 * (`upi-`, `pos `, `paytm*` ...); drop trailing reference numbers, city codes and filler words; collapse whitespace.
 */

const GATEWAY_PREFIXES = new Set(['upi', 'pos', 'ecom', 'ib', 'neft', 'imps', 'rtgs', 'paytm', 'razorpay', 'payu', 'bdsk', 'cc', 'dc', 'atm', 'nach']);
const CITY_CODES = new Set(['blr', 'bom', 'mum', 'del', 'hyd', 'maa', 'chn', 'ccu', 'kol', 'pun', 'pnq', 'ahd', 'jai', 'goa', 'gur', 'noi', 'sin', 'sg']);
const FILLER = new Set(['order', 'ord', 'ref', 'txn', 'trx', 'payment', 'pmt', 'no', 'id', 'bill', 'invoice', 'inv']);

const isNumberish = (t: string) => /^[#]?\d{2,}[a-z]?$/.test(t) || /^\d{2,}-\d+$/.test(t);

export function normalizeMerchant(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  if (s === '') return '';

  // "paytm*swiggy" has the merchant after the gateway; "swiggy*blr 8821" has the city after the merchant.
  const star = s.split('*').map((p) => p.trim()).filter((p) => p !== '');
  if (star.length > 1) s = GATEWAY_PREFIXES.has(star[0]!) ? star.slice(1).join(' ').split('*')[0]! : star[0]!;
  else if (star.length === 1) s = star[0]!;

  // Leading rail or gateway words, with "-", "/" or a space after them.
  let tokens = s.split(/[\s\-/]+/).filter((t) => t !== '');
  while (tokens.length > 1 && GATEWAY_PREFIXES.has(tokens[0]!)) tokens = tokens.slice(1);

  // Trailing reference numbers, city codes and filler.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    if (isNumberish(last) || CITY_CODES.has(last) || FILLER.has(last)) tokens = tokens.slice(0, -1);
    else break;
  }
  return tokens.join(' ').trim();
}
