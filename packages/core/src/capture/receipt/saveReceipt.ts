import { err, ok } from '../../shared/result';
import type { UseCase } from '../../writer/ledgerWriter';
import { localToInstant, toLocalDate } from '../../shared/clock';
import { insertAccount, profileTimezone } from '../../ledger/accountCommands';
import { allocateReceipt, toSplits } from '../../ledger/allocateReceipt';
import { SetSplits, type SetSplitsError } from '../../ledger/splits';
import { UNCATEGORISED_ID } from '../../ledger/categories';
import type { SubmitError } from '../submitCapture';
import { createSubmitCapture, type SubmitResult } from '../submitCapture';
import { AddAttachment, type AttachError } from '../attachments';
import type { CategorySuggester } from '../../ports/categorySuggester';
import type { ReceiptDraft } from './types';

export interface SaveReceiptInput {
  /** Stable per scan, so a retry of the same save writes nothing twice. */
  readonly submissionId: string;
  /** The reviewed draft: the person's corrections are already in it. */
  readonly draft: ReceiptDraft;
  /** One category id per `draft.items` entry; null or missing means the main category. */
  readonly itemCategories: readonly (string | null)[];
  readonly mainCategoryId: string;
  /** The `Paid with` account; null only when no account exists (Cash is then created, as for a manual entry). */
  readonly accountId: string | null;
  /** `Paid with` is Cash and no Cash account exists: it is created with its balance not set, in this same save (as for a manual entry). */
  readonly createCash?: boolean;
  /** The photo, already encrypted on disk under this id (Story 3.11). */
  readonly attachment?: { readonly attachmentId: string; readonly digest: string; readonly sizeBytes: number };
}

export type SaveReceiptError =
  | SubmitError
  | SetSplitsError
  | AttachError
  | 'TOTAL_REQUIRED'
  | 'DATE_REQUIRED'
  | 'DATE_INVALID'
  | 'RECEIPT_MISMATCH'
  | 'CURRENCY_DIFFERS'
  | 'SUBMISSION_INVALID';

export interface SavedReceipt {
  readonly transactionId: string;
  readonly result: SubmitResult;
}

/**
 * Saves a reviewed receipt as one expense (Story 10.4, OCR-005, OCR-011) in a single writer transaction: the entry through the shared
 * capture pipeline (`source_kind = receipt`, so the duplicate rules still apply), one split per category plus the Not itemised split,
 * the receipt lines, and the photo. The date is the receipt's date with its printed time, 12:00 in the profile timezone when none was
 * printed, and the current moment when the date is today. Nothing is saved while the receipt does not add up.
 */
export const createSaveReceipt = (deps: { readonly suggester?: CategorySuggester } = {}): UseCase<SaveReceiptInput, SavedReceipt, SaveReceiptError> => {
  const submit = createSubmitCapture(deps.suggester ? { suggester: deps.suggester } : {});
  return {
    name: 'SaveReceipt',
    async execute(ctx, input) {
      const d = input.draft;
      if (d.total.value === null || d.total.value <= 0) return err('TOTAL_REQUIRED');
      if (d.date.value === null) return err('DATE_REQUIRED');
      if (input.itemCategories.length !== d.items.length) return err('SUBMISSION_INVALID');
      const profile = (await ctx.query('SELECT currency_code FROM profile LIMIT 1'))[0];
      if (profile && d.currency.value !== null && d.currency.value.trim().toUpperCase() !== String(profile[0])) return err('CURRENCY_DIFFERS');
      const tz = await profileTimezone(ctx);
      if (tz === null) return err('NO_PROFILE');

      const allocation = allocateReceipt(d, input.itemCategories, input.mainCategoryId);
      if (allocation.state === 'mismatch') return err('RECEIPT_MISMATCH');

      const today = toLocalDate(ctx.nowMs(), tz);
      let at = ctx.nowMs();
      if (!today.ok || today.value !== d.date.value) {
        // A time that is not HH:mm is ignored: the receipt then counts as 12:00.
        const printed = d.time.value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time.value) ? d.time.value : '12:00';
        const [h, m] = printed.split(':').map(Number);
        const instant = localToInstant(d.date.value, h!, m!, tz);
        if (!instant.ok) return err('DATE_INVALID');
        at = instant.value;
        // A day that does not exist (31 Feb) would roll over to another day: refuse it.
        const back = toLocalDate(at, tz);
        if (!back.ok || back.value !== d.date.value) return err('DATE_INVALID');
      }

      let accountId = input.accountId;
      let createdCash = false;
      // A retry of a save that already committed writes nothing, so it must not add a Cash account either.
      const already = (await ctx.query('SELECT 1 FROM source_record WHERE fingerprint = ?', [input.submissionId]))[0];
      if (accountId === null && input.createCash && !already) {
        accountId = (await insertAccount(ctx, { name: 'Cash', type: 'cash', openingMinor: null }, tz)).accountId;
        createdCash = true;
      }
      const merchant = d.merchant.value ?? undefined;
      const submitted = await submit.execute(ctx, {
        submissionId: input.submissionId,
        sourceKind: 'receipt',
        // A receipt is something the person chose to scan: an earlier rejected or deleted match never suppresses it.
        ignoreTombstone: true,
        entry: { kind: 'expense', amountMinor: d.total.value, categoryId: input.mainCategoryId, accountId, ...(merchant ? { merchant } : {}), occurredAtMs: at },
      });
      if (!submitted.ok) return submitted;
      const { transactionId, result } = submitted.value;
      if (result === 'ALREADY_SUBMITTED') return ok({ transactionId, result });

      const splits = toSplits(allocation);
      const single = splits.length === 1 && splits[0]!.categoryId === input.mainCategoryId;
      if (!single) {
        const set = await SetSplits.execute(ctx, { transactionId, splits });
        if (!set.ok) return set;
      }
      // Saved with no category of its own: it stays under "Add a category" until the person picks one.
      if (input.mainCategoryId === UNCATEGORISED_ID && allocation.items.every((i) => i.categoryId === UNCATEGORISED_ID)) {
        await ctx.execute('UPDATE "transaction" SET category_set_by = NULL WHERE id = ?', [transactionId]);
      }
      for (const it of allocation.items) {
        const src = d.items[it.index]!;
        // An item the person gave a category of its own is a lesson for later (Epic 11): one event per such item.
        const chosen = input.itemCategories[it.index];
        // The item's own words, lower case with single spaces: the merchant normalizer would cut quantities and prefixes off an item name.
        const key = src.name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (chosen && key !== '') ctx.emit('ReceiptItemCategorised', { transactionId, itemKey: key, categoryId: chosen, actor: 'user' });
        await ctx.execute('INSERT INTO receipt_item (id, transaction_id, name, amount_minor, discount_minor, allocated_minor, category_id, line_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          ctx.newId(),
          transactionId,
          src.name,
          src.amountMinor,
          src.discountMinor,
          it.allocatedAmount,
          it.categoryId,
          src.lineIndex,
        ]);
      }
      if (input.attachment) {
        const a = await AddAttachment.execute(ctx, { transactionId, ...input.attachment });
        if (!a.ok) return a;
      }
      if (createdCash && accountId) ctx.emit('AccountsChanged', { accountIds: [accountId] });
      ctx.touch('transaction', transactionId, { receiptItems: allocation.items.length });
      return ok({ transactionId, result });
    },
  };
};

export const SaveReceipt = createSaveReceipt();
