import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { createEntry, type ManualEntry, type RecordEntryError } from '../ledger/entryCommands';
import { createRefund, type RefundError, type RefundInput } from '../ledger/refunds';
import { createTransfer, type TransferError, type TransferInput } from '../ledger/transferCommands';
import { profileTimezone } from '../ledger/accountCommands';
import { tombstoneFor } from '../ledger/purge';
import { toLocalDate } from '../shared/clock';
import { matchItem, type CaptureItem } from './match';

/**
 * The shared capture pipeline (Story 3.2, AD-6, LIR-06): parse, normalize, match (Story 3.1), classify, create. Every
 * way an entry can arrive goes through here, so a later source (SMS, receipt, CSV) can never get round the duplicate
 * rules. Manual entry from the Add sheet is the first source.
 */

export type CaptureSourceKind = 'manual' | 'upi' | 'sms' | 'receipt' | 'csv' | 'notification' | 'share';

export type SubmitInput = {
  readonly submissionId: string;
  readonly sourceKind: CaptureSourceKind;
  /** The source's own reference (bank reference, UPI id); part of the duplicate fingerprint. */
  readonly reference?: string;
  /** Import anyway: a tombstone does not suppress this submission (Epic 9's per-row Import anyway). */
  readonly ignoreTombstone?: boolean;
} & ({ readonly entry: ManualEntry; readonly copiedFrom?: string } | { readonly transfer: TransferInput } | { readonly refund: RefundInput });

export type SubmitResult = 'RECORDED' | 'ALREADY_SUBMITTED' | 'POSSIBLE_DUPLICATE' | 'SKIPPED_PREVIOUSLY_REJECTED' | 'SKIPPED_PREVIOUSLY_DELETED';
export type SubmitError = RecordEntryError | TransferError | RefundError | 'SUBMISSION_INVALID';

export interface Submitted {
  readonly transactionId: string;
  /** The account an entry landed in (the From account of a transfer); null only for an already-submitted transfer whose account is unknown. */
  readonly accountId: string | null;
  readonly feeTransactionId: string | null;
  readonly result: SubmitResult;
  /** For POSSIBLE_DUPLICATE: the confirmed item it looks like. */
  readonly matchedTransactionId?: string;
}

const addDays = (date: string, n: number): string => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** Confirmed, not-removed expense and income entries near the new one, in the shape the matcher compares. */
async function candidates(ctx: WriterContext, amountMinor: number, localDate: string): Promise<CaptureItem[]> {
  const rows = await ctx.query(
    `SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.occurred_at_utc, t.original_description, p.account_id, COALESCE((SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at LIMIT 1), 'manual'), (SELECT sr.reference FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at LIMIT 1) FROM "transaction" t JOIN posting p ON p.transaction_id = t.id AND p.posting_kind = 'normal' WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.event_type IN ('expense','income') AND t.amount_minor = ? AND t.local_date BETWEEN ? AND ?`,
    [amountMinor, addDays(localDate, -1), addDays(localDate, 1)],
  );
  return rows.map((r) => ({
    id: String(r[0]),
    reference: r[8] === null || r[8] === undefined ? null : String(r[8]),
    direction: String(r[1]) === 'income' ? ('credit' as const) : ('debit' as const),
    eventType: String(r[1]) as 'expense' | 'income',
    amountMinor: Number(r[2]),
    localDate: String(r[3]),
    occurredAtMs: Number(r[4]),
    merchant: r[5] === null ? null : String(r[5]),
    accountId: String(r[6]),
    source: String(r[7]) as CaptureItem['source'],
  }));
}

async function writeSource(ctx: WriterContext, transactionId: string, fingerprint: string, kind: CaptureSourceKind = 'manual', reference: string | null = null): Promise<void> {
  await ctx.execute('INSERT INTO source_record (id, transaction_id, source_kind, fingerprint, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    ctx.newId(),
    transactionId,
    kind,
    fingerprint,
    reference,
    ctx.nowMs(),
  ]);
}

export const SubmitCapture: UseCase<SubmitInput, Submitted, SubmitError> = {
  name: 'SubmitCapture',
  async execute(ctx, input) {
    if (typeof input.submissionId !== 'string' || input.submissionId.trim() === '') return err('SUBMISSION_INVALID');
    const fingerprint = input.submissionId;

    // A retry of a submission that already committed returns what it wrote and writes nothing.
    const seen = (await ctx.query('SELECT transaction_id FROM source_record WHERE fingerprint = ?', [fingerprint]))[0];
    if (seen) {
      const transactionId = String(seen[0]);
      const fee = (await ctx.query('SELECT transaction_id FROM source_record WHERE fingerprint = ?', [`${fingerprint}:fee`]))[0];
      const acc = (await ctx.query("SELECT account_id FROM posting WHERE transaction_id = ? AND posting_kind = 'normal' ORDER BY signed_amount_minor LIMIT 1", [transactionId]))[0];
      return ok({ transactionId, accountId: acc ? String(acc[0]) : null, feeTransactionId: fee ? String(fee[0]) : null, result: 'ALREADY_SUBMITTED' });
    }

    if ('refund' in input) {
      const f = await createRefund(ctx, input.refund);
      if (!f.ok) return f;
      await writeSource(ctx, f.value.transactionId, fingerprint, input.sourceKind, input.reference ?? null);
      ctx.emit('TransactionsChanged', { transactionIds: [f.value.transactionId] });
      ctx.emit('CapturesSubmitted', { transactionIds: [f.value.transactionId] });
      return ok({ transactionId: f.value.transactionId, accountId: f.value.accountId, feeTransactionId: null, result: 'RECORDED' });
    }

    if ('transfer' in input) {
      const t = await createTransfer(ctx, input.transfer);
      if (!t.ok) return t;
      await writeSource(ctx, t.value.transactionId, fingerprint, input.sourceKind, input.reference ?? null);
      if (t.value.feeTransactionId) await writeSource(ctx, t.value.feeTransactionId, `${fingerprint}:fee`, input.sourceKind);
      ctx.emit('TransactionsChanged', { transactionIds: t.value.feeTransactionId ? [t.value.transactionId, t.value.feeTransactionId] : [t.value.transactionId] });
      ctx.emit('CapturesSubmitted', { transactionIds: [t.value.transactionId] });
      return ok({ transactionId: t.value.transactionId, accountId: input.transfer.fromAccountId, feeTransactionId: t.value.feeTransactionId, result: 'RECORDED' });
    }

    const e = input.entry;
    // A non-manual entry that matches a tombstone (rejected or deleted before) is skipped and nothing is written. Manual entries never are.
    if (input.sourceKind !== 'manual' && !input.ignoreTombstone) {
      const tz = await profileTimezone(ctx);
      const date = tz === null ? null : toLocalDate(e.occurredAtMs ?? ctx.nowMs(), tz);
      if (date?.ok) {
        const hit = await tombstoneFor(ctx, { reference: input.reference ?? null, direction: e.kind === 'income' ? 'credit' : 'debit', eventType: e.kind, amountMinor: e.amountMinor, localDate: date.value, merchant: e.merchant ?? null });
        if (hit) return ok({ transactionId: '', accountId: null, feeTransactionId: null, result: hit === 'rejected' ? 'SKIPPED_PREVIOUSLY_REJECTED' : 'SKIPPED_PREVIOUSLY_DELETED' });
      }
    }
    const created = await createEntry(ctx, e, async (facts) => {
      if (facts.newAccount || facts.accountId === null) return { status: 'confirmed' };
      const item: CaptureItem = {
        id: 'new',
        reference: null,
        direction: e.kind === 'income' ? 'credit' : 'debit',
        eventType: e.kind,
        amountMinor: e.amountMinor,
        localDate: facts.localDate,
        occurredAtMs: facts.occurredAtMs,
        merchant: e.merchant ?? null,
        accountId: facts.accountId,
        source: 'manual',
      };
      // An entry made by Duplicate is never held against the entry it was copied from.
      const near = (await candidates(ctx, e.amountMinor, facts.localDate)).filter((c) => c.id !== input.copiedFrom);
      const outcome = matchItem(item, near, { ownedAccountIds: new Set([facts.accountId]) });
      // Saved, never blocked: a possible duplicate waits for review and counts in nothing until it is confirmed.
      return outcome.kind === 'possible_duplicate_of' || outcome.kind === 'duplicate_of' ? { status: 'needs_review', duplicateOf: outcome.id } : { status: 'confirmed' };
    });
    if (!created.ok) return created;
    const c = created.value;
    await writeSource(ctx, c.transactionId, fingerprint, input.sourceKind, input.reference ?? null);
    if (c.duplicateOf) {
      await ctx.execute("INSERT INTO review_candidate (id, transaction_id, matched_transaction_id, reason, status, created_at) VALUES (?, ?, ?, 'duplicate', 'open', ?)", [
        ctx.newId(),
        c.transactionId,
        c.duplicateOf,
        ctx.nowMs(),
      ]);
    }
    ctx.emit('TransactionsChanged', { transactionIds: [c.transactionId] });
    ctx.emit('CapturesSubmitted', { transactionIds: [c.transactionId] });
    if (c.createdAccount) ctx.emit('AccountsChanged', { accountIds: [c.accountId] });
    return ok({
      transactionId: c.transactionId,
      accountId: c.accountId,
      feeTransactionId: null,
      result: c.duplicateOf ? 'POSSIBLE_DUPLICATE' : 'RECORDED',
      ...(c.duplicateOf ? { matchedTransactionId: c.duplicateOf } : {}),
    });
  },
};
