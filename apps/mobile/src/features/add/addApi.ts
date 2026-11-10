import {
  ACCOUNT_LIST_SQL,
  categoryFits,
  CATEGORY_LIST_SQL,
  CATEGORY_USE_SQL,
  LAST_ACCOUNT_FOR_CATEGORY_SQL,
  LAST_ACCOUNT_SQL,
  mapAccountRows,
  mapCategoryRows,
  DUPLICATE_INFO_SQL,
  EditTransaction,
  RestoreTransaction,
  type EntryEdit,
  type TransferEdit,
  type TxSnapshot,
  KeepBoth,
  mapDuplicateInfo,
  MergeDuplicate,
  SubmitCapture,
  UndoDuplicateResolution,
  type DuplicateInfo,
  type SubmitResult,
  type TransferInput,
  pickDefaultAccount,
  rankCategories,
  rankIsStale,
  RemoveEntry,
  mapRefundable,
  RECENT_REFUNDABLE_SQL,
  type RefundableExpense,
  type AccountRow,
  type CategoryRow,
  type CurrencyCode,
  type EntryKind,
  type ManualEntry,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

/** The sheet's three segments. */
export type AddKind = EntryKind | 'transfer';

export interface AddData {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
  readonly timezoneId: string;
  /** Every active category of this kind, in seed order (for More). */
  readonly categories: CategoryRow[];
  /** Quick chips: most used first. Fixed for the life of the open sheet. */
  readonly quick: CategoryRow[];
  readonly accounts: AccountRow[];
  /** The account to pick before any category is chosen; null when there is no account yet. */
  readonly defaultAccountId: string | null;
  /** Settings > You > Block transfers above the balance. */
  readonly blockTransfers: boolean;
}

/** A save carries its submission id: saving again with the same id (a retry) returns the first save instead of writing twice. */
export type EntryRequest = ManualEntry & { readonly submissionId: string; /** Made by Duplicate: never held against the entry it was copied from. */ readonly copiedFrom?: string };
export type TransferRequest = TransferInput & { readonly submissionId: string };

export type RecordResult = { ok: true; value: { transactionId: string; accountId: string; result?: SubmitResult } } | { ok: false; code: string };

export type TransferResult = { ok: true; value: { transactionId: string; feeTransactionId: string | null; result?: SubmitResult } } | { ok: false; code: string };

/** What the Add sheet needs. The real one reads and writes through the ledger; tests pass a fake. */
export interface AddApi {
  load(kind: AddKind): Promise<AddData | null>;
  defaultAccountFor(categoryId: string): Promise<string | null>;
  /** A fresh id for one save (UUID v7). */
  newSubmissionId(): string;
  record(entry: EntryRequest): Promise<RecordResult>;
  recordTransfer(input: TransferRequest): Promise<TransferResult>;
  remove(transactionId: string): Promise<{ ok: boolean }>;
  /** Saves changes to an existing entry; the snapshot it returns is what Undo restores. */
  edit(transactionId: string, change: { entry?: EntryEdit; transfer?: TransferEdit }): Promise<{ ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string }>;
  restoreTransaction(snapshot: TxSnapshot): Promise<{ ok: boolean }>;
  /** The two entries' categories for a possible duplicate (so Merge can ask which one), or null when it is not (or no longer) held. */
  duplicateInfo(transactionId: string): Promise<DuplicateInfo | null>;
  keepBoth(transactionId: string): Promise<{ ok: boolean }>;
  merge(transactionId: string, categoryId?: string): Promise<{ ok: boolean; code?: string }>;
  undoResolution(transactionId: string): Promise<{ ok: boolean }>;
  /** Income form, Refunds chip: recent expenses with something left to refund. */
  refundables?(): Promise<RefundableExpense[]>;
  /** Records a refund (linked to an expense when `originalId` is given, else unlinked into Other). */
  recordRefund?(input: { submissionId: string; amountMinor: number; accountId: string | null; originalId?: string; occurredAtMs?: number; note?: string }): Promise<RecordResult>;
}

/** The quick-chip order is recalculated at most once a day, and only when a sheet opens. */
const rankCache = new Map<AddKind, { computedAt: number; ids: string[] }>();

export function resetRankCache(): void {
  rankCache.clear();
}

async function activeAccountIds(): Promise<string[]> {
  const rows = mapAccountRows(await getServices().db.query(ACCOUNT_LIST_SQL));
  return rows.filter((a) => a.status === 'active').map((a) => a.id);
}

export const realAddApi: AddApi = {
  async load(kind) {
    const db = getServices().db;
    const prof = await readProfile(db);
    if (!prof) return null;

    const categories = mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).filter((c) => categoryFits(c.kind, kind === 'income' ? 'income' : 'expense'));
    const now = systemClock.nowMs();
    let cached = rankCache.get(kind);
    if (!cached || rankIsStale(cached.computedAt, now)) {
      const counts = new Map((await db.query(CATEGORY_USE_SQL)).map((r) => [String(r[0]), Number(r[1])] as const));
      cached = { computedAt: now, ids: rankCategories(categories, counts).map((c) => c.id) };
      rankCache.set(kind, cached);
    }
    const byId = new Map(categories.map((c) => [c.id, c]));
    const quick = cached.ids.map((id) => byId.get(id)).filter((c): c is CategoryRow => c !== undefined);

    const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active');
    const settings = prof.settings;
    const lastAny = ((await db.query(LAST_ACCOUNT_SQL))[0]?.[0] as string | undefined) ?? null;
    return {
      currency: prof.currency,
      exponent: prof.exponent,
      locale: prof.locale,
      timezoneId: prof.timezoneId,
      categories,
      quick,
      accounts,
      defaultAccountId: pickDefaultAccount(accounts.map((a) => a.id), null, lastAny, settings.defaultAccountId),
      blockTransfers: settings.blockTransfers,
    };
  },
  async defaultAccountFor(categoryId) {
    const db = getServices().db;
    const ids = await activeAccountIds();
    const forCat = ((await db.query(LAST_ACCOUNT_FOR_CATEGORY_SQL, [categoryId]))[0]?.[0] as string | undefined) ?? null;
    const lastAny = ((await db.query(LAST_ACCOUNT_SQL))[0]?.[0] as string | undefined) ?? null;
    const prof = await readProfile(db);
    return pickDefaultAccount(ids, forCat, lastAny, prof?.settings.defaultAccountId ?? null);
  },
  newSubmissionId: () => getServices().newId(),
  async record({ submissionId, copiedFrom, ...entry }) {
    const r = await getServices().writer.run(SubmitCapture, { submissionId, sourceKind: 'manual', entry, ...(copiedFrom ? { copiedFrom } : {}) }, 'user');
    return r.ok ? { ok: true, value: { transactionId: r.value.transactionId, accountId: r.value.accountId ?? '', result: r.value.result } } : r;
  },
  async recordTransfer({ submissionId, ...transfer }) {
    const r = await getServices().writer.run(SubmitCapture, { submissionId, sourceKind: 'manual', transfer }, 'user');
    return r.ok ? { ok: true, value: { transactionId: r.value.transactionId, feeTransactionId: r.value.feeTransactionId, result: r.value.result } } : r;
  },
  remove: (transactionId) => getServices().writer.run(RemoveEntry, { transactionId }, 'user'),
  async edit(transactionId, change) {
    const r = await getServices().writer.run(EditTransaction, { transactionId, ...change }, 'user');
    return r.ok ? { ok: true, value: { snapshot: r.value.snapshot } } : r;
  },
  restoreTransaction: (snapshot) => getServices().writer.run(RestoreTransaction, { snapshot }, 'user'),
  async duplicateInfo(transactionId) {
    return mapDuplicateInfo(await getServices().db.query(DUPLICATE_INFO_SQL, [transactionId]));
  },
  keepBoth: (transactionId) => getServices().writer.run(KeepBoth, { transactionId }, 'user'),
  merge: (transactionId, categoryId) => getServices().writer.run(MergeDuplicate, { transactionId, ...(categoryId ? { categoryId } : {}) }, 'user'),
  undoResolution: (transactionId) => getServices().writer.run(UndoDuplicateResolution, { transactionId }, 'user'),
  async refundables() {
    return mapRefundable(await getServices().db.query(RECENT_REFUNDABLE_SQL));
  },
  async recordRefund({ submissionId, accountId, ...refund }) {
    const r = await getServices().writer.run(SubmitCapture, { submissionId, sourceKind: 'manual', refund: { ...refund, ...(accountId ? { accountId } : {}) } }, 'user');
    return r.ok ? { ok: true, value: { transactionId: r.value.transactionId, accountId: r.value.accountId ?? '', result: r.value.result } } : r;
  },
};
