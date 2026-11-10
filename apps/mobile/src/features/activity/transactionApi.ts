import {
  DeleteEntry,
  CATEGORY_LIST_SQL,
  mapCategoryRows,
  mapSplits,
  mapTransactionDetail,
  mapRecoverySummary,
  RestoreDeleted,
  RestoreRejected,
  AddAttachment,
  ATTACHMENTS_SQL,
  mapAttachments,
  mapSources,
  RemoveAttachment,
  SOURCES_SQL,
  type Attachment,
  type SourceLine,
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
import type { ReceiptFiles } from '../../adapters/files/receiptFiles';
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
  /** How a removed entry was removed: 'deleted' (manual) or 'rejected' (captured); null while it is live. */
  readonly removalKind: 'deleted' | 'rejected' | null;
  /** Receipt photos, oldest first. */
  readonly attachments: Attachment[];
  /** Every source with its kind and time. */
  readonly sources: SourceLine[];
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
  /** Restore a removed entry (deleted manual entry, or rejected capture). Returns the entry as it was, for Undo. */
  restoreRemoved?(transactionId: string, kind: 'deleted' | 'rejected'): Promise<{ ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string }>;
  /** Opens the picker, encrypts the chosen image, then records it. */
  addPhoto?(transactionId: string): Promise<'added' | 'duplicate' | 'cancelled' | 'failed'>;
  /** Deletes the row, then the file. */
  removePhoto?(attachmentId: string): Promise<{ ok: boolean }>;
  /** A plain temporary path to show the photo. */
  photoPath?(attachmentId: string): Promise<string>;
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
      removalKind: await db.query('SELECT removal_kind FROM "transaction" WHERE id = ?', [transactionId]).then((r) => (r[0] && (r[0][0] === 'deleted' || r[0][0] === 'rejected') ? (r[0][0] as 'deleted' | 'rejected') : null)),
      attachments: mapAttachments(await db.query(ATTACHMENTS_SQL, [transactionId])),
      sources: mapSources(await db.query(SOURCES_SQL, [transactionId])),
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
  restoreRemoved: (transactionId, kind) => getServices().writer.run(kind === 'deleted' ? RestoreDeleted : RestoreRejected, { transactionId }, 'user'),
  // The photo adapter pulls in native file modules, so it is loaded when first used.
  addPhoto: async (id) => (await lazyPhotos()).addPhoto(id),
  removePhoto: async (id) => (await lazyPhotos()).removePhoto(id),
  photoPath: async (id) => (await lazyPhotos()).photoPath(id),
};

async function lazyPhotos() {
  const { realReceiptFiles } = await import('../../adapters/files/receiptFiles');
  return photoApi(realReceiptFiles);
}

/** Receipt photos: the file is written encrypted BEFORE the row commits; a duplicate or failure removes the file again. */
export function photoApi(files: ReceiptFiles): Required<Pick<TransactionApi, 'addPhoto' | 'removePhoto' | 'photoPath'>> {
  return {
    async addPhoto(transactionId) {
      let uri: string | null;
      try {
        uri = await files.pick();
      } catch {
        return 'failed';
      }
      if (uri === null) return 'cancelled';
      const attachmentId = getServices().newId();
      try {
        const { digest, size } = await files.importPhoto(uri, attachmentId);
        const r = await getServices().writer.run(AddAttachment, { transactionId, attachmentId, digest, sizeBytes: Math.max(1, Math.round(size)) }, 'user');
        if (r.ok) return 'added';
        await files.remove(attachmentId).catch(() => undefined);
        return r.code === 'ALREADY_ATTACHED' ? 'duplicate' : 'failed';
      } catch {
        await files.remove(attachmentId).catch(() => undefined);
        return 'failed';
      }
    },
    async removePhoto(attachmentId) {
      const r = await getServices().writer.run(RemoveAttachment, { attachmentId }, 'user');
      if (!r.ok) return { ok: false };
      // The row is gone and committed: now the file.
      await files.remove(attachmentId).catch(() => undefined);
      return { ok: true };
    },
    photoPath: (attachmentId) => files.viewPath(attachmentId),
  };
}

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
