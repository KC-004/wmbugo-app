import type { Querier } from '../planning/budgets';
import { leftInBudget } from '../planning/needsWantsSavings';
import { setAsideTotal } from '../planning/goals';
import { loadPlanTimeline } from '../planning/planTimeline';
import { ACCOUNT_LIST_SQL, mapAccountRows } from '../ledger/accounts';

/**
 * Free to use (Story 6.9, BDG-008, GOAL-002/004, J-BILLS): an estimate of what is really free to spend before payday, after
 * the bills still to pay and the money set aside for goals. It is never a guess: when a required input is missing it says
 * which one next step is needed instead of a number. Read-only: it composes the owners' queries and writes nothing.
 *
 *   value = min(left in budget, available assets - bills reserved - set aside)   (no floor)
 *
 * Left in budget is exactly the figure Home shows (including the 50/30/20-only form); a refund surplus is never added.
 */

export interface FreeToUseTerms {
  /** Left in budget, with `includes ₹3,000 not classified` for the 50/30/20-only form. */
  readonly leftMinor: number;
  /** The overall budget Left comes from (its detail opens from the breakdown); null for the 50/30/20-only form. */
  readonly leftBudgetId: string | null;
  readonly notClassifiedMinor: number;
  /** Included asset accounts (not savings pots, not cards) that have a balance. */
  readonly assetsMinor: number;
  /** Included asset accounts with no balance set: `+1 account not set`. */
  readonly notSetAccounts: number;
  /** Bills still to pay from today to the period end, plus this period's `Not seen yet` ones. */
  readonly billsReservedMinor: number;
  readonly billsCount: number;
  /** Set aside for goals, net of taken back, on active and paused goals. */
  readonly setAsideMinor: number;
}

export type FreeToUse =
  /** Nothing to show yet: no overall budget and no 50/30/20 targets. The one next step is `Set a limit`. */
  | { readonly gate: 'needs_limit' }
  /** A limit exists but no included asset account has a balance. `hasAccounts`: some account exists (open the list instead of adding one). */
  | { readonly gate: 'needs_account'; readonly hasAccounts: boolean }
  | ({
      readonly gate: 'ok';
      /** The estimate; below zero is `Short by` (shown without a sign). */
      readonly valueMinor: number;
      readonly shortByMinor: number;
      /** Which side of the minimum is smaller: `We use the smaller`. */
      readonly smaller: 'left' | 'accounts';
      /** What the accounts side leaves after bills and set-aside. */
      readonly leavesMinor: number;
    } & FreeToUseTerms);

export async function freeToUse(q: Querier, nowMs: number): Promise<FreeToUse> {
  const left = await leftInBudget(q, nowMs);
  if (left.kind === 'none') return { gate: 'needs_limit' };
  const accounts = mapAccountRows(await q.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active' && (a.type === 'cash' || a.type === 'bank' || a.type === 'wallet'));
  const included = accounts.filter((a) => a.includeInOverview !== false);
  const withBalance = included.filter((a) => !a.balanceNotSet);
  if (withBalance.length === 0) return { gate: 'needs_account', hasAccounts: accounts.length > 0 };
  const assetsMinor = withBalance.reduce((s, a) => s + a.postingsMinor, 0);
  const timeline = await loadPlanTimeline(q, nowMs);
  const reserved = (timeline?.items ?? []).filter((i) => i.status !== 'paid');
  const billsReservedMinor = reserved.reduce((s, i) => s + i.expectedAmountMinor, 0);
  const setAsideMinor = await setAsideTotal(q);
  const leavesMinor = assetsMinor - billsReservedMinor - setAsideMinor;
  const valueMinor = Math.min(left.leftMinor, leavesMinor);
  return {
    gate: 'ok',
    valueMinor,
    shortByMinor: valueMinor < 0 ? -valueMinor : 0,
    smaller: left.leftMinor <= leavesMinor ? 'left' : 'accounts',
    leavesMinor,
    leftMinor: left.leftMinor,
    leftBudgetId: left.kind === 'overall' ? left.budgetId : null,
    notClassifiedMinor: left.kind === 'types' ? left.notClassifiedMinor : 0,
    assetsMinor,
    notSetAccounts: included.length - withBalance.length,
    billsReservedMinor,
    billsCount: reserved.length,
    setAsideMinor,
  };
}

/**
 * What setting aside (or restoring a goal that holds) `moreMinor` would do to Free to use: the shortfall it would leave, or null
 * when it leaves something. Used by the Set aside sheet and a restore (GOAL-004): the action stays allowed, only the warning shows.
 */
export function shortfallAfterHolding(free: FreeToUse, moreMinor: number): number | null {
  if (free.gate !== 'ok' || moreMinor <= 0) return null;
  const after = Math.min(free.leftMinor, free.leavesMinor - moreMinor);
  return after < 0 && after < free.valueMinor ? -after : null;
}
