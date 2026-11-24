import { allocateReceipt, type ReceiptAllocation, type ReceiptCharge, type ReceiptDraft, type ReceiptItem } from '@wmbugo/core';

/**
 * The receipt review's state (Story 10.4, SCR-23). Pure: every edit returns a new state, and `viewOf` derives what the screen shows,
 * so the allocation reruns after each edit and the rules for Save live in one place.
 */
export interface ReviewState {
  /** The draft with the person's corrections applied. */
  readonly draft: ReceiptDraft;
  /** The person confirmed or typed the total, so an unsure or missing one no longer blocks Save. */
  readonly totalConfirmed: boolean;
  /** The person changed the date, so the `date?` warning goes. */
  readonly dateEdited: boolean;
  readonly mainCategoryId: string;
  /** What the person chose for each item (by position in `draft.items`), or null while it follows the main category. */
  readonly itemChoices: readonly (string | null)[];
  readonly accountId: string | null;
}

export type ChargeKind = 'taxes' | 'fees' | 'discounts';

export function initialReview(draft: ReceiptDraft, defaults: { mainCategoryId: string; accountId: string | null }): ReviewState {
  return { draft, totalConfirmed: false, dateEdited: false, mainCategoryId: defaults.mainCategoryId, itemChoices: draft.items.map(() => null), accountId: defaults.accountId };
}

const sure = <T>(value: T) => ({ value, certainty: 'sure' as const });

export const setMerchant = (s: ReviewState, merchant: string): ReviewState => ({ ...s, draft: { ...s.draft, merchant: merchant.trim() === '' ? { value: null, certainty: 'missing' } : sure(merchant.trim()) } });
export const setDate = (s: ReviewState, date: string): ReviewState => ({ ...s, dateEdited: true, draft: { ...s.draft, date: sure(date) } });
/** Typing or correcting the total also confirms it. */
export const setTotal = (s: ReviewState, totalMinor: number): ReviewState => ({ ...s, totalConfirmed: true, draft: { ...s.draft, total: sure(totalMinor) } });
export const confirmTotal = (s: ReviewState): ReviewState => ({ ...s, totalConfirmed: true });
export const setSubtotal = (s: ReviewState, minor: number): ReviewState => ({ ...s, draft: { ...s.draft, subtotal: sure(minor) } });
export const setAccount = (s: ReviewState, accountId: string): ReviewState => ({ ...s, accountId });

export function setCharge(s: ReviewState, kind: ChargeKind, index: number, minor: number): ReviewState {
  const list: readonly ReceiptCharge[] = s.draft[kind];
  if (index < 0 || index >= list.length) return s;
  return { ...s, draft: { ...s.draft, [kind]: list.map((c, i) => (i === index ? { ...c, value: minor, certainty: 'sure' as const } : c)) } };
}

/** Changing the main category moves only the items still following it. */
export const setMainCategory = (s: ReviewState, categoryId: string): ReviewState => ({ ...s, mainCategoryId: categoryId });

/** `null` puts the item back on the main category. */
export function setItemCategory(s: ReviewState, index: number, categoryId: string | null): ReviewState {
  if (index < 0 || index >= s.itemChoices.length) return s;
  return { ...s, itemChoices: s.itemChoices.map((c, i) => (i === index ? categoryId : c)) };
}

/** Corrects an item's name or printed amount; its own discount and category stay. A blank name is ignored. */
export function editItem(s: ReviewState, index: number, patch: { name?: string; amountMinor?: number }): ReviewState {
  if (index < 0 || index >= s.draft.items.length) return s;
  if (patch.amountMinor !== undefined && (!Number.isSafeInteger(patch.amountMinor) || patch.amountMinor <= 0)) return s;
  const items: ReceiptItem[] = s.draft.items.map((it, i) => {
    if (i !== index) return it;
    const name = patch.name !== undefined && patch.name.trim() !== '' ? patch.name.trim() : it.name;
    const amountMinor = patch.amountMinor ?? it.amountMinor;
    // The item's own discount can never be more than the item.
    return { ...it, name, amountMinor, discountMinor: Math.min(it.discountMinor, amountMinor), certainty: 'sure' };
  });
  return { ...s, draft: { ...s.draft, items } };
}

/** Takes an item out: its amount goes to Not itemised while the total stays, or the receipt becomes a mismatch if the items now exceed it. */
export function removeItem(s: ReviewState, index: number): ReviewState {
  if (index < 0 || index >= s.draft.items.length) return s;
  return { ...s, draft: { ...s.draft, items: s.draft.items.filter((_, i) => i !== index) }, itemChoices: s.itemChoices.filter((_, i) => i !== index) };
}

/** A line the reader missed, put at the end in the category the person chose. */
export function addItem(s: ReviewState, item: { name: string; amountMinor: number; categoryId: string | null }): ReviewState {
  const name = item.name.trim();
  if (name === '' || !Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0) return s;
  const lineIndex = s.draft.items.reduce((n, i) => Math.max(n, i.lineIndex), -1) + 1;
  const added: ReceiptItem = { name, amountMinor: item.amountMinor, discountMinor: 0, lineIndex, certainty: 'sure' };
  return { ...s, draft: { ...s.draft, items: [...s.draft.items, added] }, itemChoices: [...s.itemChoices, item.categoryId] };
}

export interface ReviewView {
  readonly allocation: ReceiptAllocation;
  /** One row per category, largest first. */
  readonly categoryRows: readonly { readonly categoryId: string; readonly amountMinor: number }[];
  /** The itemised amount the items add up to, tax, fees and discounts included. */
  readonly readMinor: number;
  readonly totalNeedsConfirm: boolean;
  /** The date shown: the read one, or today when none was read. */
  readonly date: string;
  readonly dateUncertain: boolean;
  readonly canSave: boolean;
  /** Why Save is disabled, in the words of its hint; null when it is enabled. */
  readonly blocked: 'total' | 'mismatch' | null;
}

export function viewOf(s: ReviewState, todayLocal: string): ReviewView {
  const itemCategories = s.itemChoices.map((c) => c ?? s.mainCategoryId);
  const allocation = allocateReceipt(s.draft, itemCategories, s.mainCategoryId);
  const categoryRows = Object.entries(allocation.categoryTotals)
    .map(([categoryId, amountMinor]) => ({ categoryId, amountMinor }))
    .filter((r) => r.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);
  const readMinor = allocation.items.reduce((n, i) => n + i.allocatedAmount, 0);
  const totalNeedsConfirm = s.draft.total.certainty !== 'sure' && !s.totalConfirmed;
  const total = s.draft.total.value;
  const noTotal = total === null || total <= 0;
  const blocked: ReviewView['blocked'] = totalNeedsConfirm || noTotal ? 'total' : allocation.state === 'mismatch' ? 'mismatch' : null;
  return {
    allocation,
    categoryRows,
    readMinor,
    totalNeedsConfirm,
    date: s.draft.date.value ?? todayLocal,
    dateUncertain: s.draft.date.certainty !== 'sure' && !s.dateEdited,
    canSave: blocked === null,
    blocked,
  };
}

/** What the save needs, or null when the review cannot be saved yet. */
export function saveInput(s: ReviewState, todayLocal: string) {
  const v = viewOf(s, todayLocal);
  if (!v.canSave) return null;
  // The date defaults to today when none was read, and the draft carries it so the saved entry uses it.
  const draft: ReceiptDraft = s.draft.date.value === null ? { ...s.draft, date: sure(todayLocal) } : s.draft;
  // Null means the item follows the main category; only the ones the person chose are reported as chosen.
  return { draft, itemCategories: s.itemChoices, mainCategoryId: s.mainCategoryId, accountId: s.accountId };
}
