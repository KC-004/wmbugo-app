import {
  DeleteEntry,
  CATEGORY_LIST_SQL,
  mapCategoryRows,
  mapSplits,
  mapTransactionDetail,
  mapRecoverySummary,
  RECOVERY_SUMMARY_SQL,
  REFUNDABLE_SQL,
  ReverseTransaction,
  SubmitCapture,
  UndoReversal,
  type RecoverySummary,
  type RecoveryKind,
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
  /** Refunds and reimbursements already linked to this expense. */
  readonly recovery: RecoverySummary;
  /** What can still be refunded (null when this is not a refundable expense). */
  readonly refundableMinor: number | null;
  /** The date the entry was reversed (reversed entries only). */
  readonly reversedOn: string | null;
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
  /** A refund or reimbursement for this expense, dated now. */
  refund(transactionId: string, amountMinor: number, recoveryKind: RecoveryKind): Promise<{ ok: true; value: { transactionId: string } } | { ok: false; code: string }>;
  reverse(transactionId: string): Promise<{ ok: true; value: { snapshot: TxSnapshot; reversalId: string } } | { ok: false; code: string }>;
  undoReverse(snapshot: TxSnapshot, reversalId: string): Promise<{ ok: boolean }>;
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
      recovery: mapRecoverySummary(await db.query(RECOVERY_SUMMARY_SQL, [transactionId])),
      refundableMinor: detail.type === 'expense' ? await db.query(REFUNDABLE_SQL, [transactionId]).then((r) => (r[0] ? Number(r[0][0]) : null)) : null,
      reversedOn: detail.status === 'reversed' ? await db.query('SELECT local_date FROM "transaction" WHERE id = (SELECT reversed_by_id FROM "transaction" WHERE id = ?)', [transactionId]).then((r) => (r[0] ? String(r[0][0]) : null)) : null,
    };
  },
  remove: (transactionId, kind) => getServices().writer.run(kind === 'delete' ? DeleteEntry : RejectEntry, { transactionId }, 'user'),
  restore: (snapshot) => getServices().writer.run(RestoreTransaction, { snapshot }, 'user'),
  async setSplits(transactionId, splits, amountMinor) {
    const r = await getServices().writer.run(SetSplits, { transactionId, splits, ...(amountMinor !== undefined ? { amountMinor } : {}) }, 'user');
    return r.ok ? { ok: true, value: { snapshot: r.value.snapshot } } : r;
  },
  async refund(transactionId, amountMinor, recoveryKind) {
    const r = await getServices().writer.run(SubmitCapture, { submissionId: getServices().newId(), sourceKind: 'manual', refund: { originalId: transactionId, amountMinor, recoveryKind } }, 'user');
    return r.ok ? { ok: true, value: { transactionId: r.value.transactionId } } : r;
  },
  reverse: (transactionId) => getServices().writer.run(ReverseTransaction, { transactionId }, 'user'),
  undoReverse: (snapshot, reversalId) => getServices().writer.run(UndoReversal, { snapshot, reversalId }, 'user'),
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
