import type { OcrResult } from '../../ports/OcrEngine';
import { err, ok, type Result } from '../../shared/result';
import { getCurrency, SUPPORTED_CURRENCIES } from '../../shared/currency';
import { taxIsIncluded } from '../../ledger/allocateReceipt';
import { findAmounts, maskDatesAndTimes, type AmountToken } from './amounts';
import { groupLines, type Line } from './lines';
import type { Certainty, ParseReceiptOptions, ReceiptCharge, ReceiptDraft, ReceiptField, ReceiptItem } from './types';

/** Engine confidence below this makes a field `unsure`. */
export const SURE_CONFIDENCE = 0.8;

const SUBTOTAL = /sub\s*-?\s*total|zwischensumme|sous-total|subtotale|subtotal/i;
const TOTAL = /(?<![\p{L}\d])(grand\s*total|total\s*ttc|amount\s*due|net\s*amount|balance\s*due|to\s*pay|total|summe|gesamt|totale|importe|totaal|gesamtbetrag|gesamtsumme|razem|summa|celkem|összesen|jumlah)(?![\p{L}\d])|المجموع|الإجمالي|الاجمالي|कुल/iu;
/** Words that may stand before a total word on the bill's own total line. Anything else there reads as a product name ("Colgate Total"). */
const TOTAL_LEAD = /^(?:grand|net|bill|invoice|order|final|sales?|food|amount|your|the|payable|rounded|sum|montant|importe|inr|usd|gbp|eur|sgd|myr|aed|rs)$/i;
/**
 * India's split GST words are read even when the engine glues them to a neighbour ("420.00CGST25%", "420@SGST2.%"): there is no word boundary
 * before them then. A letter before them means they are part of another word ("BigStack").
 */
const TAX = /(?<!\p{L})(?:cgst|sgst|igst|utgst)|\b(vat|mwst|tva|iva|hst|gst|cess|sales\s*tax|tax)\b/iu;
/** A fee line starts with its word ("Delivery 2.00", "Service 10%"); "Room service sandwich" is an item. */
const FEE = /^\s*(service|delivery|packing)\b|\bservice\s*charge\b/i;
const DISCOUNT = /\b(discount|savings?|promo|member|rabatt|remise)\b/i;
const ADDRESS = /\b(street|st\.|road|rd\.|avenue|ave\.?|lane|nagar|floor|shop\s*no|plot|po\s*box|suite)\b/i;
const CONTACT = /(@|www\.|https?:|\.com\b|\b(tel|phone|ph|mob|fax|gstin|vat\s*no|trn|tin|ein|cin)\b)/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_FIRST = new Set(['US']);

type Kind = 'subtotal' | 'total' | 'paid' | 'tax' | 'fee' | 'discount' | 'info' | 'generic';
/** "Total savings", "Total VAT" and the like are tallies, not the bill total: they are read for nothing. */
const TALLY = /total\s+(savings?|saved|vat|tax|gst|discount|items?|qty|quantity|sales\s*tax)\b/i;

interface Row {
  readonly line: Line;
  readonly index: number;
  readonly kind: Kind;
  readonly amounts: AmountToken[];
  readonly latinLetters: number;
  readonly otherLetters: number;
}

const letterStats = (text: string): { latin: number; other: number } => {
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    if (/\p{Script=Latin}/u.test(ch)) latin++;
    else other++;
  }
  return { latin, other };
};

/** What was handed over. It is the bill total only when no other total is printed. */
const PAID = /total\s+(paid|tendered|received)\b/i;
const ROUNDING = /\bround(ing|ed)?\s*(off|adj)/i;

const classify = (text: string): Kind => {
  if (TALLY.test(text)) return 'info';
  if (PAID.test(text)) return 'paid';
  if (SUBTOTAL.test(text)) return 'subtotal';
  if (TOTAL.test(text)) return 'total';
  if (TAX.test(text)) return 'tax';
  if (FEE.test(text)) return 'fee';
  if (DISCOUNT.test(text)) return 'discount';
  return 'generic';
};

const certaintyOf = (confidence: number | null): Certainty => (confidence !== null && confidence < SURE_CONFIDENCE ? 'unsure' : 'sure');
const missing = <T>(): ReceiptField<T> => ({ value: null, certainty: 'missing' });
const pad = (n: number): string => String(n).padStart(2, '0');

const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const validDate = (y: number, m: number, d: number): boolean => m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);

/** Whether a total word stands with at most the usual words before it. */
const plainTotal = (text: string): boolean => {
  const at = TOTAL.exec(text);
  if (!at) return false;
  return (text.slice(0, at.index).match(/\p{L}+/gu) ?? []).every((w) => TOTAL_LEAD.test(w));
};

/**
 * A total word inside a product name is an item when the bill's own total or subtotal is printed further down. A paid line counts as the
 * total only when it is the only one.
 */
const settleKinds = (rows: readonly Row[]): Row[] => {
  const anchors = rows.filter((r) => r.amounts.length > 0 && (r.kind === 'subtotal' || (r.kind === 'total' && plainTotal(r.line.text))));
  const lastAnchor = anchors.length > 0 ? anchors[anchors.length - 1]!.index : -1;
  const hasTotal = rows.some((r) => r.amounts.length > 0 && r.kind === 'total');
  return rows.map((r): Row => {
    if (r.kind === 'total' && r.index < lastAnchor && !plainTotal(r.line.text)) return { ...r, kind: 'generic' };
    if (r.kind === 'paid') return { ...r, kind: hasTotal ? 'info' : 'total' };
    return r;
  });
};

/**
 * Where the items end: at the block of tax, fee and rounding lines that leads into the first subtotal or total. A fee printed between two
 * items therefore does not cut the list. With neither, the first tax or fee line ends it.
 */
const itemsEnd = (rows: readonly Row[]): number => {
  let at = rows.findIndex((r) => r.amounts.length > 0 && (r.kind === 'subtotal' || r.kind === 'total'));
  if (at === -1) {
    const charge = rows.findIndex((r) => r.amounts.length > 0 && (r.kind === 'tax' || r.kind === 'fee'));
    return charge === -1 ? rows.length : charge;
  }
  while (at > 0) {
    const prev = rows[at - 1]!;
    if (!(prev.kind === 'tax' || prev.kind === 'fee' || prev.kind === 'info' || ROUNDING.test(prev.line.text))) break;
    at--;
  }
  return at;
};

/** A printed label with the amount stripped, for tax, fee and discount rows. */
const labelOf = (line: Line, tok: AmountToken | undefined): string => {
  const masked = tok ? line.text.slice(0, tok.start) : line.text;
  return masked.replace(/[:\-–]+\s*$/, '').replace(/\s+/g, ' ').trim() || line.text.trim();
};

function readDate(rows: readonly Row[], region: string): ReceiptField<string> {
  for (const r of rows) {
    const t = r.line.text;
    const iso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(t);
    if (iso) {
      const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
      if (validDate(y, m, d)) return { value: `${y}-${pad(m)}-${pad(d)}`, certainty: certaintyOf(r.line.confidence) };
    }
    const num = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(t);
    if (num) {
      const a = Number(num[1]);
      const b = Number(num[2]);
      const y = num[3]!.length === 2 ? 2000 + Number(num[3]) : Number(num[3]);
      const mdy = MONTH_FIRST.has(region.toUpperCase());
      const [first, second] = mdy ? [{ m: a, d: b }, { m: b, d: a }] : [{ m: b, d: a }, { m: a, d: b }];
      const ok1 = validDate(y, first.m, first.d);
      const ok2 = validDate(y, second.m, second.d);
      const pick = ok1 ? first : ok2 ? second : null;
      if (pick) {
        const bothWays = ok1 && ok2 && a !== b;
        const ambiguous = region.toUpperCase() === 'CA' && bothWays;
        const sure = certaintyOf(r.line.confidence) === 'sure' && !ambiguous;
        return { value: `${y}-${pad(pick.m)}-${pad(pick.d)}`, certainty: sure ? 'sure' : 'unsure' };
      }
    }
    const word = /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/.exec(t);
    if (word) {
      const m = MONTHS.indexOf(word[2]!.toLowerCase()) + 1;
      const [d, y] = [Number(word[1]), Number(word[3])];
      if (m > 0 && validDate(y, m, d)) return { value: `${y}-${pad(m)}-${pad(d)}`, certainty: certaintyOf(r.line.confidence) };
    }
  }
  return missing();
}

function readTime(rows: readonly Row[]): ReceiptField<string> {
  for (const r of rows) {
    if (/\b(open|hours|daily)\b|\d:\d\d\s*-\s*\d{1,2}:\d\d/i.test(r.line.text)) continue; // opening hours, not the time of sale
    const m = /\b(0?\d|1\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*([ap]\.?m\.?)?/i.exec(r.line.text);
    if (m) {
      let hour = Number(m[1]);
      const meridiem = m[3]?.[0]?.toLowerCase();
      if (meridiem === 'p' && hour < 12) hour += 12;
      else if (meridiem === 'a' && hour === 12) hour = 0;
      return { value: `${pad(hour)}:${m[2]}`, certainty: certaintyOf(r.line.confidence) };
    }
  }
  return missing();
}

function readMerchant(rows: readonly Row[], height: number): ReceiptField<string> {
  for (const r of rows) {
    if (Number.isFinite(height) && height > 0 && r.line.top >= height / 5) break;
    if (r.amounts.length > 0) continue; // a line with a price is an item, not the shop name
    const text = r.line.text.trim();
    const nonSpace = text.replace(/\s/g, '').length;
    if (nonSpace === 0 || r.latinLetters < 3 || r.otherLetters > r.latinLetters) continue;
    if ((r.latinLetters + r.otherLetters) / nonSpace < 0.6) continue;
    if (!/\p{L}{3,}/u.test(text) || CONTACT.test(text) || (ADDRESS.test(text) && /\d/.test(text)) || /\d{5,}/.test(text)) continue;
    if (r.kind !== 'generic' || /\b(date|datum|time|invoice|receipt|bill)\b/i.test(text)) continue;
    return { value: text, certainty: certaintyOf(r.line.confidence) };
  }
  return missing();
}

/**
 * Reads merchant, date, items, charges and total from what the engine saw (Story 10.2). Pure and offline: every amount is exact minor
 * units, every field says how sure it is, and anything that is not a Latin-script name or a Western-numeral amount is left unread.
 */
export function parseReceipt(ocr: OcrResult, opts: ParseReceiptOptions): Result<ReceiptDraft, 'UNREADABLE'> {
  const currency = getCurrency(opts.profileCurrency);
  const exponent = currency.ok ? currency.value.exponent : 2;
  const lines = groupLines(ocr.blocks, ocr.width, ocr.height);
  if (lines.length === 0) return err('UNREADABLE');

  const classified: Row[] = lines.map((line, index) => {
    const { latin, other } = letterStats(line.text);
    return { line, index, kind: classify(line.text), amounts: findAmounts(line.text, exponent, opts.region), latinLetters: latin, otherLetters: other };
  });
  if (!classified.some((r) => r.amounts.length > 0)) return err('UNREADABLE');

  const rows = settleKinds(classified);
  const itemEnd = itemsEnd(rows);
  const firstTotal = rows.findIndex((r) => r.amounts.length > 0 && r.kind === 'total');

  const items: ReceiptItem[] = [];
  const itemDiscounts = new Map<number, number>();
  const taxes: ReceiptCharge[] = [];
  const fees: ReceiptCharge[] = [];
  const discounts: ReceiptCharge[] = [];
  const totals: { minor: number; certainty: Certainty }[] = [];
  let subtotal: ReceiptField<number> = missing();
  let unparsed = 0;

  const isItemRow = (r: Row | undefined): boolean => !!r && r.index < itemEnd && r.kind === 'generic' && r.amounts.length > 0 && r.amounts[r.amounts.length - 1]!.minor > 0 && r.latinLetters >= 2 && r.otherLetters <= r.latinLetters;

  for (const r of rows) {
    const tok = r.amounts[r.amounts.length - 1];
    const conf = certaintyOf(r.line.confidence);
    if (!tok) continue;
    switch (r.kind) {
      case 'info':
        break;
      case 'subtotal':
        subtotal = { value: Math.abs(tok.minor), certainty: conf };
        break;
      case 'total':
        totals.push({ minor: Math.abs(tok.minor), certainty: conf });
        break;
      case 'tax':
        taxes.push({ label: labelOf(r.line, tok), value: Math.abs(tok.minor), certainty: conf });
        break;
      case 'fee':
        fees.push({ label: labelOf(r.line, tok), value: Math.abs(tok.minor), certainty: conf });
        break;
      case 'discount': {
        const prev = rows[r.index - 1];
        // A keyword discount under an item is that item's discount only when another item row follows it.
        if (r.index < itemEnd + 1 && isItemRow(prev) && isItemRow(rows[r.index + 1])) itemDiscounts.set(r.index, Math.abs(tok.minor));
        else {
          discounts.push({ label: labelOf(r.line, tok), value: Math.abs(tok.minor), certainty: conf });
        }
        break;
      }
      default: {
        if (tok.minor < 0 && r.index < itemEnd + 1) {
          const prev = rows[r.index - 1];
          if (isItemRow(prev)) itemDiscounts.set(r.index, -tok.minor);
          else discounts.push({ label: labelOf(r.line, tok), value: -tok.minor, certainty: conf });
        } else if (tok.minor < 0 && r.index < firstTotal) {
          // A coupon or voucher between the subtotal and the total, printed without a discount word.
          discounts.push({ label: labelOf(r.line, tok), value: -tok.minor, certainty: conf });
        } else if (isItemRow(r)) {
          const before = r.line.text.slice(0, tok.start);
          let name = before.replace(/\s*[x×]\s*\d+\s*$/i, '');
          for (;;) {
            const stripped = name.replace(/\s+[\d.,]+\s*$/, '');
            if (stripped === name) break;
            name = stripped;
          }
          name = name.replace(/[\s:.\-–]+$/, '').trim();
          if (name !== '' && /\p{Script=Latin}{2}/u.test(name)) items.push({ name, amountMinor: tok.minor, discountMinor: 0, lineIndex: r.index, certainty: conf });
          else unparsed++;
        } else unparsed++;
      }
    }
  }
  // Attach item discounts to the item printed directly above.
  const itemsWithDiscount: ReceiptItem[] = items.map((it) => {
    for (const [lineIndex, amount] of itemDiscounts) {
      const prevIndex = lineIndex - 1;
      if (prevIndex === it.lineIndex) return { ...it, discountMinor: it.discountMinor + amount };
    }
    return it;
  });

  const itemsNet = itemsWithDiscount.reduce((s, i) => s + i.amountMinor - i.discountMinor, 0);

  const sum = (charges: readonly ReceiptCharge[]): number => charges.reduce((s, c) => s + c.value, 0);

  // Total: the last amount on a line with a total keyword; two different candidates, or a sum that does not add up, make it unsure.
  let total: ReceiptField<number>;
  if (totals.length > 0) {
    const last = totals[totals.length - 1]!;
    let certainty: Certainty = last.certainty;
    if (new Set(totals.map((t) => t.minor)).size > 1) certainty = 'unsure';
    const base = subtotal.value ?? (itemsWithDiscount.length > 0 ? itemsNet : null);
    if (base !== null) {
      const expected = base + taxes.reduce((s, t) => s + t.value, 0) + fees.reduce((s, t) => s + t.value, 0) - discounts.reduce((s, t) => s + t.value, 0);
      // Prices that already include the tax add up to the total without it.
      const included = itemsWithDiscount.length > 0 && taxes.length > 0 && taxIsIncluded(itemsNet, sum(fees), sum(discounts), last.minor);
      if (expected !== last.minor && !included) certainty = 'unsure';
    }
    total = { value: last.minor, certainty };
  } else if (itemsWithDiscount.length > 0) total = { value: itemsNet, certainty: 'unsure' };
  else total = missing();

  let currencyField: ReceiptField<string> = { value: opts.profileCurrency, certainty: 'sure' };
  const text = maskDatesAndTimes(lines.map((l) => l.text).join(' '));
  const codes = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => new RegExp(`\\b${c}\\b`).test(text));
  if (codes.length > 0 && !codes.includes(opts.profileCurrency as never)) currencyField = { value: codes[0]!, certainty: 'unsure' };

  const draft: ReceiptDraft = {
    merchant: readMerchant(rows, ocr.height),
    date: readDate(rows, opts.region),
    time: readTime(rows),
    currency: currencyField,
    subtotal,
    taxes,
    fees,
    discounts,
    total,
    items: itemsWithDiscount,
    unparsedLineCount: unparsed,
  };
  return ok(draft);
}
