import { matchItem, type CaptureItem, type MatchSource } from '../match';

/**
 * A dry run of the duplicate matcher for a read receipt (Story 10.8, OCR-006, FIN-027): which recorded expenses is it probably the same
 * payment as? Nothing is written. The decision is the Story 3.1 matcher's own (`matchItem`, including the receipt rule: same shop, a day
 * apart at most, a charge 0 to 30% higher), so a preview and a real save never disagree.
 */

/** The most matches the prompt lists. */
export const MAX_RECEIPT_MATCHES = 3;

export interface ReceiptMatch {
  readonly transactionId: string;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly occurredAtMs: number;
  readonly merchant: string | null;
  readonly accountName: string | null;
  /** The entry's first source (`manual`, `sms`, `receipt`, `csv` ...). */
  readonly sourceKind: string;
  readonly status: 'confirmed' | 'needs_review';
}

/**
 * Confirmed and `needs_review` expenses whose amount is the receipt total, or up to 30% above it, within a day of the receipt.
 * Params: low (the total), high (the total x 1.3, rounded down), first day, last day.
 */
export const RECEIPT_MATCH_SQL =
  "SELECT t.id, t.amount_minor, t.local_date, t.occurred_at_utc, t.original_description, (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.posting_kind = 'normal' LIMIT 1), COALESCE((SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at, sr.id LIMIT 1), 'manual'), t.status, (SELECT sr.reference FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at, sr.id LIMIT 1) FROM \"transaction\" t WHERE t.event_type = 'expense' AND t.status IN ('confirmed','needs_review') AND t.removed_at IS NULL AND t.amount_minor BETWEEN ? AND ? AND t.local_date BETWEEN ? AND ?";

const addDays = (date: string, n: number): string => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** The parameters of `RECEIPT_MATCH_SQL` for a receipt of `totalMinor` on `localDate`. */
export function receiptMatchParams(totalMinor: number, localDate: string): [number, number, string, string] {
  return [totalMinor, Math.floor((totalMinor * 13) / 10), addDays(localDate, -1), addDays(localDate, 1)];
}

/** What the matcher knows an entry's source as: a card, bank or UPI record is a charge, so the receipt rule applies to it. */
function matchSource(kind: string): MatchSource {
  switch (kind) {
    case 'manual':
      return 'manual';
    case 'receipt':
      return 'receipt';
    default:
      return 'bank';
  }
}

export interface ReceiptFacts {
  readonly merchant: string | null;
  readonly localDate: string;
  readonly occurredAtMs: number;
  readonly totalMinor: number;
}

/**
 * Up to three probable matches, nearest amount first, then nearest time, then the smaller id. The receipt's own merchant is required:
 * a receipt with no shop name matches nothing.
 */
export function previewReceiptMatches(facts: ReceiptFacts, rows: readonly (readonly unknown[])[]): ReceiptMatch[] {
  if (facts.merchant === null || facts.merchant.trim() === '') return [];
  const item: CaptureItem = {
    id: 'receipt',
    reference: null,
    direction: 'debit',
    eventType: 'expense',
    amountMinor: facts.totalMinor,
    localDate: facts.localDate,
    occurredAtMs: facts.occurredAtMs,
    merchant: facts.merchant,
    accountId: null,
    source: 'receipt',
  };
  const found: ReceiptMatch[] = [];
  for (const r of rows) {
    const other: CaptureItem = {
      id: String(r[0]),
      // A reference on the other side means it is a different payment unless this one has the same: a receipt has none.
      reference: r[8] === null || r[8] === undefined ? null : String(r[8]),
      direction: 'debit',
      eventType: 'expense',
      amountMinor: Number(r[1]),
      localDate: String(r[2]),
      occurredAtMs: Number(r[3]),
      merchant: r[4] === null ? null : String(r[4]),
      accountId: null,
      source: matchSource(String(r[6])),
    };
    const outcome = matchItem(item, [other], { ownedAccountIds: new Set() });
    if (outcome.kind !== 'possible_duplicate_of' && outcome.kind !== 'duplicate_of') continue;
    found.push({
      transactionId: other.id,
      amountMinor: other.amountMinor,
      localDate: other.localDate,
      occurredAtMs: other.occurredAtMs,
      merchant: other.merchant,
      accountName: r[5] === null ? null : String(r[5]),
      sourceKind: String(r[6]),
      status: String(r[7]) === 'needs_review' ? 'needs_review' : 'confirmed',
    });
  }
  return found
    .sort((a, b) => Math.abs(a.amountMinor - facts.totalMinor) - Math.abs(b.amountMinor - facts.totalMinor) || Math.abs(a.occurredAtMs - facts.occurredAtMs) - Math.abs(b.occurredAtMs - facts.occurredAtMs) || (a.transactionId < b.transactionId ? -1 : 1))
    .slice(0, MAX_RECEIPT_MATCHES);
}
