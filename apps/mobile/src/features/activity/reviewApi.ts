import {
  ApproveCapture,
  BulkRecategorise,
  CATEGORY_LIST_SQL,
  ACCOUNT_LIST_SQL,
  ConfirmForeignAmount,
  DeleteEntry,
  mapAccountRows,
  mapCategoryRows,
  mapReviewItems,
  mapReviewSides,
  NEEDS_CATEGORY_SQL,
  RejectEntry,
  RestoreTransaction,
  REVIEW_SIDE_SQL,
  TO_CHECK_SQL,
  UndoBulkRecategorise,
  UndoReviewDecision,
  type CurrencyCode,
  type ReviewItem,
  type ReviewSide,
  type TxSnapshot,
} from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface ReviewData {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
  readonly items: ReviewItem[];
  /** Confirmed entries still waiting for a category (never counted in "N to check"). */
  readonly needsCategory: ReviewSide[];
  readonly accounts: { id: string; name: string }[];
  readonly categories: { id: string; name: string; kind: string }[];
}

type Snap = { ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string };

export interface ReviewApi {
  load(): Promise<ReviewData | null>;
  approve(transactionId: string): Promise<Snap>;
  confirmForeign(transactionId: string, amountMinor: number, accountId: string): Promise<Snap>;
  undoDecision(snapshot: TxSnapshot): Promise<{ ok: boolean }>;
  /** Delete (manual) or Reject · Not mine (captured). */
  remove(transactionId: string, kind: 'delete' | 'reject'): Promise<Snap>;
  restore(snapshot: TxSnapshot): Promise<{ ok: boolean }>;
  assignCategory(transactionId: string, categoryId: string): Promise<{ ok: true; value: { previous: { id: string; categoryId: string }[] } } | { ok: false; code: string }>;
  undoCategory(previous: readonly { id: string; categoryId: string }[]): Promise<{ ok: boolean }>;
}

export const REVIEW_QUEUE_KEY = ['ledger', 'review'] as const;

export const realReviewQueueApi: ReviewApi = {
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const rows = await db.query(TO_CHECK_SQL);
    const matched = new Map<string, ReviewSide>();
    for (const r of rows) {
      if (r[10] === null) continue;
      for (const s of mapReviewSides(await db.query(REVIEW_SIDE_SQL, [String(r[10])]))) matched.set(s.id, s);
    }
    return {
      currency: p.currency,
      exponent: p.exponent,
      locale: p.locale,
      items: mapReviewItems(rows, matched),
      needsCategory: mapReviewSides(await db.query(NEEDS_CATEGORY_SQL)),
      accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name })),
      categories: mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    };
  },
  approve: (transactionId) => getServices().writer.run(ApproveCapture, { transactionId }, 'user'),
  confirmForeign: (transactionId, amountMinor, accountId) => getServices().writer.run(ConfirmForeignAmount, { transactionId, amountMinor, accountId }, 'user'),
  undoDecision: (snapshot) => getServices().writer.run(UndoReviewDecision, { snapshot }, 'user'),
  remove: (transactionId, kind) => getServices().writer.run(kind === 'delete' ? DeleteEntry : RejectEntry, { transactionId }, 'user'),
  restore: (snapshot) => getServices().writer.run(RestoreTransaction, { snapshot }, 'user'),
  async assignCategory(transactionId, categoryId) {
    const r = await getServices().writer.run(BulkRecategorise, { transactionIds: [transactionId], categoryId }, 'user');
    return r.ok ? { ok: true, value: { previous: r.value.previous } } : r;
  },
  undoCategory: (previous) => getServices().writer.run(UndoBulkRecategorise, { previous }, 'user'),
};
