import type { ReceiptDraft } from '../capture/receipt/types';
import { notItemisedSplit, reconcileReceiptTotal, type SplitRow } from './splits';

export type AllocationState = 'reconciled' | 'not_itemised' | 'mismatch';

export interface AllocatedItem {
  /** Zero-based position in `draft.items`. */
  readonly index: number;
  /** The item after its own discount, plus its share of tax, fees and whole-bill discounts. Never negative. */
  readonly allocatedAmount: number;
  readonly categoryId: string;
}

export interface ReceiptAllocation {
  readonly state: AllocationState;
  /** What the receipt did not itemise (total above everything read), goes to Uncategorised flagged not itemised. 0 unless `not_itemised`. */
  readonly notItemised: number;
  /** How far what was read overshoots the total, or the amount of a discount larger than its item. 0 unless `mismatch`. */
  readonly mismatch: number;
  readonly items: readonly AllocatedItem[];
  /** Per category, the allocated item amounts (not the Not itemised amount). Insertion order follows the printed item order. */
  readonly categoryTotals: Readonly<Record<string, number>>;
  /** The printed tax is part of the item prices, so it is not added again. */
  readonly taxIncluded?: true;
}

/** Prices that include the tax: the items, with fees and discounts, already make the total (the usual receipt in the UK, EU, India and Singapore). */
export const taxIsIncluded = (itemsMinor: number, feesMinor: number, discountsMinor: number, totalMinor: number): boolean => itemsMinor + feesMinor - discountsMinor === totalMinor;

/** floor(a * b / c) for non-negative integers, exact even where a * b passes 2^53. */
const mulDivFloor = (a: number, b: number, c: number): number => Number((BigInt(a) * BigInt(b)) / BigInt(c));

/**
 * Shares one amount over the weights: each gets the floor of its proportion, and the leftover minor units go to the largest weight
 * (the first one on a tie), so the parts add up exactly in any currency exponent.
 */
function spread(amount: number, weights: readonly number[]): number[] {
  if (amount === 0 || weights.length === 0) return weights.map(() => 0);
  const sum = weights.reduce((n, w) => n + w, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const total = sum > 0 ? sum : weights.length;
  const parts = w.map((x) => mulDivFloor(amount, x, total));
  const leftover = amount - parts.reduce((n, p) => n + p, 0);
  let largest = 0;
  for (let i = 1; i < w.length; i++) if (w[i]! > w[largest]!) largest = i;
  parts[largest]! += leftover;
  return parts;
}

/**
 * Turns a read receipt into exact amounts per category (Story 10.3). A discount printed under an item reduces that item only. Tax, fees
 * and whole-bill discounts are spread over the itemised lines in proportion to their amounts after item discounts. What the receipt
 * did not itemise stays one separate amount and never takes tax, fees or discounts. Nothing negative is ever produced: a discount larger
 * than what it applies to is a `mismatch`, not a negative row. With a total and no items read, the whole total is one amount in the main
 * category, as a manual entry would be. A missing total counts as what was read adding up.
 */
export function allocateReceipt(draft: ReceiptDraft, itemCategories: readonly (string | null | undefined)[], mainCategory: string): ReceiptAllocation {
  const items = draft.items;
  const printedTax = draft.taxes.reduce((n, t) => n + t.value, 0);
  const fees = draft.fees.reduce((n, t) => n + t.value, 0);
  const discounts = draft.discounts.reduce((n, t) => n + t.value, 0);
  const categoryOf = (i: number): string => itemCategories[i] || mainCategory;

  const numbers = [printedTax, fees, discounts, draft.total.value ?? 0, ...items.flatMap((i) => [i.amountMinor, i.discountMinor])];
  // Amounts that are not whole minor units, or are negative, cannot be shared exactly: report them instead of guessing.
  if (!numbers.every((n) => Number.isSafeInteger(n) && n >= 0)) return { state: 'mismatch', notItemised: 0, mismatch: 0, items: [], categoryTotals: {} };

  if (items.length === 0) {
    const total = draft.total.value;
    if (total === null || total <= 0) return { state: 'mismatch', notItemised: 0, mismatch: 0, items: [], categoryTotals: {} };
    return { state: 'reconciled', notItemised: 0, mismatch: 0, items: [], categoryTotals: { [mainCategory]: total } };
  }

  // Each item after its own discount; a discount bigger than the item leaves 0 and counts as an excess.
  let excess = 0;
  const net = items.map((it) => {
    const n = it.amountMinor - it.discountMinor;
    if (n < 0) excess += -n;
    return Math.max(0, n);
  });
  const included = printedTax > 0 && excess === 0 && draft.total.value !== null && taxIsIncluded(net.reduce((n, a) => n + a, 0), fees, discounts, draft.total.value);
  const taxes = included ? 0 : printedTax;
  const taxShare = spread(taxes, net);
  const feeShare = spread(fees, net);
  const discountShare = spread(discounts, net);
  const raws = net.map((n, i) => n + taxShare[i]! + feeShare[i]! - discountShare[i]!);
  const allocated = raws.map((r) => Math.max(0, r));
  // Each charge is rounded down on its own, so a tiny item can come out a unit below zero on a receipt that does add up. That unit is
  // taken back from the largest items; only a shortfall nothing can cover is a real excess.
  let deficit = raws.reduce((n, r) => n + (r < 0 ? -r : 0), 0);
  while (deficit > 0) {
    let largest = 0;
    for (let i = 1; i < allocated.length; i++) if (allocated[i]! > allocated[largest]!) largest = i;
    const take = Math.min(allocated[largest]!, deficit);
    if (take === 0) break;
    allocated[largest]! -= take;
    deficit -= take;
  }
  excess += deficit;

  const out: AllocatedItem[] = allocated.map((a, i) => ({ index: i, allocatedAmount: a, categoryId: categoryOf(i) }));
  const categoryTotals: Record<string, number> = {};
  for (const it of out) categoryTotals[it.categoryId] = (categoryTotals[it.categoryId] ?? 0) + it.allocatedAmount;

  const read = allocated.reduce((n, a) => n + a, 0);
  const expected = reconcileReceiptTotal({ itemsMinor: net.reduce((n, a) => n + a, 0), taxMinor: taxes, feesMinor: fees, discountsMinor: discounts });
  const total = draft.total.value ?? expected;

  if (excess > 0) return { state: 'mismatch', notItemised: 0, mismatch: excess, items: out, categoryTotals };
  if (read > total) return { state: 'mismatch', notItemised: 0, mismatch: read - total, items: out, categoryTotals };
  if (read < total) return { state: 'not_itemised', notItemised: total - read, mismatch: 0, items: out, categoryTotals };
  return { state: 'reconciled', notItemised: 0, mismatch: 0, items: out, categoryTotals, ...(included ? { taxIncluded: true as const } : {}) };
}

/**
 * The splits to save for an allocation (LIR-02): one row per category with something in it, in first-seen order, plus one Uncategorised
 * row flagged not itemised for what was not read. A mismatch has no splits: nothing is saved until the person fixes it.
 */
export function toSplits(allocation: ReceiptAllocation): SplitRow[] {
  if (allocation.state === 'mismatch') return [];
  // A Map keeps the printed order whatever the category ids look like (an object would put numeric-looking keys first).
  const totals = new Map<string, number>();
  for (const it of allocation.items) totals.set(it.categoryId, (totals.get(it.categoryId) ?? 0) + it.allocatedAmount);
  if (allocation.items.length === 0) for (const [id, amount] of Object.entries(allocation.categoryTotals)) totals.set(id, amount);
  const rows: SplitRow[] = [...totals.entries()].filter(([, amount]) => amount > 0).map(([categoryId, amountMinor]) => ({ categoryId, amountMinor }));
  const itemised = rows.reduce((n, r) => n + r.amountMinor, 0);
  const gap = notItemisedSplit(itemised + allocation.notItemised, itemised);
  if (gap) rows.push(gap);
  return rows;
}
