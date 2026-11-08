import { parseAmountInput } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

export type AccountType = 'cash' | 'bank' | 'wallet' | 'savings_pot' | 'card';
export const ACCOUNT_TYPES: readonly AccountType[] = ['cash', 'bank', 'wallet', 'savings_pot', 'card'];

/** Type defaults (UX-DR8): Phosphor icon name and the `cat-*` colour token. */
export const ACCOUNT_DEFAULTS: Readonly<Record<AccountType, { icon: string; color: string }>> = {
  cash: { icon: 'Money', color: 'cat-lime' },
  bank: { icon: 'Bank', color: 'cat-indigo' },
  wallet: { icon: 'Wallet', color: 'cat-sky' },
  savings_pot: { icon: 'PiggyBank', color: 'cat-emerald' },
  card: { icon: 'CreditCard', color: 'cat-fuchsia' },
};

export const MAX_ACCOUNT_NAME = 60;

export type AccountNameError = 'NAME_REQUIRED' | 'NAME_TOO_LONG';

export function validateAccountName(raw: string): Result<string, AccountNameError> {
  const name = raw.trim();
  if (name === '') return err('NAME_REQUIRED');
  if ([...name].length > MAX_ACCOUNT_NAME) return err('NAME_TOO_LONG');
  return ok(name);
}

/**
 * The signed opening posting for what the user typed. Assets are positive; a credit card holds what is
 * owed, so the amount typed ("S$450 owed") is stored negative (AD-5). Zero stays zero.
 */
export function openingPostingMinor(type: AccountType, typedMinor: number): number {
  if (typedMinor === 0) return 0;
  return type === 'card' ? -typedMinor : typedMinor;
}

/** An account's balance as presenters see it: unknown is "not set", never zero. */
export type BalanceView = { readonly kind: 'not-set' } | { readonly kind: 'known'; readonly minor: number };

export interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly icon: string;
  readonly colorToken: string;
  readonly sortOrder: number;
  readonly status: 'active' | 'archived';
  readonly balanceNotSet: boolean;
  /** Sum of the account's postings (opening included). Meaningful only when the balance is set. */
  readonly postingsMinor: number;
  /** Included in the Home totals (default true; the account settings screen arrives later). */
  readonly includeInOverview?: boolean;
  /** Savings pots only: money transferred in from ordinary accounts minus money taken out to them (can be below zero). */
  readonly movedInMinor?: number;
  /** Every posting on the account, an opening balance included. 0 means it can be deleted. */
  readonly postingCount?: number;
}

export function balanceOf(row: Pick<AccountRow, 'balanceNotSet' | 'postingsMinor'>): BalanceView {
  return row.balanceNotSet ? { kind: 'not-set' } : { kind: 'known', minor: row.postingsMinor };
}

/** What Mei owes on a card is the negation of its (negative) balance. Not set stays not set. */
export function cardDues(row: AccountRow): BalanceView {
  const b = balanceOf(row);
  return b.kind === 'known' ? { kind: 'known', minor: -b.minor } : b;
}

/**
 * Total across asset accounts only: cards are liabilities and are never added in ("In accounts" and
 * "Card dues" are never summed), and accounts with no balance set are skipped, not counted as zero.
 */
export function assetTotal(rows: readonly AccountRow[]): { minor: number; accountsCounted: number; accountsNotSet: number } {
  let minor = 0;
  let counted = 0;
  let notSet = 0;
  for (const r of rows) {
    if (r.status !== 'active' || r.type === 'card' || r.includeInOverview === false) continue;
    const b = balanceOf(r);
    if (b.kind === 'not-set') {
      if (r.type !== 'savings_pot') notSet += 1;
    }
    else {
      minor += b.minor;
      counted += 1;
    }
  }
  return { minor, accountsCounted: counted, accountsNotSet: notSet };
}

/** SQL for the accounts list: postings summed per account, in the user's order. Archived rows are included; callers filter. */
export const ACCOUNT_LIST_SQL =
  `SELECT a.id, a.name, a.type, a.icon, a.color_token, a.sort_order, a.status, a.balance_not_set, COALESCE(SUM(CASE WHEN t.removed_at IS NULL AND t.status = 'confirmed' AND (p.posting_kind <> 'normal' OR a.opening_effective_at IS NULL OR t.occurred_at_utc >= a.opening_effective_at) THEN p.signed_amount_minor END), 0) AS postings_minor, a.include_in_overview, CASE WHEN a.type = 'savings_pot' THEN COALESCE((SELECT SUM(p1.signed_amount_minor) FROM posting p1 JOIN "transaction" t1 ON t1.id = p1.transaction_id AND t1.event_type = 'transfer' AND t1.removed_at IS NULL AND t1.status = 'confirmed' WHERE p1.account_id = a.id AND EXISTS (SELECT 1 FROM posting p2 JOIN account a2 ON a2.id = p2.account_id WHERE p2.transaction_id = t1.id AND p2.id <> p1.id AND a2.type <> 'savings_pot')), 0) ELSE 0 END AS moved_in_minor, COUNT(p.id) AS posting_count FROM account a LEFT JOIN posting p ON p.account_id = a.id LEFT JOIN "transaction" t ON t.id = p.transaction_id GROUP BY a.id ORDER BY a.sort_order, a.id`;

export function mapAccountRows(rows: readonly (readonly unknown[])[]): AccountRow[] {
  return rows.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    type: String(r[2]) as AccountType,
    icon: String(r[3]),
    colorToken: String(r[4]),
    sortOrder: Number(r[5]),
    status: String(r[6]) as 'active' | 'archived',
    balanceNotSet: Number(r[7]) === 1,
    postingsMinor: Number(r[8]),
    includeInOverview: Number(r[9] ?? 1) === 1,
    movedInMinor: Number(r[10] ?? 0),
    postingCount: Number(r[11] ?? 0),
  }));
}

export type BuildAccountError = AccountNameError | 'AMOUNT_INVALID' | 'AMOUNT_NEGATIVE' | 'AMOUNT_TOO_LARGE' | 'EXCESS_DECIMALS';

/**
 * Turns what the form holds into a NewAccount. An empty balance means "not set" (never zero); "Rough
 * is fine", so any amount the currency can hold exactly is accepted.
 */
export function buildNewAccount(input: {
  name: string;
  type: AccountType;
  balanceText: string;
  exponent: number;
}): Result<{ name: string; type: AccountType; openingMinor: number | null }, BuildAccountError> {
  const name = validateAccountName(input.name);
  if (!name.ok) return name;
  if (input.balanceText.trim() === '') return ok({ name: name.value, type: input.type, openingMinor: null });
  const amount = parseAmountInput(input.balanceText, input.exponent);
  if (!amount.ok) return amount;
  return ok({ name: name.value, type: input.type, openingMinor: amount.value });
}
