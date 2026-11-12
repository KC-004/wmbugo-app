import { toLocalDate } from '../shared/clock';
import { budgetPeriodFor, customPeriod, periodTitle, type Period } from '../profile/period';
import { budgetFigures, budgetStatus, DEFAULT_NEARING_PERCENT, type BudgetDef, type BudgetStatus, type Querier } from './budgets';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, periodTarget, readPeriodProfile, TARGET_VERSIONS_SQL } from './budgetStore';

export type BudgetGroup = 'overall' | 'fifty_thirty_twenty' | 'categories';

/** One row of the budget list (SCR-14): everything the limit bar and its status line say, counted from the entries. */
export interface BudgetListRow {
  readonly id: string;
  readonly name: string;
  readonly group: BudgetGroup;
  readonly scope: BudgetDef['scope'];
  readonly period: Period;
  /** `1–30 Nov`, `Weekly · 2–8 Nov`, `Custom · 1–15 Nov`. */
  readonly periodLabel: string;
  readonly usedMinor: number;
  readonly targetMinor: number;
  readonly refundSurplusMinor: number;
  readonly status: BudgetStatus;
  /** A category budget next to an overall one: `Also counted in your overall budget`. */
  readonly overlapsOverall: boolean;
}

export interface BudgetList {
  readonly today: string;
  readonly rows: readonly BudgetListRow[];
  /** The id of the overall budget, if there is one (the editor offers `Edit it`). */
  readonly overallId: string | null;
}

const labelFor = (rule: BudgetDef['period']['rule'], p: Period): string => {
  const range = periodTitle(p);
  return rule === 'weekly' ? `Weekly · ${range}` : rule === 'custom' ? `Custom · ${range}` : range;
};

/**
 * Every active budget with its figures for the period it is in today. A budget whose only category was archived or merged
 * (`endedAfter`) drops out of the list once its last period is over. Figures are counted from the entries, never stored.
 */
export async function loadBudgetList(q: Querier, nowMs: number): Promise<BudgetList | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const budgets = mapBudgets(await q.query(BUDGETS_SQL));
  const overall = budgets.find((b) => b.scope === 'overall') ?? null;
  const rows: BudgetListRow[] = [];
  for (const b of budgets) {
    if (b.endedAfter && today.value > b.endedAfter) continue;
    const period = budgetPeriodFor(b.period, today.value, read.profile) ?? (b.period.rule === 'custom' && b.period.customStart && b.period.customEnd ? customPeriod(b.period.customStart, b.period.customEnd) : null);
    if (!period) continue;
    const versions = mapTargetVersions(await q.query(TARGET_VERSIONS_SQL, [b.id]));
    const target = periodTarget(b, versions, period) ?? versions[0]?.targetMinor ?? 0;
    const figures = await budgetFigures(q, b, period);
    const status = budgetStatus({ usedMinor: figures.usedMinor, targetMinor: target, period, today: today.value, nearingPercent: b.alertThresholds?.[0] ?? DEFAULT_NEARING_PERCENT });
    const group: BudgetGroup = b.scope === 'overall' ? 'overall' : b.template === 'fifty_thirty_twenty' ? 'fifty_thirty_twenty' : 'categories';
    rows.push({
      id: b.id,
      name: b.name ?? '',
      group,
      scope: b.scope,
      period,
      periodLabel: labelFor(b.period.rule, period),
      usedMinor: figures.usedMinor,
      targetMinor: target,
      refundSurplusMinor: figures.refundSurplusMinor,
      status,
      overlapsOverall: overall !== null && b.scope !== 'overall' && group === 'categories',
    });
  }
  const order: Record<BudgetGroup, number> = { overall: 0, fifty_thirty_twenty: 1, categories: 2 };
  rows.sort((a, b) => order[a.group] - order[b.group]);
  return { today: today.value, rows, overallId: overall?.id ?? null };
}
