import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import { profileTimezone } from './accountCommands';
import { openingPostingMinor, type AccountType } from './accounts';
import { instantFromLocal } from './entryCommands';

export type StartingBalanceError = 'ACCOUNT_NOT_FOUND' | 'ALREADY_SET' | 'AMOUNT_INVALID' | 'AMOUNT_NEGATIVE' | 'NO_PROFILE';

/**
 * Gives an account that was created with "balance not set" its balance, as of today (Story 2.4). The user says what
 * is in it now; the opening amount is worked out so that today's balance reads exactly that:
 *
 *   opening = today's balance - the postings that count since the account was opened.
 *
 * It writes one `opening_balance` transaction with one posting, effective at the account's opening instant (when
 * it was created), so entries saved since then keep counting. A card takes the amount owed (stored negative).
 * Zero is a valid balance. No use case edits an opening amount that already exists: use Adjust balance for that.
 */
export const SetStartingBalance: UseCase<{ accountId: string; amountMinor: number }, { transactionId: string | null }, StartingBalanceError> = {
  name: 'SetStartingBalance',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.amountMinor)) return err('AMOUNT_INVALID');
    if (input.amountMinor < 0) return err('AMOUNT_NEGATIVE');
    const a = (await ctx.query('SELECT type, balance_not_set, created_at FROM account WHERE id = ?', [input.accountId]))[0];
    if (!a) return err('ACCOUNT_NOT_FOUND');
    if (Number(a[1]) !== 1) return err('ALREADY_SET');
    const tz = await profileTimezone(ctx);
    if (tz === null) return err('NO_PROFILE');

    const openedAt = Number(a[2]);
    const since = Number(
      (
        await ctx.query(
          "SELECT COALESCE(SUM(p.signed_amount_minor), 0) FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE p.account_id = ? AND p.posting_kind <> 'opening_balance' AND t.removed_at IS NULL AND t.status IN ('confirmed','reversed') AND (p.posting_kind <> 'normal' OR t.occurred_at_utc >= ?)",
          [input.accountId, openedAt],
        )
      )[0]?.[0] ?? 0,
    );
    const opening = openingPostingMinor(String(a[0]) as AccountType, input.amountMinor) - since;
    if (!Number.isSafeInteger(opening)) return err('AMOUNT_INVALID');

    await ctx.execute('UPDATE account SET opening_minor = ?, opening_effective_at = ?, balance_not_set = 0, updated_at = ? WHERE id = ?', [opening, openedAt, ctx.nowMs(), input.accountId]);
    ctx.touch('account', input.accountId, { balanceSet: true });

    let transactionId: string | null = null;
    if (opening !== 0) {
      transactionId = ctx.newId();
      const date = toLocalDate(openedAt, tz);
      await ctx.execute(
        "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, tags_json, needs_category, created_at, updated_at) VALUES (?, 'opening_balance', 'confirmed', ?, ?, ?, ?, '[]', 0, ?, ?)",
        [transactionId, Math.abs(opening), openedAt, date.ok ? date.value : '1970-01-01', tz, ctx.nowMs(), ctx.nowMs()],
      );
      await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, 'opening_balance')", [
        ctx.newId(),
        transactionId,
        input.accountId,
        opening > 0 ? 'in' : 'out',
        opening,
      ]);
      ctx.touch('transaction', transactionId, { eventType: 'opening_balance' });
    }
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    if (transactionId) ctx.emit('TransactionsChanged', { transactionIds: [transactionId] });
    return ok({ transactionId });
  },
};

export type TrackingDateError = 'ACCOUNT_NOT_FOUND' | 'BALANCE_NOT_SET' | 'DATE_INVALID' | 'DATE_IN_FUTURE' | 'NO_PROFILE';

/**
 * Moves the day an account's tracking starts (its opening instant) to the start of a local day (Story 2.4). The
 * opening amount does not change; entries from that day on now count in the balance, and the "Before tracking
 * started" mark follows. Only this, from a user action, ever moves an opening instant: capture, import and
 * migration never do. The audit row carries the old and new instants.
 */
export const ChangeTrackingDate: UseCase<{ accountId: string; localDate: string }, void, TrackingDateError> = {
  name: 'ChangeTrackingDate',
  async execute(ctx, input) {
    const a = (await ctx.query('SELECT balance_not_set, opening_effective_at FROM account WHERE id = ?', [input.accountId]))[0];
    if (!a) return err('ACCOUNT_NOT_FOUND');
    if (Number(a[0]) === 1 || a[1] === null) return err('BALANCE_NOT_SET');
    const tz = await profileTimezone(ctx);
    if (tz === null) return err('NO_PROFILE');
    const at = instantFromLocal(input.localDate, '00:00', tz);
    if (at === null) return err('DATE_INVALID');
    const today = toLocalDate(ctx.nowMs(), tz);
    if (!today.ok) return err('DATE_INVALID');
    if (input.localDate > today.value) return err('DATE_IN_FUTURE');

    const before = Number(a[1]);
    if (at === before) return ok(undefined);
    await ctx.execute('UPDATE account SET opening_effective_at = ?, updated_at = ? WHERE id = ?', [at, ctx.nowMs(), input.accountId]);
    // The opening transaction sits at the opening instant, so it moves with it.
    const openingTx = (await ctx.query("SELECT transaction_id FROM posting WHERE account_id = ? AND posting_kind = 'opening_balance'", [input.accountId])).map((r) => String(r[0]));
    await ctx.execute(
      "UPDATE \"transaction\" SET occurred_at_utc = ?, local_date = ?, timezone_id = ?, updated_at = ? WHERE id IN (SELECT transaction_id FROM posting WHERE account_id = ? AND posting_kind = 'opening_balance')",
      [at, input.localDate, tz, ctx.nowMs(), input.accountId],
    );
    for (const id of openingTx) ctx.touch('transaction', id, { movedWithTrackingDate: true });
    ctx.touch('account', input.accountId, { trackingFrom: before, trackingTo: at });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    if (openingTx.length > 0) ctx.emit('TransactionsChanged', { transactionIds: openingTx });
    return ok(undefined);
  },
};
