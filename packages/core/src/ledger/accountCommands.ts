import type { SqlParam } from '../ports/storage';
import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { Invariant, UseCase, WriterContext } from '../writer/ledgerWriter';
import { ACCOUNT_DEFAULTS, ACCOUNT_TYPES, openingPostingMinor, validateAccountName, type AccountNameError, type AccountType } from './accounts';

export interface NewAccount {
  readonly name: string;
  readonly type: AccountType;
  /** What the user typed, in minor units (a card's amount owed is positive). null means "not set". */
  readonly openingMinor: number | null;
}

/**
 * Inserts an account and, when a balance was given, its opening transaction with one posting (AD-5). Shared
 * by AddAccount and onboarding's SetUpProfile so both write the exact same rows. Caller owns the transaction.
 */
export async function insertAccount(
  ctx: WriterContext,
  input: NewAccount,
  timezoneId: string,
): Promise<{ accountId: string; transactionId: string | null }> {
  const name = validateAccountName(input.name);
  if (!name.ok) throw new Error(name.code);
  const defaults = ACCOUNT_DEFAULTS[input.type];
  const at = ctx.nowMs();
  const accountId = ctx.newId();
  const order = Number((await ctx.query('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM account'))[0]?.[0] ?? 0);
  const known = input.openingMinor !== null;
  const posting = known ? openingPostingMinor(input.type, input.openingMinor as number) : null;

  await ctx.execute(
    'INSERT INTO account (id, name, type, icon, color_token, opening_minor, opening_effective_at, balance_not_set, include_in_overview, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, \'active\', ?, ?)',
    [accountId, name.value, input.type, defaults.icon, defaults.color, posting, known ? at : null, known ? 0 : 1, order, at, at],
  );
  ctx.touch('account', accountId, { type: input.type, balanceSet: known });

  let transactionId: string | null = null;
  if (posting !== null && posting !== 0) {
    transactionId = ctx.newId();
    const date = toLocalDate(at, timezoneId);
    const localDate = date.ok ? date.value : '1970-01-01';
    await ctx.execute(
      "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, tags_json, needs_category, created_at, updated_at) VALUES (?, 'opening_balance', 'confirmed', ?, ?, ?, ?, '[]', 0, ?, ?)",
      [transactionId, Math.abs(posting), at, localDate, timezoneId, at, at],
    );
    await ctx.execute(
      'INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, \'opening_balance\')',
      [ctx.newId(), transactionId, accountId, posting > 0 ? 'in' : 'out', posting],
    );
    ctx.touch('transaction', transactionId, { eventType: 'opening_balance' });
  }
  return { accountId, transactionId };
}

export async function profileTimezone(ctx: WriterContext): Promise<string | null> {
  const rows = await ctx.query('SELECT timezone_id FROM profile LIMIT 1');
  return rows[0] ? String(rows[0][0]) : null;
}

export type AddAccountError = AccountNameError | 'AMOUNT_NEGATIVE' | 'AMOUNT_INVALID' | 'NO_PROFILE' | 'TYPE_INVALID';

/** Adds an account (from the accounts list; onboarding's first account is written by SetUpProfile). */
export const AddAccount: UseCase<NewAccount, { accountId: string }, AddAccountError> = {
  name: 'AddAccount',
  async execute(ctx, input) {
    const name = validateAccountName(input.name);
    if (!name.ok) return err(name.code);
    if (!ACCOUNT_TYPES.includes(input.type)) return err('TYPE_INVALID');
    if (input.openingMinor !== null) {
      if (!Number.isSafeInteger(input.openingMinor)) return err('AMOUNT_INVALID');
      if (input.openingMinor < 0) return err('AMOUNT_NEGATIVE');
    }
    const tz = await profileTimezone(ctx);
    if (tz === null) return err('NO_PROFILE');
    const { accountId, transactionId } = await insertAccount(ctx, input, tz);
    ctx.emit('AccountsChanged', { accountIds: [accountId] });
    if (transactionId) ctx.emit('TransactionsChanged', { transactionIds: [transactionId] });
    return ok({ accountId });
  },
};

async function accountStatus(ctx: WriterContext, id: string): Promise<'active' | 'archived' | null> {
  const rows = await ctx.query('SELECT status FROM account WHERE id = ?', [id]);
  return rows[0] ? (String(rows[0][0]) as 'active' | 'archived') : null;
}

export const RenameAccount: UseCase<{ accountId: string; name: string }, void, AccountNameError | 'ACCOUNT_NOT_FOUND'> = {
  name: 'RenameAccount',
  async execute(ctx, input) {
    const name = validateAccountName(input.name);
    if (!name.ok) return err(name.code);
    if ((await accountStatus(ctx, input.accountId)) === null) return err('ACCOUNT_NOT_FOUND');
    await ctx.execute('UPDATE account SET name = ?, updated_at = ? WHERE id = ?', [name.value, ctx.nowMs(), input.accountId]);
    ctx.touch('account', input.accountId, { renamed: true });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok(undefined);
  },
};

/**
 * Moves an active account one place up or down among the accounts of its own group (cards, or everything else,
 * as the list shows them), swapping with the nearest account of that group. The order stays dense and unique.
 */
export const MoveAccount: UseCase<{ accountId: string; direction: 'up' | 'down' }, void, 'ACCOUNT_NOT_FOUND' | 'AT_EDGE'> = {
  name: 'MoveAccount',
  async execute(ctx, input) {
    const rows = await ctx.query("SELECT id, type = 'card' FROM account WHERE status = 'active' ORDER BY sort_order, id");
    const ids = rows.map((r) => String(r[0]));
    const isCard = rows.map((r) => Number(r[1]) === 1);
    const i = ids.indexOf(input.accountId);
    if (i < 0) return err('ACCOUNT_NOT_FOUND');
    const step = input.direction === 'up' ? -1 : 1;
    let j = i + step;
    while (j >= 0 && j < ids.length && isCard[j] !== isCard[i]) j += step;
    if (j < 0 || j >= ids.length) return err('AT_EDGE');
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    const at = ctx.nowMs();
    // Renumber the active accounts densely in the new order.
    for (const [k, id] of ids.entries()) {
      await ctx.execute('UPDATE account SET sort_order = ?, updated_at = ? WHERE id = ?', [k, at, id] as SqlParam[]);
    }
    ctx.touch('account', input.accountId, { moved: input.direction });
    ctx.emit('AccountsChanged', { accountIds: ids });
    return ok(undefined);
  },
};

export const ArchiveAccount: UseCase<{ accountId: string }, void, 'ACCOUNT_NOT_FOUND'> = {
  name: 'ArchiveAccount',
  async execute(ctx, input) {
    if ((await accountStatus(ctx, input.accountId)) === null) return err('ACCOUNT_NOT_FOUND');
    await ctx.execute("UPDATE account SET status = 'archived', updated_at = ? WHERE id = ?", [ctx.nowMs(), input.accountId]);
    ctx.touch('account', input.accountId, { status: 'archived' });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok(undefined);
  },
};

/** Undo for Archive: the account returns at the end of the active list. History was never touched. */
export const RestoreAccount: UseCase<{ accountId: string }, void, 'ACCOUNT_NOT_FOUND'> = {
  name: 'RestoreAccount',
  async execute(ctx, input) {
    if ((await accountStatus(ctx, input.accountId)) === null) return err('ACCOUNT_NOT_FOUND');
    const order = Number((await ctx.query("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM account WHERE status = 'active'"))[0]?.[0] ?? 0);
    await ctx.execute("UPDATE account SET status = 'active', sort_order = ?, updated_at = ? WHERE id = ?", [order, ctx.nowMs(), input.accountId]);
    ctx.touch('account', input.accountId, { status: 'active' });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok(undefined);
  },
};

/**
 * Counts an asset account in, or leaves it out of, the totals (ACC-006). Cards always count in Card dues, so
 * they refuse. Nothing is deleted or hidden: the account and its balance stay as they were.
 */
export const SetAccountInclusion: UseCase<{ accountId: string; include: boolean }, void, 'ACCOUNT_NOT_FOUND' | 'CARD_ALWAYS_COUNTS'> = {
  name: 'SetAccountInclusion',
  async execute(ctx, input) {
    const r = (await ctx.query('SELECT type FROM account WHERE id = ?', [input.accountId]))[0];
    if (!r) return err('ACCOUNT_NOT_FOUND');
    if (String(r[0]) === 'card') return err('CARD_ALWAYS_COUNTS');
    await ctx.execute('UPDATE account SET include_in_overview = ?, updated_at = ? WHERE id = ?', [input.include ? 1 : 0, ctx.nowMs(), input.accountId]);
    ctx.touch('account', input.accountId, { includeInTotals: input.include });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok(undefined);
  },
};

/**
 * Ledger invariants, checked before every commit: an opening_balance transaction has exactly one posting
 * and it equals the transaction's amount; every transaction's postings reference an existing account.
 */
export const openingBalanceShape: Invariant = {
  name: 'openingBalanceShape',
  async check(ctx) {
    // account.opening_minor is a convenience copy of the opening posting (S2 4.1); the two must agree.
    for (const a of ctx.touched.filter((t) => t.entityKind === 'account')) {
      const r = (
        await ctx.query(
          "SELECT opening_minor, COALESCE((SELECT SUM(signed_amount_minor) FROM posting WHERE account_id = account.id AND posting_kind = 'opening_balance'), 0) FROM account WHERE id = ?",
          [a.entityId],
        )
      )[0];
      if (r && r[0] !== null && Number(r[0]) !== Number(r[1])) return 'account opening balance must equal its opening posting';
    }
    const ids = ctx.touched.filter((t) => t.entityKind === 'transaction').map((t) => t.entityId);
    for (const id of ids) {
      const rows = await ctx.query(
        "SELECT t.event_type, t.amount_minor, COUNT(p.id), COALESCE(SUM(ABS(p.signed_amount_minor)), 0) FROM \"transaction\" t LEFT JOIN posting p ON p.transaction_id = t.id WHERE t.id = ? GROUP BY t.id",
        [id],
      );
      const r = rows[0];
      if (r && String(r[0]) === 'opening_balance' && (Number(r[2]) !== 1 || Number(r[1]) !== Number(r[3]))) return 'opening balance must be one posting equal to its amount';
    }
    return null;
  },
};
