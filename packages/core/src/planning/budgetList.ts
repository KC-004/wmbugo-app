import { toLocalDate } from '../shared/clock';
import { budgetPeriodFor, customPeriod, periodTitle, type Period, type PeriodProfile } from '../profile/period';
import { budgetFigures, budgetStatus, DEFAULT_NEARING_PERCENT, type BudgetDef, type BudgetStatus, type Querier } from './budgets';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, periodTarget, readPeriodProfile, TARGET_VERSIONS_SQL } from './budgetStore';
import { categoryIdsUnder, needsWantsSavings } from './needsWantsSavings';

export type BudgetGroup = 'overall' | '50_30_20' | 'categories';

/** One row of the budget list (SCR-14): everything the limit bar and its status line say, counted from the entries. */
export interface BudgetListRow {
  readonly id: string;
  readonly name: string;
  readonly group: BudgetGroup;
  readonly scope: BudgetDef['scope'];
  /** Needs or Wants for a type budget (Story 4.11); null otherwise. */
  readonly budgetType: 'need' | 'want' | null;
  readonly period: Period;
  /** `1–30 Nov`, `Weekly · 2–8 Nov`, `Custom · 1–15 Nov`. */
  readonly periodLabel: string;
  readonly usedMinor: number;
  readonly targetMinor: number;
  readonly refundSurplusMinor: number;
  /** Savings budgets: the net moved into savings pots, exact; a net withdrawal reads `More moved out than in this period`. */
  readonly savingsMovedMinor?: number;
  readonly status: BudgetStatus;
  /** A category budget next to an overall one: `Also counted in your overall budget`. */
  readonly overlapsOverall: boolean;
}

export interface BudgetList {
  readonly today: string;
  readonly rows: readonly BudgetListRow[];
  /** The id of the overall budget, if there is one (the editor offers `Edit it`). */
  readonly overallId: string | null;
  /** With a 50/30/20 template: spending in no type this period, and what to open in Activity to sort it (Story 4.11). */
  readonly typeSummary: { readonly notClassifiedMinor: number; readonly categoryIds: readonly string[]; readonly period: { readonly start: string; readonly end: string } } | null;
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
  return budgetListAt(q, read.profile, today.value, today.value);
}

/**
 * The budget list as of an anchor date: each budget in the period it has then. `selected` is a default period the caller picked
 * (a past pay cycle, say): budgets that follow the default period use it, the others keep their own period around the anchor.
 * `today` is the real today, for the status line.
 */
export async function budgetListAt(q: Querier, profile: PeriodProfile, today: string, anchor: string, selected?: Period): Promise<BudgetList> {
  const budgets = mapBudgets(await q.query(BUDGETS_SQL));
  const overall = budgets.find((b) => b.scope === 'overall') ?? null;
  const rows: BudgetListRow[] = [];
  for (const b of budgets) {
    if (b.endedAfter && anchor > b.endedAfter) continue;
    const period = (selected && b.period.rule === 'default' ? selected : budgetPeriodFor(b.period, anchor, profile)) ?? (b.period.rule === 'custom' && b.period.customStart && b.period.customEnd ? customPeriod(b.period.customStart, b.period.customEnd) : null);
    if (!period) continue;
    const versions = mapTargetVersions(await q.query(TARGET_VERSIONS_SQL, [b.id]));
    const target = periodTarget(b, versions, period) ?? versions[0]?.targetMinor ?? 0;
    const figures = await budgetFigures(q, b, period);
    const status = budgetStatus({ usedMinor: figures.usedMinor, targetMinor: target, period, today, nearingPercent: b.alertThresholds?.[0] ?? DEFAULT_NEARING_PERCENT });
    const group: BudgetGroup = b.scope === 'overall' ? 'overall' : b.template === '50_30_20' ? '50_30_20' : 'categories';
    rows.push({
      id: b.id,
      name: b.name ?? '',
      group,
      scope: b.scope,
      budgetType: b.budgetType,
      period,
      periodLabel: labelFor(b.period.rule, period),
      usedMinor: figures.usedMinor,
      targetMinor: target,
      refundSurplusMinor: figures.refundSurplusMinor,
      ...(figures.savingsMovedMinor !== undefined ? { savingsMovedMinor: figures.savingsMovedMinor } : {}),
      status,
      overlapsOverall: overall !== null && b.scope !== 'overall' && group === 'categories',
    });
  }
  const order: Record<BudgetGroup, number> = { overall: 0, '50_30_20': 1, categories: 2 };
  rows.sort((a, b) => order[a.group] - order[b.group]);
  let typeSummary: BudgetList['typeSummary'] = null;
  const templateRow = rows.find((r) => r.group === '50_30_20');
  if (templateRow) {
    const nw = await needsWantsSavings(q, templateRow.period);
    typeSummary = { notClassifiedMinor: nw.notClassifiedMinor, categoryIds: await categoryIdsUnder(q, nw.notClassified.map((x) => x.categoryId)), period: { start: templateRow.period.start, end: templateRow.period.end } };
  }
  return { today, rows, overallId: overall?.id ?? null, typeSummary };
}
