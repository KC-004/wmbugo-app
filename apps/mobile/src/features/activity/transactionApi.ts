import {
  DeleteEntry,
  CATEGORY_LIST_SQL,
  mapCategoryRows,
  mapSplits,
  mapTransactionDetail,
  SetSplits,
  SPLITS_SQL,
  type SplitRow,
  type SplitView,
  RejectEntry,
  RestoreTransaction,
  TRANSACTION_DETAIL_SQL,
  type CurrencyCode,
  type PaymentMethod,
  type TransactionDetail,
  type TxSnapshot,
} from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import type { AddPreset, EditSpec } from '../add/AddSheet';

export interface TransactionData {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
  readonly detail: TransactionDetail;
  /** The entry's splits, largest first. */
  readonly splits: SplitView[];
  /** Categories a split row can choose (the entry's kind). */
  readonly categories: { id: string; name: string }[];
}

export type RemoveResult = { ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string };

export interface TransactionApi {
  /** null: no profile. 'missing': no such entry. */
  load(transactionId: string): Promise<TransactionData | 'missing' | null>;
  /** Delete a manual entry, or reject a captured one (Reject · Not mine). */
  remove(transactionId: string, kind: 'delete' | 'reject'): Promise<RemoveResult>;
  restore(snapshot: TxSnapshot): Promise<{ ok: boolean }>;
  /** Replaces the splits (and the amount, when given) in one balanced write. */
  setSplits(transactionId: string, splits: readonly SplitRow[], amountMinor?: number): Promise<{ ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string }>;
}

export const transactionKey = (id: string) => ['ledger', 'transaction', id] as const;

export const realTransactionApi: TransactionApi = {
  async load(transactionId) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const detail = mapTransactionDetail(await db.query(TRANSACTION_DETAIL_SQL, [transactionId]));
    if (!detail) return 'missing';
    const kind = detail.type === 'income' ? 'income' : 'expense';
    return {
      currency: p.currency,
      exponent: p.exponent,
      locale: p.locale,
      detail,
      splits: mapSplits(await db.query(SPLITS_SQL, [transactionId])),
      categories: mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).filter((c) => c.kind === kind).map((c) => ({ id: c.id, name: c.name })),
    };
  },
  remove: (transactionId, kind) => getServices().writer.run(kind === 'delete' ? DeleteEntry : RejectEntry, { transactionId }, 'user'),
  restore: (snapshot) => getServices().writer.run(RestoreTransaction, { snapshot }, 'user'),
  async setSplits(transactionId, splits, amountMinor) {
    const r = await getServices().writer.run(SetSplits, { transactionId, splits, ...(amountMinor !== undefined ? { amountMinor } : {}) }, 'user');
    return r.ok ? { ok: true, value: { snapshot: r.value.snapshot } } : r;
  },
};

/** What the Add sheet opens with to edit this entry (type fixed). Only expenses, incomes and transfers can be edited. */
export function editSpecOf(d: TransactionDetail): EditSpec | null {
  if (d.type !== 'expense' && d.type !== 'income' && d.type !== 'transfer') return null;
  const account = d.type === 'income' ? d.to : d.from;
  return {
    transactionId: d.id,
    kind: d.type,
    amountMinor: d.amountMinor,
    categoryId: d.category?.id ?? null,
    accountId: account?.id ?? null,
    toAccountId: d.type === 'transfer' ? (d.to?.id ?? null) : null,
    merchant: d.merchant,
    note: d.note,
    paymentMethod: (d.paymentMethod as PaymentMethod | null) ?? null,
    occurredAtMs: d.occurredAtMs,
    splitCount: d.splitCount,
  };
}

/** Duplicate: amount, type, category, account, merchant and note are copied; the date and time are now. */
export function duplicatePresetOf(d: TransactionDetail): AddPreset | null {
  const e = editSpecOf(d);
  if (!e) return null;
  return {
    kind: e.kind,
    accountId: e.accountId,
    ...(e.toAccountId ? { toAccountId: e.toAccountId } : {}),
    amountMinor: e.amountMinor,
    categoryId: e.categoryId,
    merchant: e.merchant,
    note: e.note,
    paymentMethod: e.paymentMethod,
    copiedFrom: d.id,
  };
}
