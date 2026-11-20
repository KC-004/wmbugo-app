import { dayNets } from '../ledger/spendingQueries';
import { incomeEntries, spendingEntries, type SegmentEntry } from '../ledger/segmentQueries';
import type { Querier } from '../planning/budgets';
import { bucketLabel, bucketOf, bucketsOf, granularityFor, narrowPeriod, type Granularity } from '../profile/insightsBuckets';
import { ledgerFilters, scopeEcho, type InsightsContext, type InsightsScope, type ScopeEcho } from './scope';
import { spendingChange } from './spending';

/**
 * The drill-down behind any Insights figure (Story 7.3, INS-002, PRD 8.9): the segment's amount, a chart of it over time, how it
 * was worked out and the exact entries that make it up. The entries are the same rows the figure counted, so their refund-net sum
 * is the figure; there is no second definition. No field carries a signed amount: a refund surplus is `backMinor`.
 */

export type DrillTarget =
  | { readonly kind: 'spent' }
  | { readonly kind: 'income' }
  | { readonly kind: 'category'; readonly id: string; readonly name: string }
  /** Several categories together (the donut's `Other`). */
  | { readonly kind: 'categories'; readonly ids: readonly string[]; readonly name: string }
  | { readonly kind: 'merchant'; readonly key: string; readonly name: string }
  /** A day, week or month of spending, or (with `income`) of income. */
  | { readonly kind: 'bucket'; readonly start: string; readonly end: string; readonly label: string; readonly income?: boolean };

/** The scope a target narrows the overview's scope to. */
export function narrowScope(scope: InsightsScope, target: DrillTarget): InsightsScope {
  switch (target.kind) {
    case 'spent':
    case 'income':
      return scope;
    case 'category':
      return { ...scope, filters: { ...scope.filters, categoryIds: [target.id] } };
    case 'categories':
      return { ...scope, filters: { ...scope.filters, categoryIds: target.ids } };
    case 'merchant':
      return { ...scope, filters: { ...scope.filters, merchantKeys: [target.key] } };
    case 'bucket':
      return { period: narrowPeriod(scope.period, { start: target.start, end: target.end }), filters: scope.filters };
  }
}

export interface DrillBucket {
  readonly start: string;
  readonly end: string;
  readonly label: string;
  readonly spentMinor: number;
  readonly backMinor: number;
}

export interface DrillDay {
  readonly date: string;
  /** The day's refund-net total: `spentMinor`, or `backMinor` when refunds are more than spending that day. */
  readonly spentMinor: number;
  readonly backMinor: number;
  readonly entries: readonly SegmentEntry[];
}

export interface DrillExplanation {
  readonly formula: 'spent' | 'income';
  /** `1–30 Nov`. */
  readonly timeframe: string;
  readonly entryCount: number;
  /** The comparison, for the overview's own Spent figure: its baseline window and what was spent in it, or why there is none. */
  readonly baseline: { readonly kind: 'amount'; readonly label: string; readonly previousMinor: number } | { readonly kind: 'none' } | null;
}

export interface DrillDown {
  readonly target: DrillTarget;
  readonly mode: 'spending' | 'income';
  readonly scope: ScopeEcho;
  /** The segment's figure (refund-net for spending): `spentMinor`, `backMinor` or, for income, `incomeMinor`. */
  readonly spentMinor: number;
  readonly backMinor: number;
  readonly incomeMinor: number;
  readonly granularity: Granularity;
  readonly buckets: readonly DrillBucket[];
  readonly days: readonly DrillDay[];
  readonly explanation: DrillExplanation;
}

const signed = (e: SegmentEntry): number => (e.type === 'refund' ? -e.amountMinor : e.amountMinor);
const view = (net: number) => ({ spentMinor: Math.max(0, net), backMinor: Math.max(0, -net) });

/** Whether a target is about income (the Income tile, or an income bucket). */
const isIncome = (t: DrillTarget): boolean => t.kind === 'income' || (t.kind === 'bucket' && t.income === true);

export async function drillDown(q: Querier, scope: InsightsScope, target: DrillTarget, ctx: InsightsContext): Promise<DrillDown> {
  const narrowed = narrowScope(scope, target);
  const f = await ledgerFilters(q, narrowed);
  const range = { start: narrowed.period.start, end: narrowed.period.end };
  const income = isIncome(target);
  const entries = income ? await incomeEntries(q, range, f) : await spendingEntries(q, range, f);
  const net = entries.reduce((s, e) => s + signed(e), 0);

  const byDay = new Map<string, SegmentEntry[]>();
  for (const e of entries) byDay.set(e.localDate, [...(byDay.get(e.localDate) ?? []), e]);
  const days: DrillDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({ date, ...view(list.reduce((s, e) => s + signed(e), 0)), entries: list }));

  const g = granularityFor(range);
  const dayRows = income ? [] : await dayNets(q, range, f);
  const buckets: DrillBucket[] = bucketsOf(range, g, ctx.profile.firstDay).map((b) => {
    const total = dayRows.filter((d) => d.date >= b.start && d.date <= b.end).reduce((s, d) => s + d.netMinor, 0);
    return { start: b.start, end: b.end, label: bucketLabel(bucketOf(b.start, g, range, ctx.profile.firstDay), g), ...view(total) };
  });

  let baseline: DrillExplanation['baseline'] = null;
  if (target.kind === 'spent') {
    const change = await spendingChange(q, scope, ctx);
    baseline = change.kind === 'change' ? { kind: 'amount', label: change.baselineLabel, previousMinor: change.previousMinor } : { kind: 'none' };
  }

  return {
    target,
    mode: income ? 'income' : 'spending',
    scope: scopeEcho(narrowed),
    spentMinor: income ? 0 : view(net).spentMinor,
    backMinor: income ? 0 : view(net).backMinor,
    incomeMinor: income ? net : 0,
    granularity: g,
    buckets,
    days,
    explanation: { formula: income ? 'income' : 'spent', timeframe: narrowed.period.title, entryCount: new Set(entries.map((e) => e.id)).size, baseline },
  };
}
