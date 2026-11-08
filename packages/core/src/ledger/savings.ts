import { err, ok } from '../shared/result';
import type { UseCase } from '../writer/ledgerWriter';
import { ACCOUNT_DEFAULTS, ACCOUNT_TYPES, type AccountType } from './accounts';

/**
 * Money moved into savings pots in a period (Story 2.8): transfers from a non-pot account into a pot, minus transfers
 * from a pot to a non-pot account. Pot-to-pot moves count zero; a card bill or a move between ordinary accounts is
 * not savings. Exact (it can be below zero); use `savedDisplay` to show it. Params: start, end (local dates).
 */
export const SAVINGS_MOVED_IN_SQL =
  "SELECT COALESCE(SUM(CASE WHEN ato.type = 'savings_pot' AND afr.type <> 'savings_pot' THEN t.amount_minor WHEN afr.type = 'savings_pot' AND ato.type <> 'savings_pot' THEN -t.amount_minor ELSE 0 END), 0) FROM \"transaction\" t JOIN posting pf ON pf.transaction_id = t.id AND pf.signed_amount_minor < 0 JOIN account afr ON afr.id = pf.account_id JOIN posting pt ON pt.transaction_id = t.id AND pt.signed_amount_minor > 0 JOIN account ato ON ato.id = pt.account_id WHERE t.event_type = 'transfer' AND t.status = 'confirmed' AND t.removed_at IS NULL AND t.local_date BETWEEN ? AND ?";

/** What a screen shows for money saved: never a minus sign, so a net withdrawal reads as zero. */
export function savedDisplay(movedInMinor: number): number {
  return Math.max(0, movedInMinor);
}

export type ChangeTypeError = 'ACCOUNT_NOT_FOUND' | 'TYPE_INVALID' | 'HAS_ENTRIES';

/**
 * Changes an account's type (Story 2.8). Cash, bank, wallet and savings pot switch freely. Moving between those and a
 * credit card is allowed only while the account has no entries (an opening balance does not count); the opening is
 * then re-signed, because a card holds what is owed as a negative. The icon and colour follow the type only when they
 * were still the old type's defaults.
 */
export const ChangeAccountType: UseCase<{ accountId: string; type: AccountType }, void, ChangeTypeError> = {
  name: 'ChangeAccountType',
  async execute(ctx, input) {
    if (!ACCOUNT_TYPES.includes(input.type)) return err('TYPE_INVALID');
    const a = (await ctx.query('SELECT type, icon, color_token FROM account WHERE id = ?', [input.accountId]))[0];
    if (!a) return err('ACCOUNT_NOT_FOUND');
    const from = String(a[0]) as AccountType;
    if (from === input.type) return ok(undefined);

    const crossesCard = (from === 'card') !== (input.type === 'card');
    if (crossesCard) {
      const entries = Number(
        (
          await ctx.query(
            "SELECT COUNT(*) FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE p.account_id = ? AND p.posting_kind <> 'opening_balance' AND t.removed_at IS NULL",
            [input.accountId],
          )
        )[0]![0],
      );
      if (entries > 0) return err('HAS_ENTRIES');
      const opening = await ctx.query('SELECT opening_minor FROM account WHERE id = ?', [input.accountId]);
      if (opening[0] && opening[0][0] !== null && Number(opening[0][0]) !== 0) {
        await ctx.execute('UPDATE account SET opening_minor = -opening_minor WHERE id = ?', [input.accountId]);
        await ctx.execute(
          "UPDATE posting SET signed_amount_minor = -signed_amount_minor, direction = CASE direction WHEN 'in' THEN 'out' ELSE 'in' END WHERE account_id = ? AND posting_kind = 'opening_balance'",
          [input.accountId],
        );
      }
    }
    const old = ACCOUNT_DEFAULTS[from];
    const next = ACCOUNT_DEFAULTS[input.type];
    const keepLook = String(a[1]) !== old.icon || String(a[2]) !== old.color;
    await ctx.execute('UPDATE account SET type = ?, icon = ?, color_token = ?, updated_at = ? WHERE id = ?', [
      input.type,
      keepLook ? String(a[1]) : next.icon,
      keepLook ? String(a[2]) : next.color,
      ctx.nowMs(),
      input.accountId,
    ]);
    ctx.touch('account', input.accountId, { typeFrom: from, typeTo: input.type });
    ctx.emit('AccountsChanged', { accountIds: [input.accountId] });
    return ok(undefined);
  },
};
