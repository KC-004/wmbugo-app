import { ACCOUNT_LIST_SQL, mapAccountRows } from '../ledger/accounts';
import { SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL, homeAccounts, spentMinor, type HomeAccounts } from '../ledger/readModels';
import { TO_CHECK_SQL } from '../capture/reviewQueue';
import { budgetStatus, type Querier } from '../planning/budgets';
import { readPeriodProfile } from '../planning/budgetStore';
import { leftInBudget } from '../planning/needsWantsSavings';
import { addDays, daysBetween, periodFor, periodLabel } from '../profile/period';
import { toLocalDate } from '../shared/clock';

/**
 * The Home read model (Story 5.1, HOM-001, HOM-004). One snapshot for the profile's default period, composed only from the
 * owners' queries: the period service, `leftInBudget`, `budgetStatus`, the account overview, the review queue and the
 * refund-net spent total. Insights owns no table and adds no aggregation of its own. All money is integer minor units.
 */

/** `overall`: an overall budget; `nws_only`: only the 50/30/20 targets; `spent_only`: neither, so Home shows what was spent. */
export type HeroMode = 'overall' | 'nws_only' | 'spent_only';

export interface HomeSummary {
  /** The profile's default period (from the period service) and the local date it was read for. */
  readonly today: string;
  readonly period: { readonly start: string; readonly end: string; readonly label: string; readonly shortened: boolean };
  readonly heroMode: HeroMode;
  /** Null in `spent_only`. `leftMinor` can be below zero: the screen shows it as over budget, never as a negative. */
  readonly leftMinor: number | null;
  readonly usedMinor: number | null;
  readonly targetMinor: number | null;
  /** Spending counted in `nws_only` that no Need or Want type covers; 0 otherwise. */
  readonly notClassifiedMinor: number;
  readonly refundSurplusMinor: number;
  /** Days remaining including today, of the budget's period (the default period when there is no budget). */
  readonly daysLeft: number;
  /** Days until the next payday (when the next period starts); null when no payday is set. */
  readonly daysToPayday: number | null;
  /** Confirmed expenses minus refunds in the default period, never below zero. */
  readonly spentThisPeriodMinor: number;
  readonly accounts: HomeAccounts;
  /** How many entries wait in the review queue (`TO_CHECK_SQL` is its one definition). */
  readonly toCheckCount: number;
}

export async function homeSummary(q: Querier, nowMs: number): Promise<HomeSummary | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const date = toLocalDate(nowMs, read.timezoneId);
  if (!date.ok) return null;
  const today = date.value;
  const period = periodFor(today, read.profile.rule);

  const expenses = Number((await q.query(SPENT_EXPENSES_SQL, [period.start, period.end]))[0]![0]);
  const refunds = Number((await q.query(SPENT_REFUNDS_SQL, [period.start, period.end]))[0]![0]);
  const accounts = homeAccounts(mapAccountRows(await q.query(ACCOUNT_LIST_SQL)));
  const toCheckCount = (await q.query(TO_CHECK_SQL)).length;
  const left = await leftInBudget(q, nowMs);

  const budgetPeriod = left.kind === 'none' ? period : left.period;
  const daysLeft = budgetStatus({ usedMinor: 0, targetMinor: 0, period: budgetPeriod, today }).daysRemaining;
  const daysToPayday = read.profile.rule.kind === 'none' ? null : Math.max(0, daysBetween(today, addDays(period.end, 1)));

  return {
    today,
    period: { start: period.start, end: period.end, label: periodLabel(period, today), shortened: period.shortened === true },
    heroMode: left.kind === 'overall' ? 'overall' : left.kind === 'types' ? 'nws_only' : 'spent_only',
    leftMinor: left.kind === 'none' ? null : left.leftMinor,
    usedMinor: left.kind === 'none' ? null : left.usedMinor,
    targetMinor: left.kind === 'none' ? null : left.targetMinor,
    notClassifiedMinor: left.kind === 'types' ? left.notClassifiedMinor : 0,
    refundSurplusMinor: left.kind === 'overall' ? left.refundSurplusMinor : 0,
    daysLeft,
    daysToPayday,
    spentThisPeriodMinor: spentMinor(expenses, refunds),
    accounts,
    toCheckCount,
  };
}
