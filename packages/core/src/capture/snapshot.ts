import type { WriterContext } from '../writer/ledgerWriter';

/**
 * A full copy of one transaction and what hangs off it (postings, splits, which source records point at it). Edits,
 * deletes, rejects and merges take one before they change anything, so Undo can put every row back exactly.
 */
export interface TxSnapshot {
  readonly id: string;
  readonly status: string;
  readonly resolution: string | null;
  readonly removedAt: number | null;
  readonly removalKind: string | null;
  readonly amount: number;
  readonly occurredAt: number;
  readonly localDate: string;
  readonly timezoneId: string;
  readonly description: string | null;
  readonly note: string | null;
  readonly paymentMethod: string | null;
  readonly needsCategory: number;
  readonly postings: readonly { id: string; account: string; direction: string; signed: number; kind: string }[];
  readonly splits: readonly { id: string; category: string; amount: number; memo: string | null }[];
  readonly sources: readonly string[];
}

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function snapshotTx(ctx: WriterContext, id: string): Promise<TxSnapshot | null> {
  const t = (
    await ctx.query(
      'SELECT status, capture_resolution, removed_at, removal_kind, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, note, payment_method, needs_category FROM "transaction" WHERE id = ?',
      [id],
    )
  )[0];
  if (!t) return null;
  const postings = await ctx.query('SELECT id, account_id, direction, signed_amount_minor, posting_kind FROM posting WHERE transaction_id = ? ORDER BY id', [id]);
  const splits = await ctx.query('SELECT id, category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY id', [id]);
  const sources = await ctx.query('SELECT id FROM source_record WHERE transaction_id = ? ORDER BY id', [id]);
  return {
    id,
    status: String(t[0]),
    resolution: s(t[1]),
    removedAt: t[2] === null ? null : Number(t[2]),
    removalKind: s(t[3]),
    amount: Number(t[4]),
    occurredAt: Number(t[5]),
    localDate: String(t[6]),
    timezoneId: String(t[7]),
    description: s(t[8]),
    note: s(t[9]),
    paymentMethod: s(t[10]),
    needsCategory: Number(t[11]),
    postings: postings.map((p) => ({ id: String(p[0]), account: String(p[1]), direction: String(p[2]), signed: Number(p[3]), kind: String(p[4]) })),
    splits: splits.map((x) => ({ id: String(x[0]), category: String(x[1]), amount: Number(x[2]), memo: s(x[3]) })),
    sources: sources.map((x) => String(x[0])),
  };
}

/** Writes a snapshot back over the live rows: the transaction fields, its postings, its splits and its source links. */
export async function restoreTx(ctx: WriterContext, snap: TxSnapshot): Promise<void> {
  await ctx.execute(
    'UPDATE "transaction" SET status = ?, capture_resolution = ?, removed_at = ?, removal_kind = ?, amount_minor = ?, occurred_at_utc = ?, local_date = ?, timezone_id = ?, original_description = ?, note = ?, payment_method = ?, needs_category = ?, updated_at = ? WHERE id = ?',
    [snap.status, snap.resolution, snap.removedAt, snap.removalKind, snap.amount, snap.occurredAt, snap.localDate, snap.timezoneId, snap.description, snap.note, snap.paymentMethod, snap.needsCategory, ctx.nowMs(), snap.id],
  );
  await ctx.execute('DELETE FROM posting WHERE transaction_id = ?', [snap.id]);
  for (const p of snap.postings) {
    await ctx.execute('INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, ?)', [p.id, snap.id, p.account, p.direction, p.signed, p.kind]);
  }
  await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [snap.id]);
  for (const sp of snap.splits) {
    await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor, memo) VALUES (?, ?, ?, ?, ?)', [sp.id, snap.id, sp.category, sp.amount, sp.memo]);
  }
  for (const src of snap.sources) await ctx.execute('UPDATE source_record SET transaction_id = ? WHERE id = ?', [snap.id, src]);
}
