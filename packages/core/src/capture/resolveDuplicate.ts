import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';

/**
 * Resolving a possible duplicate (Story 3.3, FIN-027 Merge): Keep both, Merge and Undo. Every resolution stores what it
 * changed on the review candidate, so Undo puts each row back exactly as it was.
 */

/** Whether an entry may be approved without the user (reused by Epic 11). Never with an open duplicate candidate. */
export function isAutoApprovable(e: { readonly hasOpenDuplicate: boolean; readonly needsCategory?: boolean }): boolean {
  return !e.hasOpenDuplicate && e.needsCategory !== true;
}

/** Source authority for a merge: bank, card and UPI evidence, then CSV, then a receipt, then a manual entry. */
export const SOURCE_AUTHORITY: Readonly<Record<string, number>> = { sms: 4, upi: 4, notification: 4, share: 4, csv: 3, receipt: 2, manual: 1 };

export const TIP_CATEGORY_NAME = 'Tip / adjustment';

export type ResolveError = 'NOT_A_DUPLICATE' | 'ALREADY_RESOLVED' | 'CATEGORY_REQUIRED' | 'CATEGORY_NOT_FOUND' | 'NOTHING_TO_UNDO';

interface Snap {
  id: string;
  status: string;
  resolution: string | null;
  removedAt: number | null;
  removalKind: string | null;
  amount: number;
  occurredAt: number;
  localDate: string;
  timezoneId: string;
  postings: { id: string; account: string; direction: string; signed: number; kind: string }[];
  splits: { id: string; category: string; amount: number; memo: string | null }[];
  sources: string[];
}
interface Undo {
  kind: 'keep_both' | 'merge';
  txs: Snap[];
  /** Splits created by the merge (the tip split), removed again on Undo. */
  addedSplitIds?: string[];
}

async function snap(ctx: WriterContext, id: string): Promise<Snap> {
  const t = (await ctx.query('SELECT status, capture_resolution, removed_at, removal_kind, amount_minor, occurred_at_utc, local_date, timezone_id FROM "transaction" WHERE id = ?', [id]))[0]!;
  const postings = await ctx.query('SELECT id, account_id, direction, signed_amount_minor, posting_kind FROM posting WHERE transaction_id = ? ORDER BY id', [id]);
  const splits = await ctx.query('SELECT id, category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY id', [id]);
  const sources = await ctx.query('SELECT id FROM source_record WHERE transaction_id = ? ORDER BY id', [id]);
  return {
    id,
    status: String(t[0]),
    resolution: t[1] === null ? null : String(t[1]),
    removedAt: t[2] === null ? null : Number(t[2]),
    removalKind: t[3] === null ? null : String(t[3]),
    amount: Number(t[4]),
    occurredAt: Number(t[5]),
    localDate: String(t[6]),
    timezoneId: String(t[7]),
    postings: postings.map((p) => ({ id: String(p[0]), account: String(p[1]), direction: String(p[2]), signed: Number(p[3]), kind: String(p[4]) })),
    splits: splits.map((s) => ({ id: String(s[0]), category: String(s[1]), amount: Number(s[2]), memo: s[3] === null ? null : String(s[3]) })),
    sources: sources.map((s) => String(s[0])),
  };
}

async function restore(ctx: WriterContext, s: Snap): Promise<void> {
  await ctx.execute('UPDATE "transaction" SET status = ?, capture_resolution = ?, removed_at = ?, removal_kind = ?, amount_minor = ?, occurred_at_utc = ?, local_date = ?, timezone_id = ?, updated_at = ? WHERE id = ?', [
    s.status, s.resolution, s.removedAt, s.removalKind, s.amount, s.occurredAt, s.localDate, s.timezoneId, ctx.nowMs(), s.id,
  ]);
  await ctx.execute('DELETE FROM posting WHERE transaction_id = ?', [s.id]);
  for (const p of s.postings) await ctx.execute('INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, ?)', [p.id, s.id, p.account, p.direction, p.signed, p.kind]);
  await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [s.id]);
  for (const sp of s.splits) await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor, memo) VALUES (?, ?, ?, ?, ?)', [sp.id, s.id, sp.category, sp.amount, sp.memo]);
  for (const src of s.sources) await ctx.execute('UPDATE source_record SET transaction_id = ? WHERE id = ?', [s.id, src]);
}

async function openCandidate(ctx: WriterContext, transactionId: string): Promise<{ id: string; matched: string } | 'resolved' | null> {
  const rows = await ctx.query("SELECT id, matched_transaction_id, status FROM review_candidate WHERE transaction_id = ? AND reason = 'duplicate' ORDER BY created_at DESC, id DESC LIMIT 1", [transactionId]);
  const r = rows[0];
  if (!r || r[1] === null) return null;
  return String(r[2]) === 'open' ? { id: String(r[0]), matched: String(r[1]) } : 'resolved';
}

/** "Keep both": the held entry is confirmed (user_approved) and counts; both entries stay. */
export const KeepBoth: UseCase<{ transactionId: string }, { candidateId: string }, ResolveError> = {
  name: 'KeepBoth',
  async execute(ctx, input) {
    const c = await openCandidate(ctx, input.transactionId);
    if (c === null) return err('NOT_A_DUPLICATE');
    if (c === 'resolved') return err('ALREADY_RESOLVED');
    const before = await snap(ctx, input.transactionId);
    const undo: Undo = { kind: 'keep_both', txs: [before] };
    await ctx.execute("UPDATE \"transaction\" SET status = 'confirmed', capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [ctx.nowMs(), input.transactionId]);
    await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ?, undo_json = ? WHERE id = ?", [ctx.nowMs(), JSON.stringify(undo), c.id]);
    ctx.touch('transaction', input.transactionId, { resolution: 'keep_both' });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId, c.matched] });
    return ok({ candidateId: c.id });
  },
};

/** The best source authority among a transaction's source records (manual when it has none). */
async function authority(ctx: WriterContext, id: string): Promise<number> {
  const rows = await ctx.query('SELECT source_kind FROM source_record WHERE transaction_id = ?', [id]);
  return rows.length === 0 ? 1 : Math.max(...rows.map((r) => SOURCE_AUTHORITY[String(r[0])] ?? 1));
}

async function hasReceipt(ctx: WriterContext, id: string): Promise<boolean> {
  return (await ctx.query("SELECT 1 FROM source_record WHERE transaction_id = ? AND source_kind = 'receipt' LIMIT 1", [id])).length > 0;
}

/**
 * "Merge": one transaction survives. Account, amount and time come from the higher source authority (between two
 * manual entries, the already confirmed one wins); items and splits come from a receipt when there is one, with any
 * extra the bank charged (a tip) as a "Tip / adjustment" split in the receipt's main category; otherwise the category
 * is the user's choice. Every source record moves to the survivor and the other record is excluded, hidden everywhere.
 */
export const MergeDuplicate: UseCase<{ transactionId: string; categoryId?: string }, { survivorId: string; excludedId: string }, ResolveError> = {
  name: 'MergeDuplicate',
  async execute(ctx, input) {
    const c = await openCandidate(ctx, input.transactionId);
    if (c === null) return err('NOT_A_DUPLICATE');
    if (c === 'resolved') return err('ALREADY_RESOLVED');

    const heldId = input.transactionId;
    const confirmedId = c.matched;
    const [heldAuth, confirmedAuth] = [await authority(ctx, heldId), await authority(ctx, confirmedId)];
    // Higher authority wins; between equals the already confirmed one does.
    const survivorId = heldAuth > confirmedAuth ? heldId : confirmedId;
    const otherId = survivorId === heldId ? confirmedId : heldId;

    const before = [await snap(ctx, heldId), await snap(ctx, confirmedId)];
    const survivor = before.find((s) => s.id === survivorId)!;
    const other = before.find((s) => s.id === otherId)!;
    const undo: Undo = { kind: 'merge', txs: before, addedSplitIds: [] };
    const now = ctx.nowMs();

    const otherIsReceipt = await hasReceipt(ctx, otherId);
    const survivorIsReceipt = await hasReceipt(ctx, survivorId);
    const receiptSide = otherIsReceipt ? other : survivorIsReceipt ? survivor : null;

    if (otherIsReceipt && otherId !== survivorId) {
      // The receipt's items become the survivor's splits; the survivor keeps its own amount, account and time.
      const receiptTotal = other.splits.reduce((n, s) => n + s.amount, 0);
      if (survivor.amount >= receiptTotal && other.splits.length > 0) {
        await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [survivorId]);
        await ctx.execute('UPDATE split SET transaction_id = ? WHERE transaction_id = ?', [survivorId, otherId]);
        if (survivor.amount > receiptTotal) {
          const main = [...other.splits].sort((a, b) => b.amount - a.amount)[0]!;
          const tipId = ctx.newId();
          await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor, memo) VALUES (?, ?, ?, ?, ?)', [tipId, survivorId, main.category, survivor.amount - receiptTotal, TIP_CATEGORY_NAME]);
          undo.addedSplitIds!.push(tipId);
        }
      }
    } else if (!receiptSide) {
      // Two ordinary entries: the category is the confirmed entry's unless the user chose.
      const a = survivor.splits[0]?.category;
      const b = other.splits[0]?.category;
      let category = a;
      if (a !== b) {
        if (!input.categoryId) return err('CATEGORY_REQUIRED');
        const k = (await ctx.query('SELECT 1 FROM category WHERE id = ? AND archived = 0', [input.categoryId]))[0];
        if (!k) return err('CATEGORY_NOT_FOUND');
        category = input.categoryId;
      } else if (input.categoryId && input.categoryId !== a) {
        const k = (await ctx.query('SELECT 1 FROM category WHERE id = ? AND archived = 0', [input.categoryId]))[0];
        if (!k) return err('CATEGORY_NOT_FOUND');
        category = input.categoryId;
      }
      if (category && category !== a && survivor.splits.length === 1) await ctx.execute('UPDATE split SET category_id = ? WHERE transaction_id = ?', [category, survivorId]);
    }

    // Every source record follows the survivor; the other record is excluded and hidden everywhere.
    await ctx.execute('UPDATE source_record SET transaction_id = ? WHERE transaction_id = ?', [survivorId, otherId]);
    await ctx.execute("UPDATE \"transaction\" SET status = 'confirmed', capture_resolution = 'user_approved', updated_at = ? WHERE id = ?", [now, survivorId]);
    await ctx.execute("UPDATE \"transaction\" SET status = 'excluded', removed_at = ?, removal_kind = 'excluded', updated_at = ? WHERE id = ?", [now, now, otherId]);
    await ctx.execute("UPDATE review_candidate SET status = 'resolved', resolved_at = ?, undo_json = ? WHERE id = ?", [now, JSON.stringify(undo), c.id]);
    ctx.touch('transaction', survivorId, { resolution: 'merge', survivor: true });
    ctx.touch('transaction', otherId, { resolution: 'merge', excluded: true });
    ctx.emit('TransactionsChanged', { transactionIds: [survivorId, otherId] });
    return ok({ survivorId, excludedId: otherId });
  },
};

/** Undo for Keep both and Merge: every row, split, posting and source link returns to what it was before the choice. */
export const UndoDuplicateResolution: UseCase<{ transactionId: string }, void, ResolveError> = {
  name: 'UndoDuplicateResolution',
  async execute(ctx, input) {
    const rows = await ctx.query("SELECT id, undo_json FROM review_candidate WHERE transaction_id = ? AND reason = 'duplicate' AND status = 'resolved' AND undo_json IS NOT NULL ORDER BY resolved_at DESC, id DESC LIMIT 1", [input.transactionId]);
    const r = rows[0];
    if (!r) return err('NOTHING_TO_UNDO');
    const undo = JSON.parse(String(r[1])) as Undo;
    for (const id of undo.addedSplitIds ?? []) await ctx.execute('DELETE FROM split WHERE id = ?', [id]);
    // Clear every split first: a split the merge moved from one record to the other must not collide when it goes back.
    for (const s of undo.txs) await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [s.id]);
    for (const s of undo.txs) await restore(ctx, s);
    await ctx.execute("UPDATE review_candidate SET status = 'open', resolved_at = NULL, undo_json = NULL WHERE id = ?", [String(r[0])]);
    for (const s of undo.txs) ctx.touch('transaction', s.id, { resolution: 'undone' });
    ctx.emit('TransactionsChanged', { transactionIds: undo.txs.map((s) => s.id) });
    return ok(undefined);
  },
};

/** What the Keep both / Merge choice needs to show: the two entries' categories (and whether they differ). */
export const DUPLICATE_INFO_SQL =
  "SELECT rc.matched_transaction_id, (SELECT c.id FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = rc.transaction_id ORDER BY s.amount_minor DESC, s.id LIMIT 1), (SELECT c.name FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = rc.transaction_id ORDER BY s.amount_minor DESC, s.id LIMIT 1), (SELECT c.id FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = rc.matched_transaction_id ORDER BY s.amount_minor DESC, s.id LIMIT 1), (SELECT c.name FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = rc.matched_transaction_id ORDER BY s.amount_minor DESC, s.id LIMIT 1) FROM review_candidate rc WHERE rc.transaction_id = ? AND rc.reason = 'duplicate' AND rc.status = 'open' ORDER BY rc.created_at DESC LIMIT 1";

export interface DuplicateInfo {
  readonly matchedTransactionId: string;
  readonly heldCategory: { readonly id: string; readonly name: string } | null;
  readonly confirmedCategory: { readonly id: string; readonly name: string } | null;
  readonly categoriesDiffer: boolean;
}

export function mapDuplicateInfo(rows: readonly (readonly unknown[])[]): DuplicateInfo | null {
  const r = rows[0];
  if (!r) return null;
  const cat = (id: unknown, name: unknown) => (id === null || id === undefined ? null : { id: String(id), name: String(name) });
  const held = cat(r[1], r[2]);
  const confirmed = cat(r[3], r[4]);
  return { matchedTransactionId: String(r[0]), heldCategory: held, confirmedCategory: confirmed, categoriesDiffer: held?.id !== confirmed?.id };
}
