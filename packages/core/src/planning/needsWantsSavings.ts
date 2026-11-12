import { toLocalDate } from '../shared/clock';
import { SAVINGS_MOVED_IN_SQL, savedDisplay } from '../ledger/savings';
import { budgetPeriodFor } from '../profile/period';
import { budgetFigures, budgetScopeClause, type BudgetDef, type Querier } from './budgets';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, periodTarget, readPeriodProfile, TARGET_VERSIONS_SQL } from './budgetStore';
import { TEMPLATE_503020 } from './budgetTemplate';

/**
 * Needs, Wants and Savings (Story 4.11, BDG-009, CAT-006). Needs and Wants are the confirmed spending of categories of that
 * type, refund-net and floored at zero per top-level category first (BDG-006); Not classified is everything else
 * (Uncategorised, Not itemised splits and categories with no type); Savings is the money moved into savings pots. A type is
 * read from the category now, so changing it moves its spending for every period without touching an amount.
 */

export interface TypeRow {
  readonly categoryId: string;
  readonly name: string;
  readonly amountMinor: number;
}

export interface NeedsWantsSavings {
  readonly needsMinor: number;
  readonly wantsMinor: number;
  readonly notClassifiedMinor: number;
  /** Net money moved into savings pots in the period; exact, so it can be below zero. */
  readonly savingsMovedMinor: number;
  /** What a screen shows for Savings: never below zero. */
  readonly savingsMinor: number;
  readonly needs: readonly TypeRow[];
  readonly wants: readonly TypeRow[];
  readonly notClassified: readonly TypeRow[];
}

const TYPED_NETS_SQL =
  "SELECT COALESCE(c.parent_id, c.id), (CASE WHEN c.parent_id IS NULL THEN c.budget_type ELSE pc.budget_type END), MAX(CASE WHEN c.parent_id IS NULL THEN c.name ELSE pc.name END), SUM(CASE WHEN t.event_type = 'expense' THEN s.amount_minor ELSE -s.amount_minor END) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id LEFT JOIN category pc ON pc.id = c.parent_id WHERE ";

export async function needsWantsSavings(q: Querier, period: { readonly start: string; readonly end: string }): Promise<NeedsWantsSavings> {
  const overall: BudgetDef = { id: '', scope: 'overall', categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' } };
  const { where, params } = budgetScopeClause(overall);
  const rows = await q.query(`${TYPED_NETS_SQL}${where.join(' AND ')} GROUP BY 1, 2`, [period.start, period.end, ...params]);
  const groups: Record<'need' | 'want' | 'none', TypeRow[]> = { need: [], want: [], none: [] };
  for (const r of rows) {
    const net = Number(r[3]);
    if (net <= 0) continue; // floored at zero per category: a refund never lowers another category
    const type = r[1] === 'need' ? 'need' : r[1] === 'want' ? 'want' : 'none';
    groups[type].push({ categoryId: String(r[0]), name: String(r[2] ?? ''), amountMinor: net });
  }
  const sort = (l: TypeRow[]) => l.sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
  const sum = (l: readonly TypeRow[]) => l.reduce((s, x) => s + x.amountMinor, 0);
  const moved = Number((await q.query(SAVINGS_MOVED_IN_SQL, [period.start, period.end]))[0]?.[0] ?? 0);
  return {
    needsMinor: sum(groups.need),
    wantsMinor: sum(groups.want),
    notClassifiedMinor: sum(groups.none),
    savingsMovedMinor: moved,
    savingsMinor: savedDisplay(moved),
    needs: sort(groups.need),
    wants: sort(groups.want),
    notClassified: sort(groups.none),
  };
}

/** The category ids (top level and subcategories) behind a set of top-level ids, for an Activity filter. */
export async function categoryIdsUnder(q: Querier, topIds: readonly string[]): Promise<string[]> {
  if (topIds.length === 0) return [];
  const marks = topIds.map(() => '?').join(',');
  return (await q.query(`SELECT id FROM category WHERE id IN (${marks}) OR parent_id IN (${marks})`, [...topIds, ...topIds])).map((r) => String(r[0]));
}

export type LeftInBudget =
  | { readonly kind: 'overall'; readonly targetMinor: number; readonly usedMinor: number; readonly leftMinor: number; readonly refundSurplusMinor: number }
  | { readonly kind: 'types'; readonly targetMinor: number; readonly usedMinor: number; readonly leftMinor: number; readonly notClassifiedMinor: number }
  | { readonly kind: 'none' };

/**
 * What is left to spend this period, for Home and Free to use. With an overall budget: its target minus its used figure,
 * with the refund surplus apart. With only the 50/30/20 targets: (Needs + Wants targets) minus (Needs + Wants + Not
 * classified spending), with the Not classified part named. With neither: `none`, and the caller shows `Spent this period`.
 * `leftMinor` can be below zero; screens show it as `Over by`.
 */
export async function leftInBudget(q: Querier, nowMs: number): Promise<LeftInBudget> {
  const read = await readPeriodProfile(q);
  if (!read) return { kind: 'none' };
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return { kind: 'none' };
  const budgets = mapBudgets(await q.query(BUDGETS_SQL));
  const periodOf = (b: BudgetDef) => budgetPeriodFor(b.period, today.value, read.profile);
  const targetOf = async (b: BudgetDef, period: NonNullable<ReturnType<typeof periodOf>>) => periodTarget(b, mapTargetVersions(await q.query(TARGET_VERSIONS_SQL, [b.id])), period) ?? 0;

  const overall = budgets.find((b) => b.scope === 'overall' && !(b.endedAfter && today.value > b.endedAfter));
  const op = overall ? periodOf(overall) : null;
  if (overall && op) {
    const f = await budgetFigures(q, overall, op);
    const target = await targetOf(overall, op);
    return { kind: 'overall', targetMinor: target, usedMinor: f.usedMinor, leftMinor: target - f.usedMinor, refundSurplusMinor: f.refundSurplusMinor };
  }
  const needs = budgets.find((b) => b.template === TEMPLATE_503020 && b.scope === 'budget_type' && b.budgetType === 'need');
  const wants = budgets.find((b) => b.template === TEMPLATE_503020 && b.scope === 'budget_type' && b.budgetType === 'want');
  const np = needs ? periodOf(needs) : null;
  if (needs && wants && np) {
    const target = (await targetOf(needs, np)) + (await targetOf(wants, np));
    const t = await needsWantsSavings(q, np);
    const used = t.needsMinor + t.wantsMinor + t.notClassifiedMinor;
    return { kind: 'types', targetMinor: target, usedMinor: used, leftMinor: target - used, notClassifiedMinor: t.notClassifiedMinor };
  }
  return { kind: 'none' };
}
