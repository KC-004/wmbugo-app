import { err, ok } from '../../shared/result';
import type { UseCase, WriterContext } from '../../writer/ledgerWriter';
import { restoreTx, snapshotTx, type TxSnapshot } from '../snapshot';
import { SubmitCapture } from '../submitCapture';

/**
 * Reviewing what an import left waiting (Story 9.5, IMP-002, FIN-027): equal and opposite legs offered as one transfer, and rows from a
 * half-covered day. Every choice stores what it changed on the review candidate, so Undo puts each row back exactly.
 */

export type ImportReviewError =
  | 'NOT_A_PAIR'
  | 'ALREADY_RESOLVED'
  | 'MATCH_REMOVED'
  | 'NOT_A_LEG'
  | 'NOT_AN_EDGE_DAY_ROW'
  | 'ENTRY_NOT_FOUND'
  | 'NOTHING_TO_UNDO'
  | 'TRANSFER_FAILED';

type Reason = 'transfer_pair' | 'edge_day';

interface Undo {
  readonly kind: 'transfer_link' | 'keep_separate' | 'edge_link' | 'edge_exclude';
  readonly txs: TxSnapshot[];
  /** The transfer the link created (removed again on Undo). */
  readonly transferId?: string;
  /** Other candidates this choice resolved, reopened on Undo. */
  readonly alsoResolved?: string[];
}

interface Candidate {
  readonly id: string;
  readonly matched: string | null;
}

async function openCandidate(ctx: WriterContext, transactionId: string, reason: Reason): Promise<Candidate | 'resolved' | null> {
  const r = (await ctx.query('SELECT id, matched_transaction_id, status FROM review_candidate WHERE transaction_id = ? AND reason = ? ORDER BY created_at DESC, id DESC LIMIT 1', [transactionId, reason]))[0];
  if (!r) return null;
  return String(r[2]) === 'open' ? { id: String(r[0]), matched: r[1] === null ? null : String(r[1]) } : 'resolved';
}

const exclude = (ctx: WriterContext, id: string, now: number) =>
  ctx.execute("UPDATE \"transaction\" SET status = 'excluded', removed_at = ?, removal_kind = 'excluded', updated_at = ? WHERE id = ?", [now, now, id]);

/** One leg of a transfer pair as the link needs it: which account, which direction, how much. */
function leg(s: TxSnapshot): { accountId: string; direction: 'in' | 'out'; amount: number } | null {
  const p = s.postings.filter((x) => x.kind === 'normal');
  if (p.length !== 1) return null;
  return { accountId: p[0]!.account, direction: p[0]!.signed < 0 ? 'out' : 'in', amount: Math.abs(p[0]!.signed) };
}

/**
 * Yes, it's a transfer. The two legs become one `transfer` with postings on both accounts that sum to zero; both legs are excluded
 * (hidden everywhere, an earlier confirmed leg included); every source record follows the transfer; the candidates are resolved.
 * Spent this period and both balances change in the same commit.
 */
export const LinkAsTransfer: UseCase<{ transactionId: string }, { transferId: string; excludedIds: string[] }, ImportReviewError> = {
  name: 'LinkAsTransfer',
  async execute(ctx, input) {
    const c = await openCandidate(ctx, input.transactionId, 'transfer_pair');
    if (c === null) return err('NOT_A_PAIR');
    if (c === 'resolved') return err('ALREADY_RESOLVED');
    if (c.matched === null) return err('NOT_A_PAIR');
    if ((await ctx.query('SELECT 1 FROM "transaction" WHERE id = ? AND removed_at IS NULL', [c.matched])).length === 0) return err('MATCH_REMOVED');

    const a = await snapshotTx(ctx, input.transactionId);
    const b = await snapshotTx(ctx, c.matched);
    if (!a || !b) return err('ENTRY_NOT_FOUND');
    const la = leg(a);
    const lb = leg(b);
    if (!la || !lb || la.direction === lb.direction || la.amount !== lb.amount || la.accountId === lb.accountId) return err('NOT_A_PAIR');
    const out = la.direction === 'out' ? { s: a, l: la } : { s: b, l: lb };
    const into = la.direction === 'in' ? { s: a, l: la } : { s: b, l: lb };

    // The other leg may be waiting on a candidate of its own (a pair inside one file points both ways): it is resolved too.
    const alsoResolved = (await ctx.query("SELECT id FROM review_candidate WHERE transaction_id = ? AND reason = 'transfer_pair' AND status = 'open'", [c.matched])).map((r) => String(r[0]));
    const undo: Omit<Undo, 'transferId'> = { kind: 'transfer_link', txs: [a, b], alsoResolved };

    const now = ctx.nowMs();
    // The legs are hidden before the transfer is written, so a balance check sees the money as it will be.
    await exclude(ctx, a.id, now);
    await exclude(ctx, b.id, now);
    // The transfer is made by the one capture path (LIR-06), under a fingerprint of its own that names the two legs it replaces.
    const t = await SubmitCapture.execute(ctx, {
      submissionId: `link-${out.s.id}-${into.s.id}`,
      sourceKind: 'csv',
      transfer: { amountMinor: la.amount, fromAccountId: out.l.accountId, toAccountId: into.l.accountId, occurredAtMs: out.s.occurredAt },
    });
    if (!t.ok) return err('TRANSFER_FAILED');
    await ctx.execute("UPDATE \"transaction\" SET capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [now, t.value.transactionId]);
    await ctx.execute('UPDATE source_record SET transaction_id = ? WHERE transaction_id IN (?, ?)', [t.value.transactionId, a.id, b.id]);
    await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ?, undo_json = ? WHERE id = ?", [now, JSON.stringify({ ...undo, transferId: t.value.transactionId }), c.id]);
    for (const id of alsoResolved) await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ? WHERE id = ?", [now, id]);
    ctx.touch('transaction', t.value.transactionId, { resolution: 'linked_transfer', created: true });
    ctx.touch('transaction', a.id, { resolution: 'linked_transfer', excluded: true });
    ctx.touch('transaction', b.id, { resolution: 'linked_transfer', excluded: true });
    ctx.emit('TransactionsChanged', { transactionIds: [t.value.transactionId, a.id, b.id] });
    return ok({ transferId: t.value.transactionId, excludedIds: [a.id, b.id] });
  },
};

/** No, keep them separate: the imported leg is confirmed (user_approved), the candidate is resolved, both count as their own direction. */
export const KeepSeparate: UseCase<{ transactionId: string }, { candidateId: string }, ImportReviewError> = {
  name: 'KeepSeparate',
  async execute(ctx, input) {
    const c = await openCandidate(ctx, input.transactionId, 'transfer_pair');
    if (c === null) return err('NOT_A_PAIR');
    if (c === 'resolved') return err('ALREADY_RESOLVED');
    const a = await snapshotTx(ctx, input.transactionId);
    if (!a) return err('ENTRY_NOT_FOUND');
    const now = ctx.nowMs();
    const alsoResolved: string[] = [];
    const txs = [a];
    // A pair inside one file: the other leg is kept separate with it, so nothing is left asking the same question.
    if (c.matched !== null) {
      const other = await snapshotTx(ctx, c.matched);
      const open = (await ctx.query("SELECT id FROM review_candidate WHERE transaction_id = ? AND reason = 'transfer_pair' AND status = 'open'", [c.matched])).map((r) => String(r[0]));
      if (other && other.removedAt === null && open.length > 0 && other.status === 'needs_review') {
        txs.push(other);
        alsoResolved.push(...open);
        await ctx.execute("UPDATE \"transaction\" SET status = 'confirmed', capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [now, other.id]);
        for (const id of open) await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ? WHERE id = ?", [now, id]);
      }
    }
    const undo: Undo = { kind: 'keep_separate', txs, alsoResolved };
    await ctx.execute("UPDATE \"transaction\" SET status = 'confirmed', capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [now, input.transactionId]);
    await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ?, undo_json = ? WHERE id = ?", [now, JSON.stringify(undo), c.id]);
    for (const t of txs) ctx.touch('transaction', t.id, { resolution: 'keep_separate' });
    ctx.emit('TransactionsChanged', { transactionIds: txs.map((t) => t.id) });
    return ok({ candidateId: c.id });
  },
};

/**
 * It's already here, for a row from a half-covered day: its source is linked to the entry that is already recorded (when one is
 * chosen) and the row's own entry is excluded, so a later import skips it too. Without a chosen entry it is just excluded.
 */
export const LinkEdgeDayRow: UseCase<{ transactionId: string; existingId?: string }, { excludedId: string }, ImportReviewError> = {
  name: 'LinkEdgeDayRow',
  async execute(ctx, input) {
    const c = await openCandidate(ctx, input.transactionId, 'edge_day');
    if (c === null) return err('NOT_AN_EDGE_DAY_ROW');
    if (c === 'resolved') return err('ALREADY_RESOLVED');
    const row = await snapshotTx(ctx, input.transactionId);
    if (!row) return err('ENTRY_NOT_FOUND');
    const txs = [row];
    const now = ctx.nowMs();
    if (input.existingId) {
      const target = await snapshotTx(ctx, input.existingId);
      if (!target || target.removedAt !== null) return err('MATCH_REMOVED');
      txs.push(target);
      await ctx.execute('UPDATE source_record SET transaction_id = ? WHERE transaction_id = ?', [input.existingId, input.transactionId]);
    }
    const undo: Undo = { kind: input.existingId ? 'edge_link' : 'edge_exclude', txs };
    await exclude(ctx, input.transactionId, now);
    await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ?, undo_json = ? WHERE id = ?", [now, JSON.stringify(undo), c.id]);
    ctx.touch('transaction', input.transactionId, { resolution: 'edge_day_already_here', excluded: true });
    ctx.emit('TransactionsChanged', { transactionIds: txs.map((t) => t.id) });
    return ok({ excludedId: input.transactionId });
  },
};

/** Undo for every choice above: each row, posting, split and source link goes back, the transfer a link made is removed, the question reopens. */
export const UndoImportReview: UseCase<{ transactionId: string }, void, ImportReviewError> = {
  name: 'UndoImportReview',
  async execute(ctx, input) {
    const r = (
      await ctx.query("SELECT id, undo_json FROM review_candidate WHERE transaction_id = ? AND reason IN ('transfer_pair','edge_day') AND status = 'resolved' AND undo_json IS NOT NULL ORDER BY resolved_at DESC, id DESC LIMIT 1", [input.transactionId])
    )[0];
    if (!r) return err('NOTHING_TO_UNDO');
    const undo = JSON.parse(String(r[1])) as Undo;
    // An entry purged since cannot be put back.
    for (const s of undo.txs) if ((await ctx.query('SELECT 1 FROM "transaction" WHERE id = ?', [s.id])).length === 0) return err('NOTHING_TO_UNDO');
    // The source records go back to where they were first, so the transfer can be deleted without taking them with it.
    for (const s of undo.txs) await restoreTx(ctx, s);
    if (undo.transferId) {
      await ctx.execute('DELETE FROM source_record WHERE transaction_id = ?', [undo.transferId]);
      await ctx.execute('DELETE FROM posting WHERE transaction_id = ?', [undo.transferId]);
      await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [undo.transferId]);
      await ctx.execute('DELETE FROM "transaction" WHERE id = ?', [undo.transferId]);
    }
    await ctx.execute("UPDATE review_candidate SET status = 'open', resolved_at = NULL, undo_json = NULL WHERE id = ?", [String(r[0])]);
    for (const id of undo.alsoResolved ?? []) await ctx.execute("UPDATE review_candidate SET status = 'open', resolved_at = NULL WHERE id = ?", [id]);
    for (const s of undo.txs) ctx.touch('transaction', s.id, { resolution: 'undone' });
    ctx.emit('TransactionsChanged', { transactionIds: [...undo.txs.map((s) => s.id), ...(undo.transferId ? [undo.transferId] : [])] });
    return ok(undefined);
  },
};

/** The other entries already recorded on a waiting row's day, for the same account (the edge-day card shows them). Params: `edgeDayParams(id)`. */
export const edgeDayParams = (rowId: string): string[] => [rowId, rowId, rowId];
export const EDGE_DAY_ENTRIES_SQL =
  "SELECT t.id, t.amount_minor, t.local_date, t.occurred_at_utc, t.original_description, (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id ORDER BY p.signed_amount_minor LIMIT 1), (SELECT c.name FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), COALESCE((SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at, sr.id LIMIT 1), 'manual') FROM \"transaction\" t WHERE t.id <> ? AND t.removed_at IS NULL AND t.status IN ('confirmed','needs_review') AND t.event_type IN ('expense','income') AND t.local_date = (SELECT local_date FROM \"transaction\" WHERE id = ?) AND EXISTS (SELECT 1 FROM posting p WHERE p.transaction_id = t.id AND p.account_id = (SELECT account_id FROM posting WHERE transaction_id = ? LIMIT 1)) ORDER BY t.occurred_at_utc, t.id";
