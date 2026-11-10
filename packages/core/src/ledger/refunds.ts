import { toLocalDate } from '../shared/clock';
import { err, ok, type Result } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { restoreTx, snapshotTx, type TxSnapshot } from '../capture/snapshot';
import { paydayRuleFromRow, periodFor } from '../profile/period';
import { parseSettings, periodRule, SETTINGS_SQL } from '../profile/settings';
import { profileTimezone } from './accountCommands';
import { MAX_NOTE_LENGTH } from './entryCommands';
import { OTHER_CATEGORY_ID } from './transferCommands';

/**
 * Money that comes back (Story 3.8, FIN-028): a refund from a shop, or a reimbursement from a person, recorded against the
 * original entry. A refund is a `refund` transaction with its own date, so it reduces the spending of the period it
 * arrives in and leaves the original's period alone. It is never income. A reversal is for a payment that failed.
 */

export type RecoveryKind = 'refund' | 'reimbursement';

export interface RefundInput {
  /** The expense it is for. Without one the refund is unlinked and needs a category and an account. */
  readonly originalId?: string;
  readonly amountMinor: number;
  /** Unlinked only: the category the refund is for (default Other). */
  readonly categoryId?: string;
  /** Unlinked only: the account the money came into. */
  readonly accountId?: string;
  readonly occurredAtMs?: number;
  readonly note?: string;
  readonly recoveryKind?: RecoveryKind;
}

export type RefundError =
  | 'ORIGINAL_NOT_FOUND'
  | 'ORIGINAL_NOT_REFUNDABLE'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_INVALID'
  | 'EXCEEDS_REFUNDABLE'
  | 'CATEGORY_NOT_FOUND'
  | 'ACCOUNT_REQUIRED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'INSTANT_INVALID'
  | 'RECOVERY_INVALID'
  | 'NO_PROFILE';

/** What is still refundable on an expense: its amount minus the refunds and reimbursements already linked. Param: original id. */
export const REFUNDABLE_SQL =
  "SELECT t.amount_minor - COALESCE((SELECT SUM(r.amount_minor) FROM \"transaction\" r WHERE r.refund_of_transaction_id = t.id AND r.event_type = 'refund' AND r.removed_at IS NULL AND r.status = 'confirmed'), 0) FROM \"transaction\" t WHERE t.id = ? AND t.event_type = 'expense' AND t.removed_at IS NULL AND t.status = 'confirmed'";

export async function refundableMinor(ctx: Pick<WriterContext, 'query'>, originalId: string): Promise<number | null> {
  const r = (await ctx.query(REFUNDABLE_SQL, [originalId]))[0];
  return r ? Number(r[0]) : null;
}

/**
 * The ledger's create-refund command (LIR-06): ONLY \`SubmitCapture\` may call it. Writes one \`refund\` transaction: a positive
 * posting on the account the money came into, one split in the original's category, linked to the original, with the
 * recovery kind. Refuses more than is left to refund.
 */
export async function createRefund(ctx: WriterContext, input: RefundInput): Promise<Result<{ transactionId: string; accountId: string }, RefundError>> {
  if (!Number.isSafeInteger(input.amountMinor)) return err('AMOUNT_INVALID');
  if (input.amountMinor <= 0) return err('AMOUNT_REQUIRED');
  const kind: RecoveryKind = input.recoveryKind ?? 'refund';
  if (kind !== 'refund' && kind !== 'reimbursement') return err('RECOVERY_INVALID');
  const tz = await profileTimezone(ctx);
  if (tz === null) return err('NO_PROFILE');
  const at = input.occurredAtMs ?? ctx.nowMs();
  const date = toLocalDate(at, tz);
  if (!date.ok) return err('INSTANT_INVALID');

  let accountId: string;
  let categoryId: string;
  if (input.originalId !== undefined) {
    const o = (await ctx.query("SELECT t.status, t.removed_at, t.event_type, p.account_id, (SELECT s.category_id FROM split s WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC, s.id LIMIT 1) FROM \"transaction\" t JOIN posting p ON p.transaction_id = t.id AND p.posting_kind = 'normal' WHERE t.id = ?", [input.originalId]))[0];
    if (!o) return err('ORIGINAL_NOT_FOUND');
    if (String(o[2]) !== 'expense' || o[1] !== null || String(o[0]) !== 'confirmed') return err('ORIGINAL_NOT_REFUNDABLE');
    const left = await refundableMinor(ctx, input.originalId);
    if (left === null) return err('ORIGINAL_NOT_REFUNDABLE');
    if (input.amountMinor > left) return err('EXCEEDS_REFUNDABLE');
    accountId = String(o[3]);
    categoryId = o[4] === null ? OTHER_CATEGORY_ID : String(o[4]);
  } else {
    if (!input.accountId) return err('ACCOUNT_REQUIRED');
    accountId = input.accountId;
    categoryId = input.categoryId ?? OTHER_CATEGORY_ID;
    const c = (await ctx.query("SELECT 1 FROM category WHERE id = ? AND kind = 'expense' AND archived = 0", [categoryId]))[0];
    if (!c) return err('CATEGORY_NOT_FOUND');
  }
  const acc = (await ctx.query('SELECT status FROM account WHERE id = ?', [accountId]))[0];
  if (!acc) return err('ACCOUNT_NOT_FOUND');
  if (String(acc[0]) !== 'active') return err('ACCOUNT_ARCHIVED');

  const now = ctx.nowMs();
  const id = ctx.newId();
  await ctx.execute(
    "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, note, refund_of_transaction_id, recovery_kind, capture_resolution, tags_json, needs_category, created_at, updated_at) VALUES (?, 'refund', 'confirmed', ?, ?, ?, ?, ?, ?, ?, 'user_approved', '[]', 0, ?, ?)",
    [id, input.amountMinor, at, date.value, tz, (input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH) || null, input.originalId ?? null, kind, now, now],
  );
  await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'in', ?, 'normal')", [ctx.newId(), id, accountId, input.amountMinor]);
  await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, ?)', [ctx.newId(), id, categoryId, input.amountMinor]);
  ctx.touch('transaction', id, { eventType: 'refund', created: true, kind, linked: input.originalId !== undefined });
  return ok({ transactionId: id, accountId });
}

/** The first local date of the period that is running now (anything earlier is a closed period). */
async function currentPeriodStart(ctx: WriterContext): Promise<string | null> {
  const p = (await ctx.query('SELECT payday_rule, payday_day, timezone_id FROM profile LIMIT 1'))[0];
  if (!p) return null;
  const today = toLocalDate(ctx.nowMs(), String(p[2]));
  if (!today.ok) return null;
  const settings = parseSettings(await ctx.query(SETTINGS_SQL));
  const rule = periodRule(paydayRuleFromRow(p[0] === null ? null : String(p[0]), p[1] === null ? null : Number(p[1])), settings.periodMode);
  return periodFor(today.value, rule).start;
}

export type ReverseError = 'ENTRY_NOT_FOUND' | 'ENTRY_REMOVED' | 'NOT_REVERSIBLE' | 'ALREADY_REVERSED' | 'HAS_REFUNDS' | 'NO_PROFILE';

/** What has come back for an expense so far (live refunds and reimbursements linked to it). */
export async function linkedRefundsMinor(ctx: Pick<WriterContext, 'query'>, originalId: string): Promise<number> {
  const r = (await ctx.query("SELECT COALESCE(SUM(amount_minor), 0) FROM \"transaction\" WHERE refund_of_transaction_id = ? AND event_type = 'refund' AND removed_at IS NULL AND status = 'confirmed'", [originalId]))[0];
  return r ? Number(r[0]) : 0;
}

/**
 * Reverse: for a payment that failed or bounced. Writes a \`reversal\` with the opposite posting on the same account,
 * marks the original \`reversed\` (linked by \`reversed_by_id\`) so it leaves spending in its own period even if that period
 * has ended, and nets the account balance to unchanged. Returns the original as it was, for Undo.
 */
export const ReverseTransaction: UseCase<{ transactionId: string }, { snapshot: TxSnapshot; reversalId: string }, ReverseError> = {
  name: 'ReverseTransaction',
  async execute(ctx, input) {
    const snap = await snapshotTx(ctx, input.transactionId);
    if (!snap) return err('ENTRY_NOT_FOUND');
    if (snap.removedAt !== null) return err('ENTRY_REMOVED');
    const row = (await ctx.query('SELECT event_type, reversed_by_id, timezone_id FROM "transaction" WHERE id = ?', [input.transactionId]))[0]!;
    if (row[1] !== null || snap.status === 'reversed') return err('ALREADY_REVERSED');
    if (String(row[0]) !== 'expense' || snap.status !== 'confirmed' || snap.postings.length !== 1) return err('NOT_REVERSIBLE');
    // A refund is linked to this purchase: reversing it would credit that money twice. Remove the refund first.
    if ((await linkedRefundsMinor(ctx, input.transactionId)) > 0) return err('HAS_REFUNDS');
    const original = snap.postings[0]!;
    const tz = await profileTimezone(ctx);
    if (tz === null) return err('NO_PROFILE');

    const now = ctx.nowMs();
    const date = toLocalDate(now, tz);
    const reversalId = ctx.newId();
    await ctx.execute(
      "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, tags_json, needs_category, created_at, updated_at) VALUES (?, 'reversal', 'confirmed', ?, ?, ?, ?, ?, '[]', 0, ?, ?)",
      [reversalId, snap.amount, now, date.ok ? date.value : snap.localDate, tz, snap.description, now, now],
    );
    await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'in', ?, 'normal')", [ctx.newId(), reversalId, original.account, snap.amount]);
    await ctx.execute("UPDATE \"transaction\" SET status = 'reversed', reversed_by_id = ?, updated_at = ? WHERE id = ?", [reversalId, now, input.transactionId]);

    const start = await currentPeriodStart(ctx);
    const closed = start !== null && snap.localDate < start;
    ctx.touch('transaction', input.transactionId, { reversed: true });
    ctx.touch('transaction', reversalId, { eventType: 'reversal', created: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId, reversalId], ...(closed ? { closedPeriodTouched: true } : {}) });
    return ok({ snapshot: snap, reversalId });
  },
};

/** Undo for Reverse: the original returns exactly and the reversal is removed. */
export const UndoReversal: UseCase<{ snapshot: TxSnapshot; reversalId: string }, void, 'ENTRY_NOT_FOUND'> = {
  name: 'UndoReversal',
  async execute(ctx, input) {
    const exists = (await ctx.query('SELECT 1 FROM "transaction" WHERE id = ?', [input.snapshot.id]))[0];
    if (!exists) return err('ENTRY_NOT_FOUND');
    await restoreTx(ctx, input.snapshot);
    await ctx.execute('UPDATE "transaction" SET reversed_by_id = NULL WHERE id = ?', [input.snapshot.id]);
    await ctx.execute('DELETE FROM posting WHERE transaction_id = ?', [input.reversalId]);
    await ctx.execute('DELETE FROM source_record WHERE transaction_id = ?', [input.reversalId]);
    await ctx.execute('DELETE FROM "transaction" WHERE id = ?', [input.reversalId]);
    const start = await currentPeriodStart(ctx);
    const closed = start !== null && input.snapshot.localDate < start;
    ctx.touch('transaction', input.snapshot.id, { reversalUndone: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.snapshot.id], ...(closed ? { closedPeriodTouched: true } : {}) });
    return ok(undefined);
  },
};

/**
 * Spending for a period, gross and net (Story 3.8). Gross is confirmed expenses; recovered is every refund and
 * reimbursement that arrived in the period; net is gross minus recovered, never subtracting a recovery twice. Reversed
 * expenses are not in gross. Params: start, end (local dates). Both are exact; the display floors net at zero.
 */
export const SPENDING_TOTALS_SQL =
  "SELECT COALESCE(SUM(CASE WHEN event_type = 'expense' THEN amount_minor ELSE 0 END), 0), COALESCE(SUM(CASE WHEN event_type = 'refund' AND COALESCE(recovery_kind, 'refund') = 'refund' THEN amount_minor ELSE 0 END), 0), COALESCE(SUM(CASE WHEN event_type = 'refund' AND recovery_kind = 'reimbursement' THEN amount_minor ELSE 0 END), 0) FROM \"transaction\" WHERE status = 'confirmed' AND removed_at IS NULL AND local_date BETWEEN ? AND ?";

export interface SpendingTotals {
  readonly grossMinor: number;
  readonly refundedMinor: number;
  readonly reimbursedMinor: number;
  /** gross - refunds - reimbursements (can be below zero; the screen floors it). */
  readonly netMinor: number;
}

export function mapSpendingTotals(rows: readonly (readonly unknown[])[]): SpendingTotals {
  const r = rows[0]!;
  const gross = Number(r[0]);
  const refunded = Number(r[1]);
  const reimbursed = Number(r[2]);
  return { grossMinor: gross, refundedMinor: refunded, reimbursedMinor: reimbursed, netMinor: gross - refunded - reimbursed };
}

/** `spendingTotals(period, view)`: what Spent shows (net) or what was paid out (gross). */
export function spendingTotals(rows: readonly (readonly unknown[])[], view: 'net' | 'gross'): number {
  const t = mapSpendingTotals(rows);
  return view === 'net' ? t.netMinor : t.grossMinor;
}

/** A category's spending in a period: expense splits minus refund splits. Params: start, end. */
export const CATEGORY_TOTALS_SQL =
  "SELECT s.category_id, SUM(CASE WHEN t.event_type = 'expense' THEN s.amount_minor ELSE -s.amount_minor END) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id WHERE t.event_type IN ('expense','refund') AND t.status = 'confirmed' AND t.removed_at IS NULL AND t.local_date BETWEEN ? AND ? GROUP BY s.category_id";

/** What came back for one expense: refunds and reimbursements linked to it. Param: original id. */
export const RECOVERY_SUMMARY_SQL =
  "SELECT COALESCE(SUM(CASE WHEN COALESCE(recovery_kind, 'refund') = 'refund' THEN amount_minor ELSE 0 END), 0), COALESCE(SUM(CASE WHEN recovery_kind = 'reimbursement' THEN amount_minor ELSE 0 END), 0) FROM \"transaction\" WHERE refund_of_transaction_id = ? AND event_type = 'refund' AND status = 'confirmed' AND removed_at IS NULL";

export interface RecoverySummary {
  readonly refundedMinor: number;
  readonly reimbursedMinor: number;
}

export function mapRecoverySummary(rows: readonly (readonly unknown[])[]): RecoverySummary {
  const r = rows[0];
  return { refundedMinor: r ? Number(r[0]) : 0, reimbursedMinor: r ? Number(r[1]) : 0 };
}

/** The category the Income form's Refunds chip selects: choosing it records a refund instead of income. */
export const REFUNDS_INCOME_CATEGORY_ID = 'cat_in_refunds';

/** Recent expenses that still have something left to refund, newest first (the "Refund for" picker). */
export const RECENT_REFUNDABLE_SQL =
  "SELECT t.id, COALESCE(t.original_description, ''), t.local_date, t.amount_minor - COALESCE((SELECT SUM(r.amount_minor) FROM \"transaction\" r WHERE r.refund_of_transaction_id = t.id AND r.event_type = 'refund' AND r.removed_at IS NULL AND r.status = 'confirmed'), 0) AS left_minor FROM \"transaction\" t WHERE t.event_type = 'expense' AND t.status = 'confirmed' AND t.removed_at IS NULL AND t.amount_minor - COALESCE((SELECT SUM(r.amount_minor) FROM \"transaction\" r WHERE r.refund_of_transaction_id = t.id AND r.event_type = 'refund' AND r.removed_at IS NULL AND r.status = 'confirmed'), 0) > 0 ORDER BY t.occurred_at_utc DESC, t.id DESC LIMIT 8";

export interface RefundableExpense {
  readonly id: string;
  readonly merchant: string;
  readonly localDate: string;
  readonly leftMinor: number;
}

export function mapRefundable(rows: readonly (readonly unknown[])[]): RefundableExpense[] {
  return rows.map((r) => ({ id: String(r[0]), merchant: String(r[1]), localDate: String(r[2]), leftMinor: Number(r[3]) }));
}
