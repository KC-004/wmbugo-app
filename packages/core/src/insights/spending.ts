import { UNCATEGORISED_ID } from '../ledger/categories';
import { categoryNets, entryCount, incomeNet, spendingNet, waitingCount } from '../ledger/spendingQueries';
import type { Querier } from '../planning/budgets';
import { comparableWindow } from '../profile/insightsPeriods';
import { ledgerFilters, scopeEcho, type InsightsContext, type InsightsScope, type ScopeEcho } from './scope';

/**
 * The Insights aggregation queries (Story 7.1, INS-003, INS-004, INS-005, INS-015, INS-016). Pure compositions of the ledger's
 * filtered queries: only confirmed, live expense and refund splits count, a refund reduces the spending of its category, and no
 * view type here carries a signed money field: a refund surplus is `backMinor`, a positive amount that screens print as
 * `₹X back`. All money is integer minor units; percentages are whole numbers.
 */

export interface CategorySpend {
  readonly categoryId: string;
  /** `Not classified` for Uncategorised and `Not itemised` splits. */
  readonly name: string;
  readonly icon: string;
  readonly colorToken: string;
  /** The amount shown: the exact net floored at zero. */
  readonly displayMinor: number;
  /** The positive surplus when refunds are more than spending in this category; 0 otherwise. */
  readonly backMinor: number;
}

export interface SpendingByCategory {
  readonly scope: ScopeEcho;
  /** Highest display amount first, then the refund-surplus categories. Categories with nothing in the period are absent. */
  readonly rows: readonly CategorySpend[];
}

export const NOT_CLASSIFIED = 'Not classified';

export async function spendingByCategory(q: Querier, scope: InsightsScope): Promise<SpendingByCategory> {
  const nets = await categoryNets(q, { start: scope.period.start, end: scope.period.end }, await ledgerFilters(q, scope));
  // Uncategorised (which holds `Not itemised` too) is one `Not classified` row, ranked like any category.
  const rows = nets
    .filter((n) => n.netMinor !== 0)
    .map<CategorySpend>((n) => ({
      categoryId: n.categoryId,
      name: n.categoryId === UNCATEGORISED_ID ? NOT_CLASSIFIED : n.name,
      icon: n.icon,
      colorToken: n.colorToken,
      displayMinor: Math.max(0, n.netMinor),
      backMinor: Math.max(0, -n.netMinor),
    }));
  rows.sort((a, b) => (a.backMinor > 0 ? 1 : 0) - (b.backMinor > 0 ? 1 : 0) || b.displayMinor - a.displayMinor || b.backMinor - a.backMinor || a.name.localeCompare(b.name));
  return { scope: scopeEcho(scope), rows };
}

export interface SpendingTotal {
  readonly scope: ScopeEcho;
  /** The exact refund-net total when it is zero or more; 0 when refunds are more than spending. */
  readonly spentMinor: number;
  /** The positive surplus when refunds are more than spending overall; 0 otherwise. */
  readonly backMinor: number;
}

const view = (net: number): { spentMinor: number; backMinor: number } => ({ spentMinor: Math.max(0, net), backMinor: Math.max(0, -net) });

/** The exact refund-net total: the sum of every category net, never floored per category (BDG-006). */
export async function spendingTotal(q: Querier, scope: InsightsScope): Promise<SpendingTotal> {
  const net = await spendingNet(q, { start: scope.period.start, end: scope.period.end }, await ledgerFilters(q, scope));
  return { scope: scopeEcho(scope), ...view(net) };
}

export interface IncomeTotal {
  readonly scope: ScopeEcho;
  readonly incomeMinor: number;
}

export async function incomeTotal(q: Querier, scope: InsightsScope): Promise<IncomeTotal> {
  return { scope: scopeEcho(scope), incomeMinor: await incomeNet(q, { start: scope.period.start, end: scope.period.end }, await ledgerFilters(q, scope)) };
}

/** Entries waiting for the user whose date falls in the scope: left out of every figure, and said so. */
export async function waitingInScope(q: Querier, scope: InsightsScope): Promise<number> {
  return waitingCount(q, { start: scope.period.start, end: scope.period.end });
}

/** How many confirmed entries the period holds: none means an empty-period prompt instead of zeros. */
export async function entriesInScope(q: Querier, scope: InsightsScope): Promise<number> {
  return entryCount(q, { start: scope.period.start, end: scope.period.end });
}

export type SpendingChange =
  | { readonly kind: 'no_baseline'; readonly scope: ScopeEcho }
  | { readonly kind: 'change'; readonly scope: ScopeEcho; readonly direction: 'up' | 'down' | 'same'; /** Whole percent, never negative. */ readonly percent: number; /** `Oct 1–8`. */ readonly baselineLabel: string };

/** Whole percent, rounded half away from zero. */
const roundHalfAway = (num: number, den: number): number => {
  const q = (Math.abs(num) * 2 + den) / (2 * den);
  return Math.floor(q) * Math.sign(num);
};

/** `(current − previous) ÷ |previous|` over the like-for-like windows; no baseline when the previous window is empty or before the profile began. */
export async function spendingChange(q: Querier, scope: InsightsScope, ctx: InsightsContext): Promise<SpendingChange> {
  const echo = scopeEcho(scope);
  const w = comparableWindow(scope.period, ctx.today, ctx.profile);
  if (w.previous.start < ctx.firstDay) return { kind: 'no_baseline', scope: echo };
  const f = await ledgerFilters(q, scope);
  const previous = await spendingNet(q, w.previous, f);
  if (previous === 0) return { kind: 'no_baseline', scope: echo };
  const current = await spendingNet(q, w.current, f);
  const pct = Math.abs(roundHalfAway((current - previous) * 100, Math.abs(previous)));
  const direction = current === previous || pct === 0 ? 'same' : current > previous ? 'up' : 'down';
  return { kind: 'change', scope: echo, direction, percent: pct, baselineLabel: w.label };
}

export type Kept =
  | { readonly kind: 'no_income'; readonly scope: ScopeEcho; readonly spentMinor: number }
  | { readonly kind: 'kept'; readonly scope: ScopeEcho; readonly incomeMinor: number; readonly spentMinor: number; /** 0 to 100. */ readonly keptPercent: number; readonly keptMinor: number }
  | { readonly kind: 'short'; readonly scope: ScopeEcho; readonly incomeMinor: number; readonly spentMinor: number; /** How much more went out than came in. */ readonly shortMinor: number };

/** `(income − spent) ÷ income`, with spent floored at zero so it never passes 100%; short when more went out than came in. */
export async function kept(q: Querier, scope: InsightsScope): Promise<Kept> {
  const echo = scopeEcho(scope);
  const f = await ledgerFilters(q, scope);
  const range = { start: scope.period.start, end: scope.period.end };
  const income = await incomeNet(q, range, f);
  const spent = Math.max(0, await spendingNet(q, range, f));
  if (income <= 0) return { kind: 'no_income', scope: echo, spentMinor: spent };
  if (spent > income) return { kind: 'short', scope: echo, incomeMinor: income, spentMinor: spent, shortMinor: spent - income };
  return { kind: 'kept', scope: echo, incomeMinor: income, spentMinor: spent, keptMinor: income - spent, keptPercent: roundHalfAway((income - spent) * 100, income) };
}
