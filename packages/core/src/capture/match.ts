import { normalizeMerchant } from './merchant';

/**
 * The duplicate matcher (FIN-027, AD-6 match stage). Pure: no storage, no clock, no randomness. The same inputs always
 * give the same outcome, whatever order the existing items are listed in.
 */

export type Direction = 'debit' | 'credit';
export type MatchSource = 'manual' | 'receipt' | 'card' | 'bank' | 'upi' | 'sms' | 'csv';

export interface CaptureItem {
  readonly id: string;
  /** The payment reference (UPI reference, card RRN ...). null when the source has none. */
  readonly reference: string | null;
  readonly direction: Direction;
  readonly eventType: 'expense' | 'income' | 'transfer' | 'refund';
  readonly amountMinor: number;
  /** Local date, yyyy-mm-dd. */
  readonly localDate: string;
  readonly occurredAtMs: number;
  /** As reported; compared through `normalizeMerchant`. */
  readonly merchant: string | null;
  /** The owned account the money left or landed in; null when unknown. */
  readonly accountId: string | null;
  /** Free text from the source ("reversed", "refund", "failed" ...). */
  readonly text?: string | null;
  readonly source: MatchSource;
  /** CSV only: the file the row came from. Rows of one file never match each other. */
  readonly fileId?: string;
  /** CSV only: 0 for the first identical (date, amount, description) row, 1 for the next, ... */
  readonly occurrence?: number;
}

export interface Tombstone {
  readonly reference: string | null;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchantKey: string;
}

export type MatchOutcome =
  | { readonly kind: 'no_match' }
  | { readonly kind: 'duplicate_of'; readonly id: string }
  | { readonly kind: 'possible_duplicate_of'; readonly id: string }
  | { readonly kind: 'reversal_or_refund_of'; readonly id: string }
  | { readonly kind: 'transfer_pair_with'; readonly id: string }
  | { readonly kind: 'held_pair'; readonly id: string | null; readonly question: string }
  | { readonly kind: 'previously_removed' };

export const HELD_PAIR_QUESTION = 'Reversal, or a transfer between your accounts?';
/** A row whose day is only partly covered by its file may or may not already be recorded. */
export const PARTIAL_DAY_QUESTION = 'This day is only partly in the file. Is it already recorded?';

export interface MatchContext {
  /** Accounts the user owns. Only these can be one side of a transfer pair. */
  readonly ownedAccountIds: ReadonlySet<string>;
  /** Items the user removed on purpose (Story 3.12). */
  readonly tombstones?: readonly Tombstone[];
  /** CSV: local dates at the start or end of the file that the file covers only partly. */
  readonly partialDays?: ReadonlySet<string>;
}

const DAY_MS = 86_400_000;
const MANUAL_WINDOW_MS = 10 * 60_000;
const REVERSAL_TEXT = /\b(revers(?:ed|al)|refund(?:ed)?|failed)\b/i;

/** Whole days between two yyyy-mm-dd dates (absolute). */
export function daysApart(a: string, b: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.abs(Math.round((t(a) - t(b)) / DAY_MS));
}

/** How far apart a debit and a credit on two of the user's accounts may be and still be proposed as one transfer. */
export function transferPairWindowDays(source: MatchSource): number {
  return source === 'csv' ? 2 : 3;
}

/** The Nth identical (date, amount, description) row gets index N, so identical rows stay distinct. */
export function assignOccurrenceIndex(rows: readonly { readonly localDate: string; readonly amountMinor: number; readonly description: string }[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.localDate}|${r.amountMinor}|${r.description.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n;
  });
}

type Candidate = { rank: number; outcome: Exclude<MatchOutcome, { kind: 'no_match' } | { kind: 'previously_removed' }> };

const opposite = (a: Direction, b: Direction) => a !== b;

/** A receipt is matched to the card or bank charge for it, which may carry a tip or a fee: 0 to 30% higher. */
function amountsMatch(item: CaptureItem, other: CaptureItem): boolean {
  if (item.amountMinor === other.amountMinor) return true;
  const receiptVsCharge = (r: CaptureItem, c: CaptureItem) => r.source === 'receipt' && (c.source === 'card' || c.source === 'bank') && c.amountMinor > r.amountMinor && c.amountMinor * 10 <= r.amountMinor * 13;
  return receiptVsCharge(item, other) || receiptVsCharge(other, item);
}

function compare(item: CaptureItem, other: CaptureItem, ctx: MatchContext): Candidate | null {
  // Rows of one CSV file are never matched against each other or against rows already committed from it.
  if (item.fileId !== undefined && item.fileId === other.fileId) return null;
  if (item.id === other.id) return null;

  const bothRefs = item.reference !== null && other.reference !== null;

  if (bothRefs && item.reference === other.reference) {
    if (item.direction === other.direction && item.eventType === other.eventType) return { rank: 1, outcome: { kind: 'duplicate_of', id: other.id } };
    if (opposite(item.direction, other.direction)) {
      const debit = item.direction === 'debit' ? item : other;
      const credit = item.direction === 'credit' ? item : other;
      const said = REVERSAL_TEXT.test(`${item.text ?? ''} ${other.text ?? ''}`);
      if (said || (credit.accountId !== null && credit.accountId === debit.accountId)) return { rank: 2, outcome: { kind: 'reversal_or_refund_of', id: other.id } };
      if (credit.accountId === null) return { rank: 4, outcome: { kind: 'held_pair', id: other.id, question: HELD_PAIR_QUESTION } };
      if (debit.accountId !== null && ctx.ownedAccountIds.has(credit.accountId) && ctx.ownedAccountIds.has(debit.accountId)) {
        return { rank: 3, outcome: { kind: 'transfer_pair_with', id: other.id } };
      }
      return { rank: 4, outcome: { kind: 'held_pair', id: other.id, question: HELD_PAIR_QUESTION } };
    }
    return null;
  }
  // Two different references are two different payments, whatever the amount, date or merchant.
  // (A debit and a credit on two of the user's accounts may still be one transfer, below.)

  // A debit and a credit, equal amounts, on two different owned accounts, near in time: one transfer.
  if (
    opposite(item.direction, other.direction) &&
    item.amountMinor === other.amountMinor &&
    item.accountId !== null &&
    other.accountId !== null &&
    item.accountId !== other.accountId &&
    ctx.ownedAccountIds.has(item.accountId) &&
    ctx.ownedAccountIds.has(other.accountId) &&
    daysApart(item.localDate, other.localDate) <= Math.max(transferPairWindowDays(item.source), transferPairWindowDays(other.source)) &&
    !(item.source === 'csv' && other.source === 'csv') // CSV rows pair within the CSV window; mixed pairs use the wider capture window
  ) {
    return { rank: 3, outcome: { kind: 'transfer_pair_with', id: other.id } };
  }
  if (
    opposite(item.direction, other.direction) &&
    item.source === 'csv' &&
    other.source === 'csv' &&
    item.amountMinor === other.amountMinor &&
    item.accountId !== null &&
    other.accountId !== null &&
    item.accountId !== other.accountId &&
    ctx.ownedAccountIds.has(item.accountId) &&
    ctx.ownedAccountIds.has(other.accountId) &&
    daysApart(item.localDate, other.localDate) <= 2
  ) {
    return { rank: 3, outcome: { kind: 'transfer_pair_with', id: other.id } };
  }

  // Fuzzy match: at least one side has no reference.
  if (bothRefs) return null;
  if (item.direction !== other.direction || item.eventType !== other.eventType) return null;
  const a = normalizeMerchant(item.merchant);
  const b = normalizeMerchant(other.merchant);
  if (a === '' || b === '' || a !== b) return null; // an item with no merchant is never fuzzy-matched
  if (!amountsMatch(item, other)) return null;
  // The Nth identical CSV row is its own row.
  if (item.occurrence !== undefined && other.occurrence !== undefined && item.occurrence !== other.occurrence) return null;

  if (item.source === 'manual' && other.source === 'manual') {
    return Math.abs(item.occurredAtMs - other.occurredAtMs) <= MANUAL_WINDOW_MS ? { rank: 5, outcome: { kind: 'possible_duplicate_of', id: other.id } } : null;
  }
  if (daysApart(item.localDate, other.localDate) > 1) return null;
  if (item.source === 'csv' && ctx.partialDays?.has(item.localDate)) return { rank: 4, outcome: { kind: 'held_pair', id: other.id, question: PARTIAL_DAY_QUESTION } };
  return { rank: 5, outcome: { kind: 'possible_duplicate_of', id: other.id } };
}

/**
 * Compares a new item with the existing ones. When several match, the strongest outcome wins and ties go to the
 * smallest id, so the result never depends on the order of `existing`.
 */
export function matchItem(item: CaptureItem, existing: readonly CaptureItem[], ctx: MatchContext): MatchOutcome {
  // Something the user removed on purpose does not come back (tombstones, Story 3.12).
  const key = normalizeMerchant(item.merchant);
  for (const t of ctx.tombstones ?? []) {
    if (item.reference !== null && t.reference !== null) {
      if (item.reference === t.reference) return { kind: 'previously_removed' };
      continue;
    }
    if (t.amountMinor === item.amountMinor && t.localDate === item.localDate && key !== '' && t.merchantKey === key) return { kind: 'previously_removed' };
  }

  let best: Candidate | null = null;
  for (const other of existing) {
    const c = compare(item, other, ctx);
    if (!c) continue;
    const id = 'id' in c.outcome && c.outcome.id !== null ? c.outcome.id : '';
    const bestId = best && 'id' in best.outcome && best.outcome.id !== null ? best.outcome.id : '';
    if (best === null || c.rank < best.rank || (c.rank === best.rank && id < bestId)) best = c;
  }
  if (best) return best.outcome;

  // A CSV row on a partly covered first or last day, with nothing to match, is held for a look instead of added or skipped.
  if (item.source === 'csv' && ctx.partialDays?.has(item.localDate)) return { kind: 'held_pair', id: null, question: PARTIAL_DAY_QUESTION };
  return { kind: 'no_match' };
}
