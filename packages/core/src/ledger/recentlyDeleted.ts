import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import { snapshotTx, type TxSnapshot } from '../capture/snapshot';
import { DELETED_KEEP_DAYS } from './purge';

/**
 * Recently deleted, Restore and Delete permanently (Story 3.13, FIN-014, FIN-024). A manual entry deleted within the last 30
 * days can be brought back with its original date; a rejected capture can be restored as confirmed. Both give back an exact
 * Undo. Delete permanently is the Story 3.12 `PurgeEntry`.
 */

const DAY_MS = 86_400_000;

export interface DeletedRow {
  readonly id: string;
  readonly eventType: string;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly category: string | null;
  readonly account: string | null;
  readonly removedAtMs: number;
  /** Whole days left before it is removed for good. */
  readonly daysLeft: number;
}

/** Whole days left from `removedAtMs` at `nowMs`, counting a started day as a day left (deleted just now: 30). */
export function daysLeft(removedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((removedAtMs + DELETED_KEEP_DAYS * DAY_MS - nowMs) / DAY_MS));
}

/**
 * Manual entries deleted within the keeping period, most recently deleted first. Params: oldest `removed_at` still kept.
 * Rejected and merged-away entries are not here (rejected captures live behind Activity's Show rejected).
 */
export const RECENTLY_DELETED_SQL =
  "SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.original_description, (SELECT c.name FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id ORDER BY p.signed_amount_minor LIMIT 1), t.removed_at FROM \"transaction\" t WHERE t.removal_kind = 'deleted' AND t.status = 'excluded' AND t.removed_at IS NOT NULL AND t.removed_at > ? AND t.event_type IN ('expense','income','transfer','refund') ORDER BY t.removed_at DESC, t.id DESC";

export const recentlyDeletedSince = (nowMs: number): number => nowMs - DELETED_KEEP_DAYS * DAY_MS;

export function mapDeletedRows(rows: readonly (readonly unknown[])[], nowMs: number): DeletedRow[] {
  return rows.map((r) => ({
    id: String(r[0]),
    eventType: String(r[1]),
    amountMinor: Number(r[2]),
    localDate: String(r[3]),
    merchant: r[4] === null ? null : String(r[4]),
    category: r[5] === null ? null : String(r[5]),
    account: r[6] === null ? null : String(r[6]),
    removedAtMs: Number(r[7]),
    daysLeft: daysLeft(Number(r[7]), nowMs),
  }));
}

/** What the confirm sheet needs to say. Param: transaction id. */
export const PURGE_FACTS_SQL = "SELECT t.event_type, (SELECT COUNT(*) FROM \"transaction\" r WHERE r.refund_of_transaction_id = t.id AND r.event_type = 'refund') FROM \"transaction\" t WHERE t.id = ?";

export interface PurgeFacts {
  readonly isTransfer: boolean;
  readonly hasRefund: boolean;
}

export function mapPurgeFacts(rows: readonly (readonly unknown[])[]): PurgeFacts | null {
  const r = rows[0];
  return r ? { isTransfer: String(r[0]) === 'transfer', hasRefund: Number(r[1]) > 0 } : null;
}

export type RestoreError = 'ENTRY_NOT_FOUND' | 'NOT_DELETED' | 'NOT_REJECTED' | 'PAST_RETENTION';

/** Brings a deleted manual entry back with its original date. Returns the entry as it was, for Undo. */
export const RestoreDeleted: UseCase<{ transactionId: string }, { snapshot: TxSnapshot }, RestoreError> = {
  name: 'RestoreDeleted',
  async execute(ctx, input) {
    const snap = await snapshotTx(ctx, input.transactionId);
    if (!snap) return err('ENTRY_NOT_FOUND');
    const row = (await ctx.query('SELECT removal_kind FROM "transaction" WHERE id = ?', [input.transactionId]))[0]!;
    if (snap.removedAt === null || String(row[0]) !== 'deleted') return err('NOT_DELETED');
    if (snap.removedAt <= ctx.nowMs() - DELETED_KEEP_DAYS * DAY_MS) return err('PAST_RETENTION');
    const open = (await ctx.query("SELECT 1 FROM review_candidate WHERE transaction_id = ? AND status = 'open'", [input.transactionId]))[0];
    const reversed = (await ctx.query('SELECT 1 FROM "transaction" WHERE id = ? AND reversed_by_id IS NOT NULL', [input.transactionId]))[0];
    const now = ctx.nowMs();
    await ctx.execute('UPDATE "transaction" SET removed_at = NULL, removal_kind = NULL, status = ?, updated_at = ? WHERE id = ?', [open ? 'needs_review' : reversed ? 'reversed' : 'confirmed', now, input.transactionId]);
    ctx.touch('transaction', input.transactionId, { restored: 'deleted' });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok({ snapshot: snap });
  },
};

/** Restores a rejected capture: confirmed, `capture_resolution = user_approved`, in one transaction. */
export const RestoreRejected: UseCase<{ transactionId: string }, { snapshot: TxSnapshot }, RestoreError> = {
  name: 'RestoreRejected',
  async execute(ctx, input) {
    const snap = await snapshotTx(ctx, input.transactionId);
    if (!snap) return err('ENTRY_NOT_FOUND');
    const row = (await ctx.query('SELECT removal_kind FROM "transaction" WHERE id = ?', [input.transactionId]))[0]!;
    if (snap.removedAt === null || String(row[0]) !== 'rejected') return err('NOT_REJECTED');
    const now = ctx.nowMs();
    // A capture that still needs a decision (an open candidate, or no posting yet) goes back to waiting, not to confirmed.
    const waiting = snap.postings.length === 0 || (await ctx.query("SELECT 1 FROM review_candidate WHERE transaction_id = ? AND status = 'open'", [input.transactionId]))[0];
    if (waiting) {
      await ctx.execute("UPDATE \"transaction\" SET removed_at = NULL, removal_kind = NULL, status = 'needs_review', capture_resolution = NULL, updated_at = ? WHERE id = ?", [now, input.transactionId]);
    } else {
      await ctx.execute("UPDATE \"transaction\" SET removed_at = NULL, removal_kind = NULL, status = 'confirmed', capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [now, input.transactionId]);
    }
    ctx.touch('transaction', input.transactionId, { restored: 'rejected' });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    ctx.emit('CapturesSubmitted', { transactionIds: [input.transactionId] });
    return ok({ snapshot: snap });
  },
};
