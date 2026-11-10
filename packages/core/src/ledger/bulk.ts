import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { categoryFits } from './categories';

/**
 * Select many and move them to another category (Story 3.9, TXN-010). Only the category of a confirmed, single-category
 * expense or income changes; amounts, postings, dates and everything else stay exactly as they were.
 */

export interface BulkRow {
  readonly id: string;
  readonly eventType: string;
  readonly status: string;
  readonly removed: boolean;
  readonly splitCount: number;
  /** The category of its only split (null when it has none or several). */
  readonly categoryId: string | null;
  readonly needsCategory?: boolean;
}

/** What can be moved to a category of this kind: confirmed, live, single-category expenses/incomes of the same kind, not already there. */
export function isMovable(row: BulkRow, target: { id: string; kind: string }): boolean {
  return (
    !row.removed &&
    row.status === 'confirmed' &&
    row.splitCount === 1 &&
    categoryFits(target.kind, row.eventType) &&
    (row.eventType === 'expense' || row.eventType === 'income') &&
    row.categoryId !== target.id
  );
}

export interface BulkPreview {
  readonly movableIds: string[];
  /** Entries that will not change: transfers, splits, refunds, entries still to check, wrong kind, already there. */
  readonly wontChange: number;
  /** The one category the movable entries all come from, or null when they come from several. */
  readonly fromCategoryId: string | null;
  readonly mixedSources: boolean;
}

export function classifyBulk(rows: readonly BulkRow[], target: { id: string; kind: string }): BulkPreview {
  const movable = rows.filter((r) => isMovable(r, target));
  const sources = new Set(movable.map((r) => r.categoryId));
  return {
    movableIds: movable.map((r) => r.id),
    wontChange: rows.length - movable.length,
    fromCategoryId: sources.size === 1 ? ([...sources][0] ?? null) : null,
    mixedSources: sources.size > 1,
  };
}

/** The columns `mapBulkRows` reads, for a list of ids (up to 500 per query). */
export function bulkRowsSql(count: number): string {
  return `SELECT t.id, t.event_type, t.status, t.removed_at IS NOT NULL, (SELECT COUNT(*) FROM split s WHERE s.transaction_id = t.id), (SELECT s.category_id FROM split s WHERE s.transaction_id = t.id ORDER BY s.id LIMIT 1), t.needs_category FROM "transaction" t WHERE t.id IN (${Array.from({ length: count }, () => '?').join(',')})`;
}

export const BULK_CHUNK = 500;

export function mapBulkRows(rows: readonly (readonly unknown[])[]): BulkRow[] {
  return rows.map((r) => ({
    id: String(r[0]),
    eventType: String(r[1]),
    status: String(r[2]),
    removed: Number(r[3]) === 1,
    splitCount: Number(r[4]),
    categoryId: Number(r[4]) === 1 && r[5] !== null ? String(r[5]) : null,
    needsCategory: Number(r[6]) === 1,
  }));
}

export type BulkError = 'NOTHING_SELECTED' | 'CATEGORY_NOT_FOUND' | 'AMOUNTS_CHANGED';

export interface BulkMoved {
  readonly movedIds: string[];
  readonly skipped: number;
  /** Where each moved entry was, for Undo. */
  readonly previous: { readonly id: string; readonly categoryId: string; readonly needsCategory?: boolean }[];
}

async function rowsFor(ctx: WriterContext, ids: readonly string[]): Promise<BulkRow[]> {
  const out: BulkRow[] = [];
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    out.push(...mapBulkRows(await ctx.query(bulkRowsSql(chunk.length), chunk)));
  }
  return out;
}

/** Amount and postings of each entry, to prove nothing but the category changed. */
async function fingerprint(ctx: WriterContext, ids: readonly string[]): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    const marks = chunk.map(() => '?').join(',');
    const rows = await ctx.query(
      `SELECT t.id, t.amount_minor, t.local_date, (SELECT group_concat(p.id || ':' || p.account_id || ':' || p.signed_amount_minor, '|') FROM (SELECT * FROM posting WHERE transaction_id = t.id ORDER BY id) p) FROM "transaction" t WHERE t.id IN (${marks}) ORDER BY t.id`,
      chunk,
    );
    for (const r of rows) parts.push(r.map(String).join('~'));
  }
  return parts.join('\n');
}

/**
 * Moves the chosen entries to a category in one writer transaction: an audit row per entry, one `CategoryAssigned` event,
 * and a check that every amount and posting is unchanged. Entries that cannot move (see `isMovable`) are skipped and counted.
 */
export const BulkRecategorise: UseCase<{ transactionIds: readonly string[]; categoryId: string }, BulkMoved, BulkError> = {
  name: 'BulkRecategorise',
  async execute(ctx, input) {
    const ids = [...new Set(input.transactionIds)];
    if (ids.length === 0) return err('NOTHING_SELECTED');
    const c = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [input.categoryId]))[0];
    if (!c) return err('CATEGORY_NOT_FOUND');
    const target = { id: input.categoryId, kind: String(c[0]) };

    const rows = await rowsFor(ctx, ids);
    const preview = classifyBulk(rows, target);
    const movable = new Set(preview.movableIds);
    const moving = rows.filter((r) => movable.has(r.id));
    const before = await fingerprint(ctx, moving.map((r) => r.id));

    const now = ctx.nowMs();
    for (const r of moving) {
      await ctx.execute('UPDATE split SET category_id = ? WHERE transaction_id = ?', [input.categoryId, r.id]);
      await ctx.execute('UPDATE "transaction" SET updated_at = ?, needs_category = 0 WHERE id = ?', [now, r.id]);
      ctx.touch('transaction', r.id, { edited: true, fields: 'category', bulk: true });
    }
    if ((await fingerprint(ctx, moving.map((r) => r.id))) !== before) return err('AMOUNTS_CHANGED');

    const movedIds = moving.map((r) => r.id);
    if (movedIds.length > 0) {
      ctx.emit('TransactionsChanged', { transactionIds: movedIds });
      ctx.emit('CategoryAssigned', { transactionIds: movedIds });
    }
    return ok({ movedIds, skipped: ids.length - movedIds.length, previous: moving.map((r) => ({ id: r.id, categoryId: r.categoryId!, needsCategory: r.needsCategory === true })) });
  },
};

/** Undo: every moved entry goes back to the category it had, in one step. */
export const UndoBulkRecategorise: UseCase<{ previous: readonly { id: string; categoryId: string; needsCategory?: boolean }[] }, { restored: number }, never> = {
  name: 'UndoBulkRecategorise',
  async execute(ctx, input) {
    const now = ctx.nowMs();
    const restoredIds: string[] = [];
    for (const p of input.previous) {
      const rows = await rowsFor(ctx, [p.id]);
      const row = rows[0];
      // Only an entry that still has exactly one split can go back; one split since is left as the user made it.
      if (!row || row.removed || row.splitCount !== 1) continue;
      await ctx.execute('UPDATE split SET category_id = ? WHERE transaction_id = ?', [p.categoryId, p.id]);
      await ctx.execute('UPDATE "transaction" SET updated_at = ?, needs_category = ? WHERE id = ?', [now, p.needsCategory ? 1 : 0, p.id]);
      ctx.touch('transaction', p.id, { edited: true, fields: 'category', bulkUndo: true });
      restoredIds.push(p.id);
    }
    if (restoredIds.length > 0) {
      ctx.emit('TransactionsChanged', { transactionIds: restoredIds });
      ctx.emit('CategoryAssigned', { transactionIds: restoredIds });
    }
    return ok({ restored: restoredIds.length });
  },
};
