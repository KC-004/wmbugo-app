import type { AccountRow } from './accounts';

/**
 * The balance read model (FIN-011, FIN-012, FIN-013, FIN-016). One rule for every figure on Home, the accounts
 * list and an account's own page:
 *
 *   balance = opening posting + adjustment postings + every confirmed, non-removed ordinary posting whose
 *   effective instant is at or after the account's opening instant.
 *
 * The SQL that computes a row's `postingsMinor` is `ACCOUNT_LIST_SQL` in accounts.ts. This module turns rows
 * into the figures people read: card outstanding, overview totals and the "not set" notes.
 */

export type CardPosition =
  | { readonly kind: 'not-set' }
  | { readonly kind: 'owed'; readonly outstandingMinor: number }
  | { readonly kind: 'in-credit'; readonly inCreditMinor: number };

/**
 * A card's ledger balance is negative while money is owed (AD-5), so outstanding is its negation:
 * opening dues -45000 plus a -20000 charge is outstanding 65000. A card above zero is in credit and has no
 * negative outstanding. A card with no balance set is "not set", never zero.
 */
export function cardPosition(card: Pick<AccountRow, 'balanceNotSet' | 'postingsMinor'>): CardPosition {
  if (card.balanceNotSet) return { kind: 'not-set' };
  return card.postingsMinor > 0 ? { kind: 'in-credit', inCreditMinor: card.postingsMinor } : { kind: 'owed', outstandingMinor: card.postingsMinor === 0 ? 0 : -card.postingsMinor };
}

export interface OverviewTotals {
  /** Sum of balances of active asset accounts that count in totals and have a balance; null when none has. */
  readonly inAccountsMinor: number | null;
  /** Sum of outstanding on active cards that count in totals and have a balance; null when none has. */
  readonly cardDuesMinor: number | null;
  /** Credit sitting on cards (overpaid); shown apart, never subtracted from dues. */
  readonly cardsInCreditMinor: number;
  readonly notSetAssets: number;
  readonly notSetCards: number;
  /** In accounts minus Card dues; the only place the two meet. null when nothing is known. A credit limit is never part of it. */
  readonly netWorthMinor: number | null;
}

/** The overview totals query. Archived accounts and accounts switched out of totals are left out entirely. */
export function overviewTotals(rows: readonly AccountRow[]): OverviewTotals {
  let assets = 0;
  let assetsKnown = 0;
  let dues = 0;
  let cardsKnown = 0;
  let credit = 0;
  let notSetAssets = 0;
  let notSetCards = 0;
  for (const r of rows) {
    if (r.status !== 'active' || r.includeInOverview === false) continue;
    if (r.type === 'card') {
      const c = cardPosition(r);
      if (c.kind === 'not-set') notSetCards += 1;
      else {
        cardsKnown += 1;
        if (c.kind === 'owed') dues += c.outstandingMinor;
        else credit += c.inCreditMinor;
      }
    } else if (r.balanceNotSet) {
      notSetAssets += 1;
    } else {
      assetsKnown += 1;
      assets += r.postingsMinor;
    }
  }
  const inAccountsMinor = assetsKnown > 0 ? assets : null;
  const cardDuesMinor = cardsKnown > 0 ? dues : null;
  return {
    inAccountsMinor,
    cardDuesMinor,
    cardsInCreditMinor: credit,
    notSetAssets,
    notSetCards,
    netWorthMinor: inAccountsMinor === null && cardDuesMinor === null ? null : (inAccountsMinor ?? 0) - (cardDuesMinor ?? 0),
  };
}

export const BALANCE_NOT_SET = 'Balance not set';

/** "+1 account not set", "+2 accounts not set", "+1 card not set", "+3 cards not set"; null when none. */
export function notSetNote(count: number, kind: 'account' | 'card'): string | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  return `+${count} ${kind}${count === 1 ? '' : 's'} not set`;
}

/**
 * A posting dated before its account's opening instant does not change that account's balance (FIN-016).
 * This is derived on read, never stored; the entry still counts in "Spent this period" if it is an expense.
 */
export function beforeTrackingStarted(transactionInstantMs: number, openingInstantMs: number | null): boolean {
  return openingInstantMs !== null && transactionInstantMs < openingInstantMs;
}

/**
 * Transactions of one account that sit before its tracking start, for the account's timeline.
 * Param: account id. Ordinary postings only; opening and adjustment postings are never "before".
 */
export const BEFORE_TRACKING_SQL =
  "SELECT t.id FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id JOIN account a ON a.id = p.account_id WHERE p.account_id = ? AND p.posting_kind = 'normal' AND a.opening_effective_at IS NOT NULL AND t.occurred_at_utc < a.opening_effective_at AND t.removed_at IS NULL";
