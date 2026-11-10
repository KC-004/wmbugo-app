import { linkedRefundsMinor } from './refunds';
import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import { snapshotTx, type TxSnapshot } from '../capture/snapshot';
import { UNCATEGORISED_ID } from './categories';

/** Marks the split that holds what a receipt did not itemise (shown as a grey "Not itemised" row, counted as assigned). */
export const NOT_ITEMISED_MEMO = 'not_itemised';

export interface SplitRow {
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly memo?: string | null;
}

/** What is still to give a category: the total minus the rows. Negative means the rows add up to too much. */
export function leftToAssign(totalMinor: number, amountsMinor: readonly number[]): number {
  return totalMinor - amountsMinor.reduce((n, a) => n + a, 0);
}

/**
 * Shares a total across weights in whole minor units (largest remainder), so the parts always add up exactly, in any
 * currency exponent. Nothing is balanced for the user: this is for helpers such as an even split.
 */
export function allocateProportional(totalMinor: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (weights.length === 0 || sum <= 0 || !Number.isSafeInteger(totalMinor) || totalMinor < 0) return weights.map(() => 0);
  const exact = weights.map((w) => (totalMinor * w) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = totalMinor - floors.reduce((n, f) => n + f, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}

/** items + tax + fees - discounts - adjustments, in exact minor units (a receipt's total). */
export function reconcileReceiptTotal(r: { itemsMinor: number; taxMinor?: number; feesMinor?: number; discountsMinor?: number; adjustmentsMinor?: number }): number {
  return r.itemsMinor + (r.taxMinor ?? 0) + (r.feesMinor ?? 0) - (r.discountsMinor ?? 0) - (r.adjustmentsMinor ?? 0);
}

/** A shortfall between what was paid and what a receipt itemised becomes one Uncategorised split flagged not itemised; none when it matches. */
export function notItemisedSplit(totalMinor: number, itemisedMinor: number): SplitRow | null {
  const gap = totalMinor - itemisedMinor;
  return gap > 0 ? { categoryId: UNCATEGORISED_ID, amountMinor: gap, memo: NOT_ITEMISED_MEMO } : null;
}

/** For the editor: what is left to assign, ignoring "not itemised" rows only in the sense that they count as assigned (they are rows like any other). */
export function remainderOf(totalMinor: number, rows: readonly SplitRow[]): number {
  return leftToAssign(totalMinor, rows.map((r) => r.amountMinor));
}

export type SetSplitsError =
  | 'ENTRY_NOT_FOUND'
  | 'ENTRY_REMOVED'
  | 'NOT_SPLITTABLE'
  | 'SPLITS_EMPTY'
  | 'BELOW_REFUNDS'
  | 'SPLIT_AMOUNT_INVALID'
  | 'AMOUNT_INVALID'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_KIND_MISMATCH'
  | 'SPLITS_DONT_SUM';

/**
 * Replaces an entry's splits (Story 3.7). The rows must add up exactly to the entry's amount (or to the new amount, when
 * the amount is changed in the same call: an amount change commits only together with balanced splits). Nothing is ever
 * balanced automatically. One row left means a single split for the full amount. Returns the state before, for Undo.
 */
export const SetSplits: UseCase<
  { transactionId: string; splits: readonly SplitRow[]; amountMinor?: number },
  { snapshot: TxSnapshot; categoryChanged: boolean },
  SetSplitsError
> = {
  name: 'SetSplits',
  async execute(ctx, input) {
    const before = await snapshotTx(ctx, input.transactionId);
    if (!before) return err('ENTRY_NOT_FOUND');
    if (before.removedAt !== null) return err('ENTRY_REMOVED');
    const type = String((await ctx.query('SELECT event_type FROM "transaction" WHERE id = ?', [input.transactionId]))[0]![0]);
    if ((type !== 'expense' && type !== 'income') || before.postings.length !== 1 || before.status === 'reversed') return err('NOT_SPLITTABLE');
    if (input.splits.length === 0) return err('SPLITS_EMPTY');

    const amount = input.amountMinor ?? before.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) return err('AMOUNT_INVALID');
    if (type === 'expense' && amount < before.amount && amount < (await linkedRefundsMinor(ctx, input.transactionId))) return err('BELOW_REFUNDS');
    for (const s of input.splits) if (!Number.isSafeInteger(s.amountMinor) || s.amountMinor <= 0) return err('SPLIT_AMOUNT_INVALID');
    for (const id of new Set(input.splits.map((s) => s.categoryId))) {
      const c = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [id]))[0];
      if (!c) return err('CATEGORY_NOT_FOUND');
      if (String(c[0]) !== type) return err('CATEGORY_KIND_MISMATCH');
    }
    if (leftToAssign(amount, input.splits.map((s) => s.amountMinor)) !== 0) return err('SPLITS_DONT_SUM');

    const now = ctx.nowMs();
    if (amount !== before.amount) {
      await ctx.execute('UPDATE "transaction" SET amount_minor = ?, updated_at = ? WHERE id = ?', [amount, now, input.transactionId]);
      await ctx.execute('UPDATE posting SET signed_amount_minor = ? WHERE id = ?', [type === 'expense' ? -amount : amount, before.postings[0]!.id]);
    }
    await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [input.transactionId]);
    await ctx.execute('UPDATE "transaction" SET needs_category = 0 WHERE id = ?', [input.transactionId]);
    for (const s of input.splits) {
      await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor, memo) VALUES (?, ?, ?, ?, ?)', [ctx.newId(), input.transactionId, s.categoryId, s.amountMinor, s.memo ?? null]);
    }
    const sameSet = JSON.stringify([...before.splits].map((x) => [x.category, x.amount]).sort()) === JSON.stringify(input.splits.map((x) => [x.categoryId, x.amountMinor]).sort());
    ctx.touch('transaction', input.transactionId, { splits: input.splits.length, ...(amount !== before.amount ? { amountChanged: true } : {}) });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    if (!sameSet) ctx.emit('CategoryAssigned', { transactionIds: [input.transactionId] });
    return ok({ snapshot: before, categoryChanged: !sameSet });
  },
};

/** One entry's splits with their category names, largest first. Param: transaction id. */
export const SPLITS_SQL =
  'SELECT s.id, s.category_id, c.name, c.icon, c.color_token, s.amount_minor, s.memo FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = ? ORDER BY s.amount_minor DESC, s.id';

export interface SplitView {
  readonly id: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly icon: string;
  readonly color: string;
  readonly amountMinor: number;
  /** Not itemised: counted as assigned, shown grey. */
  readonly notItemised: boolean;
}

export function mapSplits(rows: readonly (readonly unknown[])[]): SplitView[] {
  return rows.map((r) => ({
    id: String(r[0]),
    categoryId: String(r[1]),
    categoryName: String(r[2]),
    icon: String(r[3]),
    color: String(r[4]),
    amountMinor: Number(r[5]),
    notItemised: r[6] !== null && String(r[6]) === NOT_ITEMISED_MEMO,
  }));
}
