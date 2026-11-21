import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { createEntry, type ManualEntry, type RecordEntryError } from '../ledger/entryCommands';
import { createRefund, type RefundError, type RefundInput } from '../ledger/refunds';
import { createTransfer, type TransferError, type TransferInput } from '../ledger/transferCommands';
import { profileTimezone } from '../ledger/accountCommands';
import { tombstoneFor } from '../ledger/purge';
import { toLocalDate } from '../shared/clock';
import { categoryFits, UNCATEGORISED_ID } from '../ledger/categories';
import { noSuggester, type CategorySuggester } from '../ports/categorySuggester';
import { matchItem, type CaptureItem } from './match';
import { tagMoveForGoal, type TagMoveError } from '../planning/goals';

/**
 * The shared capture pipeline (Story 3.2, AD-6, LIR-06): parse, normalize, match (Story 3.1), classify, create. Every
 * way an entry can arrive goes through here, so a later source (SMS, receipt, CSV) can never get round the duplicate
 * rules. Manual entry from the Add sheet is the first source.
 */

export type CaptureSourceKind = 'manual' | 'upi' | 'sms' | 'receipt' | 'csv' | 'notification' | 'share';

/**
 * What a CSV import decided for one row (Story 9.4). The plan (Story 9.3) already did the matching, so a CSV row is not matched
 * again here: it is confirmed, or held for review for the reason the plan gave, or written as skipped.
 */
export interface CsvRowMeta {
  readonly batchId: string;
  /** The row's 1-based position in the file, written on its source record. */
  readonly fileRow: number;
  /** The row waits for the person, with this reason on its review candidate. */
  readonly review?: { readonly reason: 'duplicate' | 'held_pair' | 'edge_day' | 'transfer_pair'; readonly matchedTransactionId?: string | null };
  /** No category in the file matched one wmbugo has: the entry is confirmed but still needs a category. */
  readonly needsCategory?: boolean;
  /** The person chose to skip the row: it is written as an `excluded` entry, so a later import skips it too. */
  readonly excluded?: boolean;
  /** Another currency (Story 3.10): no profile amount and no posting until the person confirms one. */
  readonly foreign?: { readonly amountMinor: number; readonly currency: string; readonly exponent: number };
}

export type SubmitInput = {
  readonly submissionId: string;
  readonly sourceKind: CaptureSourceKind;
  /** The source's own reference (bank reference, UPI id); part of the duplicate fingerprint. */
  readonly reference?: string;
  /** Import anyway: a tombstone does not suppress this submission (Epic 9's per-row Import anyway). */
  readonly ignoreTombstone?: boolean;
  /** A transfer into a savings pot made for a goal (Story 6.7): the goal's allocation is written in the same transaction. */
  readonly goalId?: string;
  /** CSV rows only (Story 9.4). */
  readonly csv?: CsvRowMeta;
} & ({ readonly entry: ManualEntry; readonly copiedFrom?: string } | { readonly transfer: TransferInput } | { readonly refund: RefundInput });

export type SubmitResult = 'RECORDED' | 'ALREADY_SUBMITTED' | 'POSSIBLE_DUPLICATE' | 'SKIPPED_PREVIOUSLY_REJECTED' | 'SKIPPED_PREVIOUSLY_DELETED';
export type SubmitError = RecordEntryError | TransferError | RefundError | TagMoveError | 'SUBMISSION_INVALID';

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

async function writeSource(
  ctx: WriterContext,
  transactionId: string,
  fingerprint: string,
  kind: CaptureSourceKind = 'manual',
  reference: string | null = null,
  csv?: CsvRowMeta,
): Promise<void> {
  await ctx.execute('INSERT INTO source_record (id, transaction_id, source_kind, fingerprint, reference, created_at, import_batch_id, file_row) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    ctx.newId(),
    transactionId,
    kind,
    fingerprint,
    reference,
    ctx.nowMs(),
    csv?.batchId ?? null,
    csv?.fileRow ?? null,
  ]);
}

/** Marks an entry the person chose to skip: kept (and shown under Show rejected) so a later import skips it, then purged by Story 3.12. */
async function markExcluded(ctx: WriterContext, transactionId: string): Promise<void> {
  const now = ctx.nowMs();
  await ctx.execute("UPDATE \"transaction\" SET status = 'excluded', removed_at = ?, removal_kind = 'excluded', updated_at = ? WHERE id = ?", [now, now, transactionId]);
}

/**
 * The pipeline with its category suggester (Story 4.4). The suggester is asked only for a captured entry that arrived with no
 * category (Uncategorised): a manual save never gets a suggestion, and a suggestion is written as a guess the user can
 * confirm or change (`category_guessed`). The default `SubmitCapture` has the suggester that returns nothing.
 */
export const createSubmitCapture = (deps: { readonly suggester?: CategorySuggester } = {}): UseCase<SubmitInput, Submitted, SubmitError> => ({
  name: 'SubmitCapture',
  async execute(ctx, input) {
    const suggester = deps.suggester ?? noSuggester;
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

    // A goal tag belongs to a move into savings only; anywhere else it would be dropped without a word.
    if (input.goalId && !('transfer' in input)) return err('SUBMISSION_INVALID');
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
      // Capture hands a goal-tagged move to planning in the same writer transaction; a refusal rolls the whole transfer back.
      if (input.goalId) {
        const tagged = await tagMoveForGoal(ctx, input.goalId, t.value.transactionId);
        if (typeof tagged === 'string') return err(tagged);
      }
      ctx.emit('TransactionsChanged', { transactionIds: t.value.feeTransactionId ? [t.value.transactionId, t.value.feeTransactionId] : [t.value.transactionId] });
      ctx.emit('CapturesSubmitted', { transactionIds: [t.value.transactionId] });
      return ok({ transactionId: t.value.transactionId, accountId: input.transfer.fromAccountId, feeTransactionId: t.value.feeTransactionId, result: 'RECORDED' });
    }

    const e = input.entry;
    if (input.csv?.foreign) return createForeignRow(ctx, input, e, fingerprint);
    // A non-manual entry that matches a tombstone (rejected or deleted before) is skipped and nothing is written. Manual entries never are.
    if (input.sourceKind !== 'manual' && !input.ignoreTombstone) {
      const tz = await profileTimezone(ctx);
      const date = tz === null ? null : toLocalDate(e.occurredAtMs ?? ctx.nowMs(), tz);
      if (date?.ok) {
        const hit = await tombstoneFor(ctx, { reference: input.reference ?? null, direction: e.kind === 'income' ? 'credit' : 'debit', eventType: e.kind, amountMinor: e.amountMinor, localDate: date.value, merchant: e.merchant ?? null });
        if (hit) return ok({ transactionId: '', accountId: null, feeTransactionId: null, result: hit === 'rejected' ? 'SKIPPED_PREVIOUSLY_REJECTED' : 'SKIPPED_PREVIOUSLY_DELETED' });
      }
    }
    // Who chose the category: a manual entry's is the user's. A captured entry with none is asked of the suggester.
    let entry = e;
    let category: { guessed: boolean; setBy: 'user' | 'suggester' | null } = { guessed: false, setBy: input.sourceKind === 'manual' ? 'user' : e.categoryId === UNCATEGORISED_ID ? null : 'user' };
    if (input.sourceKind !== 'manual' && e.categoryId === UNCATEGORISED_ID) {
      const guess = await suggester.suggest({ kind: e.kind, merchant: e.merchant ?? null, amountMinor: e.amountMinor, accountId: e.accountId, sourceKind: input.sourceKind });
      if (guess) {
        // A suggestion for a category that is gone, archived or the wrong kind is ignored, never written.
        const k = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [guess.categoryId]))[0];
        if (k && categoryFits(String(k[0]), e.kind)) {
          entry = { ...e, categoryId: guess.categoryId };
          category = { guessed: true, setBy: 'suggester' };
        }
      }
    }
    const created = await createEntry(ctx, entry, async (facts) => {
      // A CSV row was matched by the plan: it is confirmed, or waits for the reason the plan gave. It is not matched a second time.
      if (input.sourceKind === 'csv') return { status: input.csv?.review ? 'needs_review' : 'confirmed' };
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
    }, category);
    if (!created.ok) return created;
    const c = created.value;
    await writeSource(ctx, c.transactionId, fingerprint, input.sourceKind, input.reference ?? null, input.csv);
    if (input.csv) await finishCsvRow(ctx, c.transactionId, input.csv);
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
});

/** The CSV-only steps after a row's entry exists: its category need, the review candidate it waits on, or its exclusion. */
async function finishCsvRow(ctx: WriterContext, transactionId: string, csv: CsvRowMeta): Promise<void> {
  if (csv.needsCategory && !csv.review) await ctx.execute('UPDATE "transaction" SET needs_category = 1 WHERE id = ?', [transactionId]);
  if (csv.review) {
    await ctx.execute("INSERT INTO review_candidate (id, transaction_id, matched_transaction_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)", [
      ctx.newId(),
      transactionId,
      csv.review.matchedTransactionId ?? null,
      csv.review.reason,
      ctx.nowMs(),
    ]);
  }
  if (csv.excluded) await markExcluded(ctx, transactionId);
}

/**
 * A CSV row in another currency (Story 3.10, IMP-002): never converted. It is written as a waiting entry that carries the foreign
 * amount, with no profile amount and no posting, so it counts in nothing until the person confirms an amount.
 */
async function createForeignRow(ctx: WriterContext, input: SubmitInput & { entry: ManualEntry }, e: ManualEntry, fingerprint: string) {
  const f = input.csv!.foreign!;
  const tz = await profileTimezone(ctx);
  if (tz === null) return err('NO_PROFILE' as const);
  if (!Number.isSafeInteger(f.amountMinor) || f.amountMinor <= 0) return err('AMOUNT_INVALID' as const);
  const at = e.occurredAtMs ?? ctx.nowMs();
  const date = toLocalDate(at, tz);
  if (!date.ok) return err('INSTANT_INVALID' as const);
  const cat = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [e.categoryId]))[0];
  if (!cat) return err('CATEGORY_NOT_FOUND' as const);
  const now = ctx.nowMs();
  const transactionId = ctx.newId();
  await ctx.execute(
    "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, tags_json, needs_category, foreign_amount_minor, foreign_currency, foreign_currency_exponent, created_at, updated_at) VALUES (?, ?, 'needs_review', 0, ?, ?, ?, ?, '[]', 0, ?, ?, ?, ?, ?)",
    [transactionId, e.kind, at, date.value, tz, e.merchant ?? null, f.amountMinor, f.currency, f.exponent, now, now],
  );
  // No profile amount yet (the entry shape allows that for a foreign capture waiting for one): the split carries the category and 0.
  await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, 0)', [ctx.newId(), transactionId, e.categoryId]);
  await writeSource(ctx, transactionId, fingerprint, input.sourceKind, input.reference ?? null, input.csv);
  await ctx.execute("INSERT INTO review_candidate (id, transaction_id, matched_transaction_id, reason, status, created_at) VALUES (?, ?, NULL, 'foreign_currency', 'open', ?)", [ctx.newId(), transactionId, now]);
  if (input.csv!.excluded) await markExcluded(ctx, transactionId);
  ctx.touch('transaction', transactionId, { eventType: e.kind, created: true, status: 'needs_review', foreign: true });
  ctx.emit('TransactionsChanged', { transactionIds: [transactionId] });
  ctx.emit('CapturesSubmitted', { transactionIds: [transactionId] });
  return ok({ transactionId, accountId: null, feeTransactionId: null, result: 'RECORDED' as const });
}

export const SubmitCapture: UseCase<SubmitInput, Submitted, SubmitError> = createSubmitCapture();
