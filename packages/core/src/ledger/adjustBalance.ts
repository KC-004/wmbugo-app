import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import { profileTimezone } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, openingPostingMinor, type AccountType } from './accounts';

/** The reasons offered when a balance is corrected (Story 2.5). */
export const ADJUST_REASONS = [
  { id: 'rough', label: 'Starting balance was rough' },
  { id: 'missed', label: 'Missed some entries' },
  { id: 'charges', label: 'Bank charges or interest' },
  { id: 'other', label: 'Other' },
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number]['id'];

export const MAX_ADJUST_NOTE = 200;

/**
 * The signed posting an adjustment would write: what the account should read (a card takes the amount owed, stored
 * negative) minus what the ledger says now. 0 means it already matches.
 */
export function adjustmentDelta(type: AccountType, currentPostingMinor: number, typedMinor: number): number {
  return openingPostingMinor(type, typedMinor) - currentPostingMinor;
}

export type AdjustBalanceError =
  | 'ACCOUNT_NOT_FOUND'
  | 'BALANCE_NOT_SET'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_NEGATIVE'
  | 'REASON_INVALID'
  | 'NOTE_TOO_LONG'
  | 'NO_CHANGE'
  | 'NO_PROFILE';

/**
 * Tells wmbugo what an account really holds (or a card really owes) today and records the difference as one
 * `adjustment` transaction dated now with one `adjustment` posting and the reason (Story 2.5). It is never income or
 * spending, and the opening posting is never touched. Undo is the ordinary RemoveEntry.
 */
export const AdjustBalance: UseCase<
  { accountId: string; actualMinor: number; reason: AdjustReason; note?: string },
  { transactionId: string; deltaMinor: number },
  AdjustBalanceError
> = {
  name: 'AdjustBalance',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.actualMinor)) return err('AMOUNT_INVALID');
    if (input.actualMinor < 0) return err('AMOUNT_NEGATIVE');
    const reason = ADJUST_REASONS.find((r) => r.id === input.reason);
    if (!reason) return err('REASON_INVALID');
    const note = (input.note ?? '').trim();
    if ([...note].length > MAX_ADJUST_NOTE) return err('NOTE_TOO_LONG');
    const row = mapAccountRows(await ctx.query(ACCOUNT_LIST_SQL)).find((r) => r.id === input.accountId);
    if (!row) return err('ACCOUNT_NOT_FOUND');
    if (row.balanceNotSet) return err('BALANCE_NOT_SET');
    const tz = await profileTimezone(ctx);
    if (tz === null) return err('NO_PROFILE');

    const delta = adjustmentDelta(row.type, row.postingsMinor, input.actualMinor);
    if (!Number.isSafeInteger(delta)) return err('AMOUNT_INVALID');
    if (delta === 0) return err('NO_CHANGE');

    const at = ctx.nowMs();
    const date = toLocalDate(at, tz);
    const transactionId = ctx.newId();
    await ctx.execute(
      "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, note, tags_json, needs_category, created_at, updated_at) VALUES (?, 'adjustment', 'confirmed', ?, ?, ?, ?, ?, '[]', 0, ?, ?)",
      [transactionId, Math.abs(delta), at, date.ok ? date.value : '1970-01-01', tz, reason.id === 'other' && note !== '' ? note : reason.label, at, at],
    );
    await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, 'adjustment')", [
      ctx.newId(),
      transactionId,
      input.accountId,
      delta > 0 ? 'in' : 'out',
      delta,
    ]);
    ctx.touch('transaction', transactionId, { eventType: 'adjustment', reason: reason.id });
    ctx.emit('TransactionsChanged', { transactionIds: [transactionId] });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok({ transactionId, deltaMinor: delta });
  },
};
