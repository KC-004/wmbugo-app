import { toLocalDate } from '../shared/clock';
import { budgetPeriodFor, customPeriod, dayMonthLabel, periodTitle, previousPeriod, type Period } from '../profile/period';
import { budgetNets, budgetScopeClause, budgetStatus, DEFAULT_NEARING_PERCENT, figuresFromNets, type BudgetDef, type BudgetStatus, type Querier } from './budgets';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, periodTarget, readPeriodProfile, TARGET_VERSIONS_SQL } from './budgetStore';

/** One entry that makes up a budget in a period: what its in-scope splits add up to, a refund as money back. */
export interface BudgetEntry {
  readonly id: string;
  readonly kind: 'expense' | 'refund';
  /** Only the splits that are in this budget's scope (a split entry can be partly outside it). */
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly accountName: string | null;
}

/** One top-level category of an overall budget, floored at zero: the shares add up to the used figure exactly. */
export interface CategoryShare {
  readonly categoryId: string;
  readonly name: string;
  readonly amountMinor: number;
}

export interface BudgetDetail {
  readonly id: string;
  readonly name: string;
  readonly scope: BudgetDef['scope'];
  readonly period: Period;
  /** `1–30 Nov`. */
  readonly periodLabel: string;
  /** The period is the one running today (the switcher cannot go forward from it). */
  readonly isCurrent: boolean;
  /** How many periods before the current one this is (0 for the current period). */
  readonly back: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** `Oct`-style neighbours for the switcher, as the period start dates. */
  readonly previousStart: string | null;
  /** The start of the period after this one, for `Dec ›` (null on the current period). */
  readonly nextStart: string | null;
  readonly usedMinor: number;
  /** The target version this period had. */
  readonly targetMinor: number;
  readonly refundSurplusMinor: number;
  readonly status: BudgetStatus;
  /** An overall budget lists each category's floored amount above the entries. */
  readonly breakdown: readonly CategoryShare[] | null;
  readonly entries: readonly BudgetEntry[];
  readonly today: string;
}

/** The most entries the detail lists (the newest first). */
export const DETAIL_ENTRY_LIMIT = 200;

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/**
 * Budget detail for the current period (`back` = 0) or an earlier one (`back` = 1 is the period before). Every figure is
 * derived from the entries' own dates and the target version that period had, so an earlier period always shows what it
 * showed then (BDG-005). Returns 'missing' when the budget was deleted, null when there is no profile.
 */
export async function loadBudgetDetail(q: Querier, budgetId: string, backOrStart: number | string, nowMs: number): Promise<BudgetDetail | 'missing' | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const budget = mapBudgets(await q.query(BUDGETS_SQL)).find((b) => b.id === budgetId);
  if (!budget) return 'missing';
  const versions = mapTargetVersions(await q.query(TARGET_VERSIONS_SQL, [budgetId]));
  const firstEffective = versions.length > 0 ? versions.reduce((m, v) => (v.effectiveFrom < m ? v.effectiveFrom : m), versions[0]!.effectiveFrom) : today.value;

  let period: Period | null = budgetPeriodFor(budget.period, today.value, read.profile) ?? (budget.period.rule === 'custom' && budget.period.customStart && budget.period.customEnd ? customPeriod(budget.period.customStart, budget.period.customEnd) : null);
  const running = period;
  const chain: Period[] = period ? [period] : [];
  // A period start (a tapped notification) finds how many periods back it is; a number is that many periods back.
  const wanted = typeof backOrStart === 'string' ? backOrStart : null;
  const steps = typeof backOrStart === 'number' ? backOrStart : 0;
  let back = 0;
  while (period && (wanted !== null ? period.start !== wanted : back < steps)) {
    if (wanted !== null && period.start < wanted) return 'missing';
    period = previousPeriod(period, read.profile);
    back += 1;
    if (period) chain.push(period);
    if (back > 60) return 'missing';
  }
  if (!period || !running) return 'missing';
  // A period from before the budget's first target is not one of its periods.
  if (wanted !== null && period.end < firstEffective) return 'missing';

  const before = previousPeriod(period, read.profile);
  const target = periodTarget(budget, versions, period) ?? versions[0]?.targetMinor ?? 0;
  const nets = await budgetNets(q, budget, period);
  const figures = figuresFromNets(nets);
  const status = budgetStatus({ usedMinor: figures.usedMinor, targetMinor: target, period, today: today.value, nearingPercent: budget.alertThresholds?.[0] ?? DEFAULT_NEARING_PERCENT });

  let breakdown: CategoryShare[] | null = null;
  if (budget.scope === 'overall') {
    const names = new Map<string, string>();
    for (const n of nets) {
      const r = (await q.query('SELECT name FROM category WHERE id = ?', [n.categoryId]))[0];
      names.set(n.categoryId, r ? String(r[0]) : '');
    }
    breakdown = nets
      .filter((n) => n.netMinor > 0)
      .map((n) => ({ categoryId: n.categoryId, name: names.get(n.categoryId) ?? '', amountMinor: n.netMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
  }

  let entries: BudgetEntry[] = [];
  if (budget.scope !== 'savings' && !(budget.scope === 'category' && budget.categoryIds.length === 0)) {
    const { where, params } = budgetScopeClause(budget);
    const rows = await q.query(
      "SELECT t.id, t.event_type, SUM(s.amount_minor), t.local_date, t.original_description, MAX(c.name), MAX(c.icon), MAX(c.color_token), (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.posting_kind = 'normal' ORDER BY p.signed_amount_minor LIMIT 1) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id LEFT JOIN category pc ON pc.id = c.parent_id WHERE " +
        where.join(' AND ') +
        ` GROUP BY t.id ORDER BY t.local_date DESC, t.id DESC LIMIT ${DETAIL_ENTRY_LIMIT}`,
      [period.start, period.end, ...params],
    );
    entries = rows.map((r) => ({ id: String(r[0]), kind: String(r[1]) === 'refund' ? ('refund' as const) : ('expense' as const), amountMinor: Number(r[2]), localDate: String(r[3]), merchant: s(r[4]), categoryName: s(r[5]), categoryIcon: s(r[6]), categoryColor: s(r[7]), accountName: s(r[8]) }));
  }

  return {
    id: budget.id,
    name: budget.name ?? '',
    scope: budget.scope,
    period,
    periodLabel: periodTitle(period),
    isCurrent: back === 0,
    back,
    canGoBack: before !== null && before.end >= firstEffective,
    canGoForward: back > 0,
    previousStart: before?.start ?? null,
    nextStart: back > 0 ? (chain[back - 1]?.start ?? null) : null,
    usedMinor: figures.usedMinor,
    targetMinor: target,
    refundSurplusMinor: figures.refundSurplusMinor,
    status,
    breakdown,
    entries,
    today: today.value,
  };
}

/** `Oct`, `Dec`: the short month name for a switcher button. */
export function monthName(date: string): string {
  return dayMonthLabel(date).split(' ')[1] ?? '';
}
