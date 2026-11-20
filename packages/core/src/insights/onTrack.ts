import { budgetListAt, type BudgetListRow } from '../planning/budgetList';
import type { Querier } from '../planning/budgets';
import { loadGoals, type GoalRow } from '../planning/goals';
import { categoryIdsUnder, needsWantsSavings, type NeedsWantsSavings } from '../planning/needsWantsSavings';
import { periodFor, type Period } from '../profile/period';
import { scopeEcho, type InsightsContext, type InsightsScope, type ScopeEcho } from './scope';

/**
 * `Am I on track?` (Story 7.7, INS-013, INS-020, INS-025): the budgets, the Needs / Wants / Savings split and the goals for the
 * period being looked at. Composed only from the planning owners' queries (`budgetListAt`, `needsWantsSavings`, `loadGoals`), so
 * a figure here is the figure the Plan and Home screens show for the same period. Budgets keep their own categories and
 * accounts: an Insights filter never makes a partial budget look like the whole one. Goals are not period- or filter-scoped.
 */

/** True when the selected period is exactly a budget period of the profile (the default period, or a past one). */
export function isBudgetPeriod(scope: InsightsScope, ctx: InsightsContext): boolean {
  const def = periodFor(scope.period.start, ctx.profile.rule);
  return def.start === scope.period.start && def.end === scope.period.end;
}

export interface NwsView {
  /** The amounts spent in each type, whatever the targets are. */
  readonly amounts: Pick<NeedsWantsSavings, 'needsMinor' | 'wantsMinor' | 'savingsMinor' | 'notClassifiedMinor'>;
  /** The 50/30/20 (or custom) target rows; empty without targets. */
  readonly needs: BudgetListRow | null;
  readonly wants: BudgetListRow | null;
  readonly savings: BudgetListRow | null;
  /** What to open in Activity for `Sort it`. */
  readonly notClassifiedCategoryIds: readonly string[];
  readonly period: { readonly start: string; readonly end: string };
}

export interface OnTrack {
  readonly scope: ScopeEcho;
  /** Why the budget cards are absent, or null when they are shown. */
  readonly budgetsState: 'ok' | 'not_budget_period';
  /** The overall budget first, then category budgets by percent used, highest first (the 50/30/20 rows live in `nws`). */
  readonly budgets: readonly BudgetListRow[];
  readonly nws: NwsView | null;
  /** Active and paused goals. */
  readonly goals: readonly GoalRow[];
}

export async function onTrack(q: Querier, scope: InsightsScope, ctx: InsightsContext, nowMs: number): Promise<OnTrack> {
  const goals = (await loadGoals(q, nowMs)).filter((g) => g.state === 'active' || g.state === 'paused');
  if (!isBudgetPeriod(scope, ctx)) return { scope: scopeEcho(scope), budgetsState: 'not_budget_period', budgets: [], nws: null, goals };

  const selected: Period = periodFor(scope.period.start, ctx.profile.rule);
  const list = await budgetListAt(q, ctx.profile, ctx.today, scope.period.end, selected);
  const overall = list.rows.filter((r) => r.group === 'overall');
  const categories = list.rows.filter((r) => r.group === 'categories').sort((a, b) => b.status.percentUsed - a.status.percentUsed || a.name.localeCompare(b.name));
  const templateRows = list.rows.filter((r) => r.group === '50_30_20');
  // The amounts are always known; the targets only when a 50/30/20 split exists.
  const period = templateRows[0]?.period ?? selected;
  const split = await needsWantsSavings(q, period);
  const nws: NwsView = {
    amounts: { needsMinor: split.needsMinor, wantsMinor: split.wantsMinor, savingsMinor: split.savingsMinor, notClassifiedMinor: split.notClassifiedMinor },
    needs: templateRows.find((r) => r.budgetType === 'need') ?? null,
    wants: templateRows.find((r) => r.budgetType === 'want') ?? null,
    savings: templateRows.find((r) => r.scope === 'savings') ?? null,
    notClassifiedCategoryIds: await categoryIdsUnder(q, split.notClassified.map((x) => x.categoryId)),
    period: { start: period.start, end: period.end },
  };
  return { scope: scopeEcho(scope), budgetsState: 'ok', budgets: [...overall, ...categories], nws, goals };
}
