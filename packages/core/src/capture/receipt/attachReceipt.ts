import { err, ok } from '../../shared/result';
import type { UseCase } from '../../writer/ledgerWriter';
import { allocateReceipt, toSplits } from '../../ledger/allocateReceipt';
import { SetSplits, type SetSplitsError, type SplitRow } from '../../ledger/splits';
import { AddAttachment, type AttachError } from '../attachments';
import { restoreTx, snapshotTx, type TxSnapshot } from '../snapshot';
import { TIP_CATEGORY_NAME } from '../resolveDuplicate';
import type { ReceiptDraft } from './types';

export interface AttachReceiptInput {
  /** Stable per scan, so a retry of the same attach writes nothing twice. */
  readonly submissionId: string;
  /** The recorded entry the receipt belongs to. It keeps its account, amount, time and status. */
  readonly transactionId: string;
  readonly draft: ReceiptDraft;
  readonly itemCategories: readonly (string | null)[];
  readonly mainCategoryId: string;
  /** The entry already has receipt items: `replace` swaps them for these, `keep` leaves them. Required then; the photo is attached either way. */
  readonly itemsMode?: 'replace' | 'keep';
  /** The photo, already encrypted on disk under this id. */
  readonly attachment?: { readonly attachmentId: string; readonly digest: string; readonly sizeBytes: number };
  /** Attach the photo and nothing else: no items, no splits (Story 10.9, `Attach photo only`). */
  readonly photoOnly?: boolean;
}

export type AttachReceiptError =
  | SetSplitsError
  | AttachError
  | 'TOTAL_REQUIRED'
  | 'RECEIPT_MISMATCH'
  | 'SUBMISSION_INVALID'
  | 'RECEIPT_EXCEEDS_ENTRY'
  | 'ITEMS_CHOICE_REQUIRED'
  | 'NOT_AN_EXPENSE';

/** Everything `UndoAttachReceipt` needs to put the entry back exactly as it was. */
export interface AttachReceiptUndo {
  readonly before: TxSnapshot;
  readonly addedSourceIds: readonly string[];
  readonly addedAttachmentIds: readonly string[];
  readonly addedItemIds: readonly string[];
  /** Receipt items the attach replaced. */
  readonly removedItems: readonly (readonly unknown[])[];
}

export interface AttachedReceipt {
  readonly transactionId: string;
  /** The difference between the entry and the receipt that became a `Tip / adjustment` split, 0 when none. */
  readonly adjustmentMinor: number;
  readonly undo: AttachReceiptUndo;
  readonly alreadyDone: boolean;
}

const ITEM_COLS = 'id, transaction_id, name, amount_minor, discount_minor, allocated_minor, category_id, line_index';

/**
 * Attaches a reviewed receipt to an entry that already exists (Story 10.8, OCR-006, OCR-010; also Story 10.9): the entry keeps its
 * account, amount, time and status, and gains the photo, a `receipt` source record, the receipt items and the receipt's category
 * splits in one writer transaction. What the entry charged above the receipt becomes a `Tip / adjustment` split in the receipt's
 * largest category. A receipt that totals more than the entry is refused: nothing is changed.
 */
export const AttachReceipt: UseCase<AttachReceiptInput, AttachedReceipt, AttachReceiptError> = {
  name: 'AttachReceipt',
  async execute(ctx, input) {
    if (typeof input.submissionId !== 'string' || input.submissionId.trim() === '') return err('SUBMISSION_INVALID');
    const seen = (await ctx.query('SELECT 1 FROM source_record WHERE fingerprint = ?', [input.submissionId]))[0];
    const before = await snapshotTx(ctx, input.transactionId);
    if (!before) return err('ENTRY_NOT_FOUND');
    if (before.removedAt !== null) return err('ENTRY_REMOVED');
    const empty: AttachReceiptUndo = { before, addedSourceIds: [], addedAttachmentIds: [], addedItemIds: [], removedItems: [] };
    // A retry of an attach that already committed writes nothing.
    if (seen) return ok({ transactionId: input.transactionId, adjustmentMinor: 0, undo: empty, alreadyDone: true });
    const type = String((await ctx.query('SELECT event_type FROM "transaction" WHERE id = ?', [input.transactionId]))[0]![0]);
    if (type !== 'expense') return err('NOT_AN_EXPENSE');

    const d = input.draft;
    if (!input.photoOnly) {
      if (d.total.value === null || d.total.value <= 0) return err('TOTAL_REQUIRED');
      if (input.itemCategories.length !== d.items.length) return err('SUBMISSION_INVALID');
    }
    const addedSourceIds: string[] = [];
    const addedAttachmentIds: string[] = [];
    const addedItemIds: string[] = [];
    let removedItems: (readonly unknown[])[] = [];
    let adjustmentMinor = 0;

    if (!input.photoOnly) {
      const total = d.total.value!;
      if (total > before.amount) return err('RECEIPT_EXCEEDS_ENTRY');
      const allocation = allocateReceipt(d, input.itemCategories, input.mainCategoryId);
      if (allocation.state === 'mismatch') return err('RECEIPT_MISMATCH');
      const existing = (await ctx.query('SELECT COUNT(*) FROM receipt_item WHERE transaction_id = ?', [input.transactionId]))[0];
      const hasItems = Number(existing?.[0] ?? 0) > 0;
      if (hasItems && input.itemsMode === undefined) return err('ITEMS_CHOICE_REQUIRED');

      if (!hasItems || input.itemsMode === 'replace') {
        const rows: SplitRow[] = toSplits(allocation);
        adjustmentMinor = before.amount - total;
        if (adjustmentMinor > 0) {
          const largest = [...rows].filter((r) => r.memo === undefined).sort((a, b) => b.amountMinor - a.amountMinor)[0] ?? rows[0]!;
          rows.push({ categoryId: largest.categoryId, amountMinor: adjustmentMinor, memo: TIP_CATEGORY_NAME });
        }
        const set = await SetSplits.execute(ctx, { transactionId: input.transactionId, splits: rows });
        if (!set.ok) return set;
        removedItems = await ctx.query(`SELECT ${ITEM_COLS} FROM receipt_item WHERE transaction_id = ? ORDER BY line_index, id`, [input.transactionId]);
        await ctx.execute('DELETE FROM receipt_item WHERE transaction_id = ?', [input.transactionId]);
        for (const it of allocation.items) {
          const src = d.items[it.index]!;
          const chosen = input.itemCategories[it.index];
          const key = src.name.toLowerCase().replace(/\s+/g, ' ').trim();
          if (chosen && key !== '') ctx.emit('ReceiptItemCategorised', { transactionId: input.transactionId, itemKey: key, categoryId: chosen, actor: 'user' });
          const id = ctx.newId();
          addedItemIds.push(id);
          await ctx.execute(`INSERT INTO receipt_item (${ITEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, input.transactionId, src.name, src.amountMinor, src.discountMinor, it.allocatedAmount, it.categoryId, src.lineIndex]);
        }
      }
    }

    const sourceId = ctx.newId();
    addedSourceIds.push(sourceId);
    await ctx.execute('INSERT INTO source_record (id, transaction_id, source_kind, fingerprint, reference, created_at, import_batch_id, file_row) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [sourceId, input.transactionId, 'receipt', input.submissionId, null, ctx.nowMs(), null, null]);
    if (input.attachment) {
      const a = await AddAttachment.execute(ctx, { transactionId: input.transactionId, ...input.attachment });
      if (!a.ok) return a;
      addedAttachmentIds.push(input.attachment.attachmentId);
    }
    ctx.touch('transaction', input.transactionId, { receiptAttached: true, receiptItems: addedItemIds.length });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok({ transactionId: input.transactionId, adjustmentMinor, undo: { before, addedSourceIds, addedAttachmentIds, addedItemIds, removedItems }, alreadyDone: false });
  },
};

/** Undo for `AttachReceipt`: the entry, its splits and its sources are as they were; the added photo row, receipt source and items are gone. */
export const UndoAttachReceipt: UseCase<{ undo: AttachReceiptUndo }, void, 'ENTRY_NOT_FOUND'> = {
  name: 'UndoAttachReceipt',
  async execute(ctx, input) {
    const u = input.undo;
    if ((await ctx.query('SELECT 1 FROM "transaction" WHERE id = ?', [u.before.id]))[0] === undefined) return err('ENTRY_NOT_FOUND');
    for (const id of u.addedAttachmentIds) await ctx.execute('DELETE FROM attachment WHERE id = ?', [id]);
    for (const id of u.addedSourceIds) await ctx.execute('DELETE FROM source_record WHERE id = ?', [id]);
    for (const id of u.addedItemIds) await ctx.execute('DELETE FROM receipt_item WHERE id = ?', [id]);
    for (const row of u.removedItems) await ctx.execute(`INSERT INTO receipt_item (${ITEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [...row] as (string | number | null)[]);
    await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [u.before.id]);
    await restoreTx(ctx, u.before);
    ctx.touch('transaction', u.before.id, { receiptAttachUndone: true });
    ctx.emit('TransactionsChanged', { transactionIds: [u.before.id] });
    return ok(undefined);
  },
};
