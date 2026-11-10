import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { WriterContext } from '../writer/ledgerWriter';
import type { Result } from '../shared/result';
import { SETTING_BLOCK_TRANSFERS_KEY, parseSettings, SETTINGS_SQL } from '../profile/settings';
import { profileTimezone } from './accountCommands';
import { MAX_NOTE_LENGTH } from './entryCommands';

/** Settings key for "Block transfers above the balance" (Settings > You, Story 1.16). Off by default. */
export const SETTING_BLOCK_TRANSFERS = SETTING_BLOCK_TRANSFERS_KEY;

export const OTHER_CATEGORY_ID = 'cat_other';

export interface TransferInput {
  readonly amountMinor: number;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly note?: string;
  readonly occurredAtMs?: number;
  /** An optional fee, saved in the same commit as a separate confirmed expense from the From account. */
  readonly fee?: { readonly amountMinor: number; readonly categoryId: string };
}

export type TransferError =
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_INVALID'
  | 'SAME_ACCOUNT'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'INSUFFICIENT_FUNDS'
  | 'FEE_INVALID'
  | 'CATEGORY_NOT_FOUND'
  | 'NO_PROFILE'
  | 'INSTANT_INVALID';

export async function blockTransfersAboveBalance(ctx: Pick<WriterContext, 'query'>): Promise<boolean> {
  return parseSettings(await ctx.query(SETTINGS_SQL)).blockTransfers;
}

/**
 * The ledger's create-transfer command (LIR-06): ONLY `SubmitCapture` may call it. Moves money between two of the
 * user's accounts: one `transfer` transaction, -amount on From and +amount on To, so it is neither income nor
 * expense. An optional fee is a separate expense from From. With the strict setting on, an amount above From's known
 * balance is refused (INSUFFICIENT_FUNDS); otherwise the screen warns.
 */
export async function createTransfer(
  ctx: WriterContext,
  input: TransferInput,
): Promise<Result<{ transactionId: string; feeTransactionId: string | null }, TransferError>> {
if (!Number.isSafeInteger(input.amountMinor)) return err('AMOUNT_INVALID');
if (input.amountMinor <= 0) return err('AMOUNT_REQUIRED');
if (input.fromAccountId === input.toAccountId) return err('SAME_ACCOUNT');
if (input.fee && (!Number.isSafeInteger(input.fee.amountMinor) || input.fee.amountMinor <= 0)) return err('FEE_INVALID');

const tz = await profileTimezone(ctx);
if (tz === null) return err('NO_PROFILE');
const at = input.occurredAtMs ?? ctx.nowMs();
const date = toLocalDate(at, tz);
if (!date.ok) return err('INSTANT_INVALID');

for (const id of [input.fromAccountId, input.toAccountId]) {
  const a = (await ctx.query('SELECT status FROM account WHERE id = ?', [id]))[0];
  if (!a) return err('ACCOUNT_NOT_FOUND');
  if (String(a[0]) !== 'active') return err('ACCOUNT_ARCHIVED');
}
if (input.fee) {
  const c = (await ctx.query("SELECT 1 FROM category WHERE id = ? AND kind IN ('expense', 'mixed') AND archived = 0", [input.fee.categoryId]))[0];
  if (!c) return err('CATEGORY_NOT_FOUND');
}

if (await blockTransfersAboveBalance(ctx)) {
  const f = (
    await ctx.query(
      `SELECT a.balance_not_set, a.type, COALESCE(SUM(CASE WHEN t.removed_at IS NULL AND t.status IN ('confirmed','reversed') AND (p.posting_kind <> 'normal' OR a.opening_effective_at IS NULL OR t.occurred_at_utc >= a.opening_effective_at) THEN p.signed_amount_minor END), 0) FROM account a LEFT JOIN posting p ON p.account_id = a.id LEFT JOIN "transaction" t ON t.id = p.transaction_id WHERE a.id = ? GROUP BY a.id`,
      [input.fromAccountId],
    )
  )[0];
  // Only a known asset balance can be compared; an unknown balance is never treated as zero.
  if (f && Number(f[0]) === 0 && String(f[1]) !== 'card' && input.amountMinor + (input.fee?.amountMinor ?? 0) > Number(f[2])) return err('INSUFFICIENT_FUNDS');
}

const now = ctx.nowMs();
const transactionId = ctx.newId();
await ctx.execute(
  "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, note, tags_json, needs_category, created_at, updated_at) VALUES (?, 'transfer', 'confirmed', ?, ?, ?, ?, ?, '[]', 0, ?, ?)",
  [transactionId, input.amountMinor, at, date.value, tz, (input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH) || null, now, now],
);
await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'out', ?, 'normal')", [ctx.newId(), transactionId, input.fromAccountId, -input.amountMinor]);
await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'in', ?, 'normal')", [ctx.newId(), transactionId, input.toAccountId, input.amountMinor]);
ctx.touch('transaction', transactionId, { eventType: 'transfer', created: true });

let feeTransactionId: string | null = null;
if (input.fee) {
  feeTransactionId = ctx.newId();
  await ctx.execute(
    "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, tags_json, needs_category, created_at, updated_at) VALUES (?, 'expense', 'confirmed', ?, ?, ?, ?, 'Transfer fee', '[]', 0, ?, ?)",
    [feeTransactionId, input.fee.amountMinor, at, date.value, tz, now, now],
  );
  await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'out', ?, 'normal')", [ctx.newId(), feeTransactionId, input.fromAccountId, -input.fee.amountMinor]);
  await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, ?)', [ctx.newId(), feeTransactionId, input.fee.categoryId, input.fee.amountMinor]);
  ctx.touch('transaction', feeTransactionId, { eventType: 'expense', fee: true });
}
return ok({ transactionId, feeTransactionId });
}
