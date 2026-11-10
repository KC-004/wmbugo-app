import { linkedRefundsMinor } from './refunds';
import { categoryFits } from './categories';
import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { restoreTx, snapshotTx, type TxSnapshot } from '../capture/snapshot';
import { MAX_MERCHANT_LENGTH, MAX_NOTE_LENGTH, PAYMENT_METHODS, type PaymentMethod } from './entryCommands';

/** Edits of an expense or income: only what is given changes. null clears a merchant, note or payment method. */
export interface EntryEdit {
  readonly amountMinor?: number;
  readonly categoryId?: string;
  readonly accountId?: string;
  readonly occurredAtMs?: number;
  readonly merchant?: string | null;
  readonly note?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
}

/** Edits of a transfer: the amount, either side, the time and the note. */
export interface TransferEdit {
  readonly amountMinor?: number;
  readonly fromAccountId?: string;
  readonly toAccountId?: string;
  readonly occurredAtMs?: number;
  readonly note?: string | null;
}

export type EditError =
  | 'BELOW_REFUNDS'
  | 'ENTRY_NOT_FOUND'
  | 'ENTRY_REMOVED'
  | 'NOT_EDITABLE'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_INVALID'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_KIND_MISMATCH'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'SAME_ACCOUNT'
  | 'INSTANT_INVALID'
  | 'PAYMENT_METHOD_INVALID';

const clean = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t.slice(0, max);
};

async function activeAccount(ctx: WriterContext, id: string): Promise<'ok' | 'missing' | 'archived'> {
  const r = (await ctx.query('SELECT status FROM account WHERE id = ?', [id]))[0];
  if (!r) return 'missing';
  return String(r[0]) === 'active' ? 'ok' : 'archived';
}

/**
 * Edits one transaction: the transaction, its postings and its single split change together in one writer
 * transaction, with an audit row naming what changed. Returns the state before, which is what Undo restores.
 */
export const EditTransaction: UseCase<
  { transactionId: string; entry?: EntryEdit; transfer?: TransferEdit },
  { snapshot: TxSnapshot; categoryChanged: boolean },
  EditError
> = {
  name: 'EditTransaction',
  async execute(ctx, input) {
    const before = await snapshotTx(ctx, input.transactionId);
    if (!before) return err('ENTRY_NOT_FOUND');
    if (before.removedAt !== null) return err('ENTRY_REMOVED');
    // A reversed purchase and its reversal net to zero; editing either side would break that.
    if (before.status === 'reversed') return err('NOT_EDITABLE');
    const type = String((await ctx.query('SELECT event_type FROM "transaction" WHERE id = ?', [input.transactionId]))[0]![0]);
    const now = ctx.nowMs();
    const changed: string[] = [];

    const amountOf = (v: number | undefined): number | null | 'bad' => {
      if (v === undefined) return null;
      if (!Number.isSafeInteger(v)) return 'bad';
      return v;
    };

    const newTime = (at: number | undefined): { at: number; date: string } | 'bad' | null => {
      if (at === undefined) return null;
      const d = toLocalDate(at, before.timezoneId);
      return d.ok ? { at, date: d.value } : 'bad';
    };

    if (type === 'transfer') {
      if (!input.transfer) return err('NOT_EDITABLE');
      const e = input.transfer;
      const a = amountOf(e.amountMinor);
      if (a === 'bad') return err('AMOUNT_INVALID');
      if (a !== null && a <= 0) return err('AMOUNT_REQUIRED');
      const out = before.postings.find((p) => p.signed < 0);
      const into = before.postings.find((p) => p.signed > 0);
      if (!out || !into || before.postings.length !== 2) return err('NOT_EDITABLE');
      const from = e.fromAccountId ?? out.account;
      const to = e.toAccountId ?? into.account;
      if (from === to) return err('SAME_ACCOUNT');
      for (const [id, was] of [[from, out.account], [to, into.account]] as const) {
        if (id === was) continue;
        const st = await activeAccount(ctx, id);
        if (st === 'missing') return err('ACCOUNT_NOT_FOUND');
        if (st === 'archived') return err('ACCOUNT_ARCHIVED');
      }
      const t = newTime(e.occurredAtMs);
      if (t === 'bad') return err('INSTANT_INVALID');
      const amount = a ?? before.amount;
      await ctx.execute('UPDATE "transaction" SET amount_minor = ?, occurred_at_utc = ?, local_date = ?, note = ?, updated_at = ? WHERE id = ?', [
        amount,
        t ? t.at : before.occurredAt,
        t ? t.date : before.localDate,
        e.note === undefined ? before.note : clean(e.note, MAX_NOTE_LENGTH),
        now,
        input.transactionId,
      ]);
      await ctx.execute('UPDATE posting SET account_id = ?, signed_amount_minor = ? WHERE id = ?', [from, -amount, out.id]);
      await ctx.execute('UPDATE posting SET account_id = ?, signed_amount_minor = ? WHERE id = ?', [to, amount, into.id]);
      if (a !== null && a !== before.amount) changed.push('amount');
      if (from !== out.account) changed.push('from');
      if (to !== into.account) changed.push('to');
      if (t && t.at !== before.occurredAt) changed.push('date');
      if (e.note !== undefined && clean(e.note, MAX_NOTE_LENGTH) !== before.note) changed.push('note');
    } else if (type === 'expense' || type === 'income') {
      if (!input.entry) return err('NOT_EDITABLE');
      if (before.splits.length < 1 || before.postings.length !== 1) return err('NOT_EDITABLE');
      const e = input.entry;
      const posting = before.postings[0]!;
      // A split entry (Story 3.7): its amount and categories change only through SetSplits, together and balanced. Everything
      // else about it (account, date, merchant, note, payment method) edits as usual.
      const multi = before.splits.length > 1;
      const split = [...before.splits].sort((x, y) => y.amount - x.amount)[0]!;
      const a = amountOf(e.amountMinor);
      if (a === 'bad') return err('AMOUNT_INVALID');
      if (a !== null && a <= 0) return err('AMOUNT_REQUIRED');
      if (multi && ((a !== null && a !== before.amount) || (e.categoryId !== undefined && e.categoryId !== split.category))) return err('NOT_EDITABLE');
      if (e.paymentMethod !== undefined && e.paymentMethod !== null && !PAYMENT_METHODS.includes(e.paymentMethod)) return err('PAYMENT_METHOD_INVALID');
      if (e.categoryId !== undefined && e.categoryId !== split.category) {
        const c = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [e.categoryId]))[0];
        if (!c) return err('CATEGORY_NOT_FOUND');
        if (!categoryFits(String(c[0]), type)) return err('CATEGORY_KIND_MISMATCH');
      }
      if (e.accountId !== undefined && e.accountId !== posting.account) {
        const st = await activeAccount(ctx, e.accountId);
        if (st === 'missing') return err('ACCOUNT_NOT_FOUND');
        if (st === 'archived') return err('ACCOUNT_ARCHIVED');
      }
      const t = newTime(e.occurredAtMs);
      if (t === 'bad') return err('INSTANT_INVALID');
      const amount = a ?? before.amount;
      // A purchase cannot be edited below what has already been refunded to it.
      if (type === 'expense' && amount < before.amount && amount < (await linkedRefundsMinor(ctx, input.transactionId))) return err('BELOW_REFUNDS');
      const category = e.categoryId ?? split.category;
      const account = e.accountId ?? posting.account;
      await ctx.execute('UPDATE "transaction" SET amount_minor = ?, occurred_at_utc = ?, local_date = ?, original_description = ?, note = ?, payment_method = ?, updated_at = ? WHERE id = ?', [
        amount,
        t ? t.at : before.occurredAt,
        t ? t.date : before.localDate,
        e.merchant === undefined ? before.description : clean(e.merchant, MAX_MERCHANT_LENGTH),
        e.note === undefined ? before.note : clean(e.note, MAX_NOTE_LENGTH),
        e.paymentMethod === undefined ? before.paymentMethod : e.paymentMethod,
        now,
        input.transactionId,
      ]);
      await ctx.execute('UPDATE posting SET account_id = ?, signed_amount_minor = ? WHERE id = ?', [account, type === 'expense' ? -amount : amount, posting.id]);
      if (!multi) await ctx.execute('UPDATE split SET category_id = ?, amount_minor = ? WHERE id = ?', [category, amount, split.id]);
      // Choosing a category answers an "add a category" flag.
      if (category !== split.category) await ctx.execute('UPDATE "transaction" SET needs_category = 0 WHERE id = ?', [input.transactionId]);
      if (a !== null && a !== before.amount) changed.push('amount');
      if (category !== split.category) changed.push('category');
      if (account !== posting.account) changed.push('account');
      if (t && t.at !== before.occurredAt) changed.push('date');
      if (e.merchant !== undefined && clean(e.merchant, MAX_MERCHANT_LENGTH) !== before.description) changed.push('merchant');
      if (e.note !== undefined && clean(e.note, MAX_NOTE_LENGTH) !== before.note) changed.push('note');
      if (e.paymentMethod !== undefined && e.paymentMethod !== before.paymentMethod) changed.push('payment');
    } else {
      return err('NOT_EDITABLE');
    }

    ctx.touch('transaction', input.transactionId, { edited: true, fields: changed.join(',') });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    const categoryChanged = changed.includes('category');
    if (categoryChanged) ctx.emit('CategoryAssigned', { transactionIds: [input.transactionId] });
    return ok({ snapshot: before, categoryChanged });
  },
};

export type RemoveError = 'ENTRY_NOT_FOUND' | 'ENTRY_REMOVED' | 'USE_REJECT' | 'USE_DELETE' | 'NOT_REMOVABLE';

async function sourceKinds(ctx: WriterContext, id: string): Promise<string[]> {
  return (await ctx.query('SELECT source_kind FROM source_record WHERE transaction_id = ?', [id])).map((r) => String(r[0]));
}

async function removable(ctx: WriterContext, id: string): Promise<{ snapshot: TxSnapshot; kinds: string[] } | RemoveError> {
  const snapshot = await snapshotTx(ctx, id);
  if (!snapshot) return 'ENTRY_NOT_FOUND';
  if (snapshot.removedAt !== null) return 'ENTRY_REMOVED';
  // A reversed purchase stays with its reversal until the reversal is undone.
  if (snapshot.status === 'reversed') return 'NOT_REMOVABLE';
  const type = String((await ctx.query('SELECT event_type FROM "transaction" WHERE id = ?', [id]))[0]![0]);
  if (!['expense', 'income', 'transfer', 'refund'].includes(type)) return 'NOT_REMOVABLE';
  return { snapshot, kinds: await sourceKinds(ctx, id) };
}

/**
 * Delete: a manual entry is soft-removed at once (excluded from every total and list). It keeps its rows so Undo can
 * restore it exactly. A captured entry is rejected instead; "Delete" is never offered for it.
 */
export const DeleteEntry: UseCase<{ transactionId: string }, { snapshot: TxSnapshot }, RemoveError> = {
  name: 'DeleteEntry',
  async execute(ctx, input) {
    const r = await removable(ctx, input.transactionId);
    if (typeof r === 'string') return err(r);
    if (r.kinds.some((k) => k !== 'manual')) return err('USE_REJECT');
    const now = ctx.nowMs();
    await ctx.execute("UPDATE \"transaction\" SET status = 'excluded', removed_at = ?, removal_kind = 'deleted', updated_at = ? WHERE id = ?", [now, now, input.transactionId]);
    ctx.touch('transaction', input.transactionId, { removed: 'deleted' });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok({ snapshot: r.snapshot });
  },
};

/** Reject · Not mine: a captured entry is excluded with resolution rejected. It is never called Delete. */
export const RejectEntry: UseCase<{ transactionId: string }, { snapshot: TxSnapshot }, RemoveError> = {
  name: 'RejectEntry',
  async execute(ctx, input) {
    const r = await removable(ctx, input.transactionId);
    if (typeof r === 'string') return err(r);
    if (r.kinds.length === 0 || r.kinds.every((k) => k === 'manual')) return err('USE_DELETE');
    const now = ctx.nowMs();
    await ctx.execute("UPDATE \"transaction\" SET status = 'excluded', capture_resolution = 'rejected', removed_at = ?, removal_kind = 'rejected', updated_at = ? WHERE id = ?", [now, now, input.transactionId]);
    ctx.touch('transaction', input.transactionId, { removed: 'rejected' });
    ctx.emit('CapturesRejected', { transactionIds: [input.transactionId] });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok({ snapshot: r.snapshot });
  },
};

/** Undo for an edit, a delete or a reject: every value goes back exactly as the snapshot holds it. */
export const RestoreTransaction: UseCase<{ snapshot: TxSnapshot }, void, 'ENTRY_NOT_FOUND'> = {
  name: 'RestoreTransaction',
  async execute(ctx, input) {
    const exists = (await ctx.query('SELECT 1 FROM "transaction" WHERE id = ?', [input.snapshot.id]))[0];
    if (!exists) return err('ENTRY_NOT_FOUND');
    await restoreTx(ctx, input.snapshot);
    ctx.touch('transaction', input.snapshot.id, { restored: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.snapshot.id] });
    return ok(undefined);
  },
};

/** One entry as its detail page shows it. Param: transaction id. */
export const TRANSACTION_DETAIL_SQL =
  "SELECT t.id, t.event_type, t.status, t.amount_minor, t.occurred_at_utc, t.local_date, t.original_description, t.note, t.payment_method, t.capture_resolution, t.removed_at, " +
  "(SELECT c.id FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), " +
  "(SELECT c.name FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), " +
  "(SELECT c.icon FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), " +
  "(SELECT c.color_token FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1), " +
  "(SELECT COUNT(*) FROM split s WHERE s.transaction_id = t.id), " +
  "(SELECT a.id FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.signed_amount_minor <= 0 AND p.posting_kind = 'normal' ORDER BY p.signed_amount_minor LIMIT 1), " +
  "(SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.signed_amount_minor <= 0 AND p.posting_kind = 'normal' ORDER BY p.signed_amount_minor LIMIT 1), " +
  "(SELECT a.id FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.signed_amount_minor > 0 AND p.posting_kind = 'normal' LIMIT 1), " +
  "(SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.signed_amount_minor > 0 AND p.posting_kind = 'normal' LIMIT 1), " +
  "(SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at LIMIT 1), " +
  "(SELECT sr.created_at FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at LIMIT 1), " +
  "t.timezone_id, t.created_at, (SELECT 1 FROM review_candidate rc WHERE rc.transaction_id = t.id AND rc.reason = 'duplicate' AND rc.status = 'open' LIMIT 1) FROM \"transaction\" t WHERE t.id = ?";

export interface TransactionDetail {
  readonly id: string;
  readonly type: 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment' | 'opening_balance' | 'reversal';
  readonly status: string;
  readonly amountMinor: number;
  readonly occurredAtMs: number;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly note: string | null;
  readonly paymentMethod: string | null;
  readonly resolution: string | null;
  readonly removed: boolean;
  readonly category: { readonly id: string; readonly name: string; readonly icon: string; readonly color: string } | null;
  readonly splitCount: number;
  /** The account money left (an expense's account, a transfer's From). */
  readonly from: { readonly id: string; readonly name: string } | null;
  /** The account money entered (an income's account, a transfer's To). */
  readonly to: { readonly id: string; readonly name: string } | null;
  readonly sourceKind: string;
  readonly addedAtMs: number;
  readonly timezoneId: string;
  /** An open duplicate candidate: the entry is held back and waits for Keep both or Merge. */
  readonly openDuplicate: boolean;
}

export function mapTransactionDetail(rows: readonly (readonly unknown[])[]): TransactionDetail | null {
  const r = rows[0];
  if (!r) return null;
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const type = String(r[1]) as TransactionDetail['type'];
  const outAcc = r[16] === null ? null : { id: String(r[16]), name: String(r[17]) };
  const inAcc = r[18] === null ? null : { id: String(r[18]), name: String(r[19]) };
  return {
    id: String(r[0]),
    type,
    status: String(r[2]),
    amountMinor: Number(r[3]),
    occurredAtMs: Number(r[4]),
    localDate: String(r[5]),
    merchant: s(r[6]),
    note: s(r[7]),
    paymentMethod: s(r[8]),
    resolution: s(r[9]),
    removed: r[10] !== null,
    category: r[11] === null ? null : { id: String(r[11]), name: String(r[12]), icon: String(r[13]), color: String(r[14]) },
    splitCount: Number(r[15]),
    // An expense leaves its account and an income enters it; a transfer has both sides.
    from: type === 'income' ? null : outAcc,
    to: type === 'income' ? (inAcc ?? outAcc) : type === 'transfer' ? inAcc : null,
    sourceKind: s(r[20]) ?? 'manual',
    addedAtMs: r[21] === null ? Number(r[23]) : Number(r[21]),
    timezoneId: String(r[22]),
    openDuplicate: Number(r[24]) === 1,
  };
}
