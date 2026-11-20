import { dayNets, incomeNet, spendingNet } from '../ledger/spendingQueries';
import type { Querier } from '../planning/budgets';
import { daysBetween } from '../profile/period';
import { bucketLabel, bucketsOf, granularityFor, type Granularity } from '../profile/insightsBuckets';
import { earlierPeriods, windowLabel, type DateSpan, type InsightsPeriod } from '../profile/insightsPeriods';
import { ledgerFilters, scopeEcho, type InsightsContext, type InsightsScope, type ScopeEcho } from './scope';

/**
 * The trend and the in and out comparison (Story 7.5, INS-010, INS-011): how spending moved through the period, and how money
 * in compared with money out over recent periods. Exact refund-net figures per bucket; a refund surplus is `backMinor`, never
 * a negative value. Buckets before the profile's first day and after today are left out, so no zeros are shown for days before wmbugo existed or that have not come yet.
 */

export interface TrendBucket {
  readonly start: string;
  readonly end: string;
  readonly label: string;
  readonly spentMinor: number;
  readonly backMinor: number;
}

export interface SpendingTrend {
  readonly scope: ScopeEcho;
  readonly granularity: Granularity;
  /** The granularities that would give at least two buckets, the default first. */
  readonly options: readonly Granularity[];
  readonly buckets: readonly TrendBucket[];
  /** The bucket that holds today, when the period is still running. */
  readonly todayStart: string | null;
}

const view = (net: number) => ({ spentMinor: Math.max(0, net), backMinor: Math.max(0, -net) });
const ORDER: readonly Granularity[] = ['day', 'week', 'month'];

/** Buckets of a span clipped to the profile's first day: a bucket wholly before it is dropped, one that straddles it starts there. */
function clippedBuckets(span: DateSpan, g: Granularity, ctx: InsightsContext): DateSpan[] {
  return bucketsOf(span, g, ctx.profile.firstDay)
    .filter((b) => b.end >= ctx.firstDay && b.start <= ctx.today)
    .map((b) => ({ start: b.start < ctx.firstDay ? ctx.firstDay : b.start, end: b.end > ctx.today ? ctx.today : b.end }));
}

export function trendOptions(span: DateSpan, ctx: InsightsContext): Granularity[] {
  const natural = granularityFor(span);
  const usable = ORDER.filter((g) => clippedBuckets(span, g, ctx).length >= 2);
  return usable.includes(natural) ? [natural, ...usable.filter((g) => g !== natural)] : usable;
}

export async function spendingTrend(q: Querier, scope: InsightsScope, ctx: InsightsContext, granularity?: Granularity): Promise<SpendingTrend> {
  const span = { start: scope.period.start, end: scope.period.end };
  const options = trendOptions(span, ctx);
  const g = granularity && options.includes(granularity) ? granularity : (options[0] ?? granularityFor(span));
  const rows = await dayNets(q, span, await ledgerFilters(q, scope));
  const buckets = clippedBuckets(span, g, ctx).map<TrendBucket>((b) => ({
    start: b.start,
    end: b.end,
    label: bucketLabel(b, g),
    ...view(rows.filter((r) => r.date >= b.start && r.date <= b.end).reduce((s, r) => s + r.netMinor, 0)),
  }));
  const today = buckets.find((b) => ctx.today >= b.start && ctx.today <= b.end);
  return { scope: scopeEcho(scope), granularity: g, options, buckets, todayStart: today?.start ?? null };
}

export interface InOutPeriod {
  readonly start: string;
  readonly end: string;
  /** `Nov` for a month or pay cycle, `1–7 Nov` for a short period. */
  readonly label: string;
  readonly incomeMinor: number;
  readonly spentMinor: number;
  readonly backMinor: number;
  /** Income minus spending, unsigned: `kept` or `short` says which way. */
  readonly netMinor: number;
  readonly net: 'kept' | 'short' | 'even';
}

export interface IncomeVsExpense {
  readonly scope: ScopeEcho;
  /** Oldest first, the selected period last. */
  readonly periods: readonly InOutPeriod[];
}

const labelOf = (span: DateSpan, period: InsightsPeriod): string => {
  const days = daysBetween(span.start, span.end) + 1;
  return period.preset === 'today' || period.preset === 'yesterday' || days <= 7 ? windowLabel(span.start, span.end) : bucketLabel(span, 'month');
};

export const IN_OUT_EARLIER = 5;

/** The selected period and up to five earlier ones of the same kind that end after the profile's first day. */
export async function incomeVsExpense(q: Querier, scope: InsightsScope, ctx: InsightsContext): Promise<IncomeVsExpense> {
  const f = await ledgerFilters(q, scope);
  const spans: DateSpan[] = [{ start: scope.period.start, end: scope.period.end }, ...earlierPeriods(scope.period, ctx.profile, IN_OUT_EARLIER).filter((s) => s.end >= ctx.firstDay)];
  const periods: InOutPeriod[] = [];
  for (const span of spans) {
    const income = await incomeNet(q, span, f);
    const net = await spendingNet(q, span, f);
    const v = view(net);
    const diff = income - v.spentMinor;
    periods.push({ start: span.start, end: span.end, label: labelOf(span, scope.period), incomeMinor: income, ...v, netMinor: Math.abs(diff), net: diff > 0 ? 'kept' : diff < 0 ? 'short' : 'even' });
  }
  return { scope: scopeEcho(scope), periods: periods.reverse() };
}
