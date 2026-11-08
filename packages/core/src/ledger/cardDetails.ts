import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import { instantFromLocal } from './entryCommands';

/** What a card holds from the user's statement. Every field is optional; null means "not entered". */
export interface CardDetails {
  readonly statementDueMinor: number | null;
  /** The statement's due date, yyyy-mm-dd. */
  readonly dueDate: string | null;
  readonly limitMinor: number | null;
}

export type CardDetailsError =
  | 'ACCOUNT_NOT_FOUND'
  | 'NOT_A_CARD'
  | 'STATEMENT_INVALID'
  | 'LIMIT_INVALID'
  | 'DATE_INVALID';

const validAmount = (v: number | null) => v === null || (Number.isSafeInteger(v) && v > 0);

/**
 * Stores what the user copies from their card statement: the amount due, its due date and the limit (Story 2.6).
 * wmbugo is not connected to the bank, so none of it changes what is owed (that is the ledger) and the limit never
 * enters any total. A zero amount or limit is refused; clearing a field (null) removes it.
 */
export const UpdateCardDetails: UseCase<{ accountId: string } & CardDetails, void, CardDetailsError> = {
  name: 'UpdateCardDetails',
  async execute(ctx, input) {
    const a = (await ctx.query('SELECT type FROM account WHERE id = ?', [input.accountId]))[0];
    if (!a) return err('ACCOUNT_NOT_FOUND');
    if (String(a[0]) !== 'card') return err('NOT_A_CARD');
    if (!validAmount(input.statementDueMinor)) return err('STATEMENT_INVALID');
    if (!validAmount(input.limitMinor)) return err('LIMIT_INVALID');
    if (input.dueDate !== null && instantFromLocal(input.dueDate, '00:00', 'UTC') === null) return err('DATE_INVALID');

    const at = ctx.nowMs();
    const hasStatement = input.statementDueMinor !== null || input.dueDate !== null;
    // "Paid" counts payments since the statement was entered, so editing only the limit must not restart that.
    const old = (await ctx.query('SELECT statement_due_minor, statement_due_date, statement_set_at FROM account WHERE id = ?', [input.accountId]))[0]!;
    const same = (old[0] === null ? null : Number(old[0])) === input.statementDueMinor && (old[1] === null ? null : String(old[1])) === input.dueDate;
    const setAt = !hasStatement ? null : same && old[2] !== null ? Number(old[2]) : at;
    await ctx.execute('UPDATE account SET statement_due_minor = ?, statement_due_date = ?, credit_limit_minor = ?, statement_set_at = ?, updated_at = ? WHERE id = ?', [
      input.statementDueMinor,
      input.dueDate,
      input.limitMinor,
      setAt,
      at,
      input.accountId,
    ]);
    ctx.touch('account', input.accountId, { cardDetails: true });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok(undefined);
  },
};

/** One card's statement details and the payments that arrived after they were entered. Param: account id. */
export const CARD_DETAILS_SQL =
  "SELECT a.statement_due_minor, a.statement_due_date, a.credit_limit_minor, a.statement_set_at, COALESCE((SELECT SUM(p.signed_amount_minor) FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE p.account_id = a.id AND p.posting_kind = 'normal' AND p.signed_amount_minor > 0 AND t.event_type = 'transfer' AND t.removed_at IS NULL AND t.status = 'confirmed' AND t.created_at >= COALESCE(a.statement_set_at, 0)), 0) FROM account a WHERE a.id = ?";

export interface CardDetailsRead extends CardDetails {
  /** Money moved onto the card (transfers in) since the statement was entered. */
  readonly paidSinceMinor: number;
}

export function mapCardDetails(rows: readonly (readonly unknown[])[]): CardDetailsRead | null {
  const r = rows[0];
  if (!r) return null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    statementDueMinor: n(r[0]),
    dueDate: r[1] === null || r[1] === undefined ? null : String(r[1]),
    limitMinor: n(r[2]),
    paidSinceMinor: Number(r[4] ?? 0),
  };
}

export type StatementStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'paid'; readonly amountMinor: number }
  | { readonly kind: 'due'; readonly amountMinor: number | null; readonly dueDate: string | null }
  | { readonly kind: 'overdue'; readonly amountMinor: number | null; readonly dueDate: string };

/**
 * Derived on read, never stored: paid once the payments since the statement was entered reach its amount; overdue
 * when the due date has passed and it is not paid. \`today\` is the local date (yyyy-mm-dd).
 */
export function statementStatus(d: CardDetails & { paidSinceMinor: number }, today: string): StatementStatus {
  if (d.statementDueMinor === null && d.dueDate === null) return { kind: 'none' };
  if (d.statementDueMinor !== null && d.paidSinceMinor >= d.statementDueMinor) return { kind: 'paid', amountMinor: d.statementDueMinor };
  if (d.dueDate !== null && today > d.dueDate) return { kind: 'overdue', amountMinor: d.statementDueMinor, dueDate: d.dueDate };
  return { kind: 'due', amountMinor: d.statementDueMinor, dueDate: d.dueDate };
}

/** The asset account that last paid this card: the From side of the newest transfer onto it. Param: card id. */
export const LAST_PAYER_SQL =
  "SELECT pf.account_id FROM posting pt JOIN \"transaction\" t ON t.id = pt.transaction_id JOIN posting pf ON pf.transaction_id = t.id AND pf.signed_amount_minor < 0 WHERE pt.account_id = ? AND pt.signed_amount_minor > 0 AND t.event_type = 'transfer' AND t.removed_at IS NULL AND t.status = 'confirmed' ORDER BY t.created_at DESC, t.id DESC LIMIT 1";

/**
 * Where a card bill is paid from: the asset account that last paid this card, else the default account from Settings,
 * else the most recently used active asset account, else the first one. null when there is no asset account.
 */
export function pickPayerAccount(assetIds: readonly string[], lastPayer: string | null, settingDefault: string | null, lastUsed: string | null): string | null {
  for (const c of [lastPayer, settingDefault, lastUsed]) if (c && assetIds.includes(c)) return c;
  return assetIds[0] ?? null;
}

/**
 * What a ready-filled Pay card bill starts with: the unpaid statement amount, else what is owed, else nothing
 * (and the sheet says nothing is owed).
 */
export function payBillAmount(details: CardDetailsRead | null, today: string, outstandingMinor: number): { amountMinor: number | null; nothingOwed: boolean } {
  const s = details ? statementStatus(details, today) : { kind: 'none' as const };
  if ((s.kind === 'due' || s.kind === 'overdue') && s.amountMinor !== null) return { amountMinor: s.amountMinor, nothingOwed: false };
  return outstandingMinor > 0 ? { amountMinor: outstandingMinor, nothingOwed: false } : { amountMinor: null, nothingOwed: true };
}
