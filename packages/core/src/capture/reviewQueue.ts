import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { profileTimezone } from '../ledger/accountCommands';
import { restoreTx, snapshotTx, type TxSnapshot } from './snapshot';

/**
 * The review queue (Story 3.10, SCR-10): every `needs_review` entry in one list, newest first (`toCheck`, also the source
 * of the Activity tab dot), plus confirmed entries that still need a category in their own section (never counted).
 */

export type ReviewReason = 'duplicate' | 'foreign_currency' | 'pending' | 'other';

export interface ReviewSide {
  readonly id: string;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly occurredAtMs: number;
  readonly merchant: string | null;
  readonly account: string | null;
  readonly category: string | null;
  readonly sourceKind: string;
}

export interface ReviewItem extends ReviewSide {
  readonly eventType: string;
  readonly reason: ReviewReason;
  /** The entry it may duplicate (reason duplicate). */
  readonly alreadyRecorded: ReviewSide | null;
  readonly foreign: { readonly amountMinor: number; readonly currency: string; readonly exponent: number } | null;
}

const SIDE =
  "t.id, t.amount_minor, t.local_date, t.occurred_at_utc, t.original_description, (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id ORDER BY p.signed_amount_minor LIMIT 1), (SELECT c.name FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), COALESCE((SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at, sr.id LIMIT 1), 'manual')";

/** The `needs_review` set, newest first. This is the single definition of "to check". */
export const TO_CHECK_SQL =
  `SELECT ${SIDE}, t.event_type, COALESCE((SELECT rc.reason FROM review_candidate rc WHERE rc.transaction_id = t.id AND rc.status = 'open' ORDER BY rc.created_at DESC LIMIT 1), 'pending'), (SELECT rc.matched_transaction_id FROM review_candidate rc WHERE rc.transaction_id = t.id AND rc.status = 'open' ORDER BY rc.created_at DESC LIMIT 1), t.foreign_amount_minor, t.foreign_currency, t.foreign_currency_exponent FROM "transaction" t WHERE t.status = 'needs_review' AND t.removed_at IS NULL ORDER BY t.occurred_at_utc DESC, t.id DESC`;

/** One entry in the same shape (the "Already recorded" side). Param: id. */
export const REVIEW_SIDE_SQL = `SELECT ${SIDE} FROM "transaction" t WHERE t.id = ?`;

/** Confirmed entries still waiting for a category: their own section, never counted in "N to check". */
export const NEEDS_CATEGORY_SQL =
  `SELECT ${SIDE} FROM "transaction" t WHERE t.status = 'confirmed' AND t.needs_category = 1 AND t.removed_at IS NULL AND t.event_type IN ('expense','income') ORDER BY t.occurred_at_utc DESC, t.id DESC`;

function side(r: readonly unknown[]): ReviewSide {
  return {
    id: String(r[0]),
    amountMinor: Number(r[1]),
    localDate: String(r[2]),
    occurredAtMs: Number(r[3]),
    merchant: r[4] === null ? null : String(r[4]),
    account: r[5] === null ? null : String(r[5]),
    category: r[6] === null ? null : String(r[6]),
    sourceKind: String(r[7]),
  };
}

export const mapReviewSides = (rows: readonly (readonly unknown[])[]): ReviewSide[] => rows.map(side);

/** The rows of `TO_CHECK_SQL`; `matched` maps a matched id to its row (from `REVIEW_SIDE_SQL`). */
export function mapReviewItems(rows: readonly (readonly unknown[])[], matched: ReadonlyMap<string, ReviewSide>): ReviewItem[] {
  return rows.map((r) => ({
    ...side(r),
    eventType: String(r[8]),
    reason: String(r[9]) as ReviewReason,
    alreadyRecorded: r[10] === null ? null : (matched.get(String(r[10])) ?? null),
    foreign: r[11] === null ? null : { amountMinor: Number(r[11]), currency: String(r[12]), exponent: Number(r[13]) },
  }));
}

/** Source words shown on a card. */
export function sourceWords(kind: string): 'addedByYou' | 'bankSms' | 'receipt' | 'csvImport' | 'other' {
  if (kind === 'manual') return 'addedByYou';
  if (kind === 'sms' || kind === 'upi' || kind === 'notification') return 'bankSms';
  if (kind === 'receipt') return 'receipt';
  if (kind === 'csv') return 'csvImport';
  return 'other';
}

export type ApproveError = 'ENTRY_NOT_FOUND' | 'NOT_PENDING' | 'USE_KEEP_OR_MERGE' | 'AMOUNT_NEEDED';

async function closeCandidates(ctx: WriterContext, id: string): Promise<void> {
  await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ? WHERE transaction_id = ? AND status = 'open'", [ctx.nowMs(), id]);
}

/** Approve a pending capture: it becomes confirmed with `capture_resolution = user_approved`. Returns the entry as it was, for Undo. */
export const ApproveCapture: UseCase<{ transactionId: string }, { snapshot: TxSnapshot }, ApproveError> = {
  name: 'ApproveCapture',
  async execute(ctx, input) {
    const snap = await snapshotTx(ctx, input.transactionId);
    if (!snap || snap.removedAt !== null) return err('ENTRY_NOT_FOUND');
    if (snap.status !== 'needs_review') return err('NOT_PENDING');
    // A duplicate candidate whose match was deleted or purged no longer blocks approving the entry.
    const open = (await ctx.query("SELECT rc.reason FROM review_candidate rc LEFT JOIN \"transaction\" m ON m.id = rc.matched_transaction_id WHERE rc.transaction_id = ? AND rc.status = 'open' AND NOT (rc.reason = 'duplicate' AND (m.id IS NULL OR m.removed_at IS NOT NULL))", [input.transactionId])).map((r) => String(r[0]));
    if (open.includes('duplicate')) return err('USE_KEEP_OR_MERGE');
    if (open.includes('foreign_currency') || snap.postings.length === 0) return err('AMOUNT_NEEDED');
    const now = ctx.nowMs();
    await ctx.execute("UPDATE \"transaction\" SET status = 'confirmed', capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [now, input.transactionId]);
    await closeCandidates(ctx, input.transactionId);
    ctx.touch('transaction', input.transactionId, { approved: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    ctx.emit('CapturesSubmitted', { transactionIds: [input.transactionId] });
    return ok({ snapshot: snap });
  },
};

export type ConfirmForeignError = 'ENTRY_NOT_FOUND' | 'NOT_FOREIGN' | 'AMOUNT_REQUIRED' | 'AMOUNT_INVALID' | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_ARCHIVED' | 'CATEGORY_NOT_FOUND';

/**
 * A foreign-currency capture has no profile amount and no posting. Confirm writes both from the amount the user typed
 * in the profile currency; the foreign amount stays as source metadata. No exchange rate is fetched or suggested.
 */
export const ConfirmForeignAmount: UseCase<{ transactionId: string; amountMinor: number; accountId: string; categoryId?: string }, { snapshot: TxSnapshot }, ConfirmForeignError> = {
  name: 'ConfirmForeignAmount',
  async execute(ctx, input) {
    const snap = await snapshotTx(ctx, input.transactionId);
    if (!snap || snap.removedAt !== null) return err('ENTRY_NOT_FOUND');
    const row = (await ctx.query('SELECT event_type, foreign_currency FROM "transaction" WHERE id = ?', [input.transactionId]))[0]!;
    if (snap.status !== 'needs_review' || row[1] === null || snap.postings.length > 0) return err('NOT_FOREIGN');
    if (!Number.isSafeInteger(input.amountMinor)) return err('AMOUNT_INVALID');
    if (input.amountMinor <= 0) return err('AMOUNT_REQUIRED');
    const acc = (await ctx.query('SELECT status FROM account WHERE id = ?', [input.accountId]))[0];
    if (!acc) return err('ACCOUNT_NOT_FOUND');
    if (String(acc[0]) !== 'active') return err('ACCOUNT_ARCHIVED');
    const type = String(row[0]);
    const existing = snap.splits[0];
    const categoryId = input.categoryId ?? existing?.category;
    if (!categoryId) return err('CATEGORY_NOT_FOUND');
    if (!(await ctx.query('SELECT 1 FROM category WHERE id = ? AND archived = 0', [categoryId]))[0]) return err('CATEGORY_NOT_FOUND');
    const tz = (await profileTimezone(ctx)) ?? snap.timezoneId;
    const date = toLocalDate(snap.occurredAt, tz);
    const now = ctx.nowMs();
    await ctx.execute("UPDATE \"transaction\" SET amount_minor = ?, status = 'confirmed', capture_resolution = 'user_approved', local_date = ?, updated_at = ? WHERE id = ?", [input.amountMinor, date.ok ? date.value : snap.localDate, now, input.transactionId]);
    await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, 'normal')", [ctx.newId(), input.transactionId, input.accountId, type === 'income' ? 'in' : 'out', type === 'income' ? input.amountMinor : -input.amountMinor]);
    await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [input.transactionId]);
    await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, ?)', [ctx.newId(), input.transactionId, categoryId, input.amountMinor]);
    await closeCandidates(ctx, input.transactionId);
    ctx.touch('transaction', input.transactionId, { approved: true, foreignConfirmed: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok({ snapshot: snap });
  },
};

/** Undo for Approve / Confirm: the entry goes back exactly (waiting, with its review candidate reopened). */
export const UndoReviewDecision: UseCase<{ snapshot: TxSnapshot }, void, 'ENTRY_NOT_FOUND'> = {
  name: 'UndoReviewDecision',
  async execute(ctx, input) {
    if (!(await ctx.query('SELECT 1 FROM "transaction" WHERE id = ?', [input.snapshot.id]))[0]) return err('ENTRY_NOT_FOUND');
    await restoreTx(ctx, input.snapshot);
    await ctx.execute("UPDATE review_candidate SET status = 'open', resolved_at = NULL WHERE transaction_id = ? AND status = 'resolved' AND resolved_at = (SELECT MAX(resolved_at) FROM review_candidate WHERE transaction_id = ?)", [input.snapshot.id, input.snapshot.id]);
    ctx.touch('transaction', input.snapshot.id, { reviewUndone: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.snapshot.id] });
    return ok(undefined);
  },
};
