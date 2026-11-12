import type { SqlParam } from '../ports/storage';
import { budgetPeriodFor, daysBetween, previousPeriod, type BudgetPeriodRule, type Period, type PeriodProfile } from '../profile/period';

/**
 * Budgets are lasting rules measured over a period (Story 4.5, BDG-001/003/005/006). Nothing here stores a running total:
 * every figure is counted from the recorded entries, so a new period starts at zero with no rollover and nothing is ever
 * reset. Period boundaries come from the profile period service only (`profile/period.ts`).
 */

export type BudgetScope = 'overall' | 'category' | 'budget_type' | 'savings';

export interface BudgetDef {
  readonly id: string;
  /** What the list shows; absent in tests that only count. */
  readonly name?: string;
  /** `fifty_thirty_twenty` for the one-tap split (Story 4.10). */
  readonly template?: string | null;
  /** The end date of the last period this budget runs (its only category was archived or merged). */
  readonly endedAfter?: string | null;
  readonly scope: BudgetScope;
  /** Top-level category ids (scope `category`); a subcategory rolls into its parent. */
  readonly categoryIds: readonly string[];
  readonly budgetType: 'need' | 'want' | null;
  /** Only entries posted on these accounts count; null means every account. */
  readonly accountIds: readonly string[] | null;
  readonly period: BudgetPeriodRule;
  /** Alert thresholds in percent, lowest first; empty means the default (75, 100). */
  readonly alertThresholds?: readonly number[];
}

export const DEFAULT_NEARING_PERCENT = 75;

/** What a read needs: both the database and a writer context have it. */
export interface Querier {
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/**
 * Net spending per top-level category in a period: confirmed, live expense splits minus refund splits (linked or
 * categorised, FIN-028), by the entry's own date. Needs-review, excluded, reversed and removed entries, transfers and card
 * payments are not expense or refund entries, so they never count.
 */
export function budgetScopeClause(budget: BudgetDef): { where: string[]; params: (string | number)[] } {
  const where: string[] = [
    "t.event_type IN ('expense','refund')",
    "t.status = 'confirmed'",
    't.removed_at IS NULL',
    't.local_date BETWEEN ? AND ?',
  ];
  const params: (string | number)[] = [];
  if (budget.scope === 'category') {
    const n = budget.categoryIds.length;
    where.push(`(c.id IN (${marks(n)}) OR c.parent_id IN (${marks(n)}))`);
    params.push(...budget.categoryIds, ...budget.categoryIds);
  } else if (budget.scope === 'budget_type') {
    // The type is read from the category (a subcategory follows its parent) at query time, so changing it re-buckets every period.
    where.push(`(CASE WHEN c.parent_id IS NULL THEN c.budget_type ELSE pc.budget_type END) = ?`);
    params.push(budget.budgetType ?? '');
  }
  if (budget.accountIds !== null) {
    where.push(`EXISTS (SELECT 1 FROM posting p WHERE p.transaction_id = t.id AND p.account_id IN (${marks(budget.accountIds.length)}))`);
    params.push(...budget.accountIds);
  }
  return { where, params };
}

export function budgetNetSql(budget: BudgetDef): { sql: string; params: (string | number)[] } {
  const { where, params } = budgetScopeClause(budget);
  const sql =
    "SELECT COALESCE(c.parent_id, c.id), SUM(CASE WHEN t.event_type = 'expense' THEN s.amount_minor ELSE -s.amount_minor END) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id LEFT JOIN category pc ON pc.id = c.parent_id WHERE " +
    where.join(' AND ') +
    ' GROUP BY COALESCE(c.parent_id, c.id)';
  return { sql, params };
}

export interface CategoryNet {
  readonly categoryId: string;
  /** Expenses minus refunds; negative when refunds in the period exceed spending in it. */
  readonly netMinor: number;
}

export async function budgetNets(q: Querier, budget: BudgetDef, period: { readonly start: string; readonly end: string }): Promise<CategoryNet[]> {
  // A savings budget measures money moved into savings goals, which arrives with Story 4.11; until then it counts no spending.
  if (budget.scope === 'savings') return [];
  if (budget.scope === 'category' && budget.categoryIds.length === 0) return [];
  const { sql, params } = budgetNetSql(budget);
  const rows = await q.query(sql, [period.start, period.end, ...params]);
  return rows.map((r) => ({ categoryId: String(r[0]), netMinor: Number(r[1]) }));
}

export interface BudgetFigures {
  /** Each top-level category floored at zero first, then summed (BDG-006): a refund never inflates what is left. */
  readonly usedMinor: number;
  /** What refunds in the period returned beyond what was spent in the period, shown as `Refunds this period: +₹X`. */
  readonly refundSurplusMinor: number;
}

export function figuresFromNets(nets: readonly CategoryNet[]): BudgetFigures {
  let used = 0;
  let surplus = 0;
  for (const n of nets) {
    if (n.netMinor > 0) used += n.netMinor;
    else surplus += -n.netMinor;
  }
  return { usedMinor: used, refundSurplusMinor: surplus };
}

/** `budgetUsed` and `refundSurplus` for one budget over one period. */
export async function budgetFigures(q: Querier, budget: BudgetDef, period: { readonly start: string; readonly end: string }): Promise<BudgetFigures> {
  return figuresFromNets(await budgetNets(q, budget, period));
}

export const budgetUsed = async (q: Querier, budget: BudgetDef, period: Period): Promise<number> => (await budgetFigures(q, budget, period)).usedMinor;
export const refundSurplus = async (q: Querier, budget: BudgetDef, period: Period): Promise<number> => (await budgetFigures(q, budget, period)).refundSurplusMinor;

// ---- Status -------------------------------------------------------------------------------------------------------

export type BudgetStatusKind = 'insufficient-data' | 'on-track' | 'nearing' | 'exceeded';

export interface BudgetStatus {
  readonly usedMinor: number;
  readonly targetMinor: number;
  /** Target minus used. It can go below zero here; the screen shows it only as `Over by ₹X`. */
  readonly remainingMinor: number;
  /** Whole percent of the target used (100 when there is a zero target and anything was spent). */
  readonly percentUsed: number;
  /** Days left including today; 0 once the period has ended. */
  readonly daysRemaining: number;
  /** used ÷ days elapsed × days in period, an estimate; null before 3 days have passed and after the period ends. */
  readonly projectedMinor: number | null;
  readonly status: BudgetStatusKind;
}

export const MIN_DAYS_FOR_PROJECTION = 3;

export interface StatusInput {
  readonly usedMinor: number;
  readonly targetMinor: number;
  readonly period: { readonly start: string; readonly end: string };
  readonly today: string;
  /** The budget's lowest alert threshold in percent (default 75). */
  readonly nearingPercent?: number;
}

/**
 * Where a budget stands today. `exceeded` is reported whatever the day count, so overspending is never hidden behind
 * `insufficient-data`. A zero target is exceeded by any spending and otherwise on track.
 */
export function budgetStatus(input: StatusInput): BudgetStatus {
  const { usedMinor: used, targetMinor: target, period, today } = input;
  const total = daysBetween(period.start, period.end) + 1;
  const ended = today > period.end;
  const elapsed = today < period.start ? 0 : Math.min(daysBetween(period.start, today) + 1, total);
  const daysRemaining = ended ? 0 : today < period.start ? total : daysBetween(today, period.end) + 1;
  const insufficient = !ended && elapsed < MIN_DAYS_FOR_PROJECTION;
  const projected = ended || insufficient || elapsed === 0 ? null : Math.round((used * total) / elapsed);
  const nearingAt = input.nearingPercent ?? DEFAULT_NEARING_PERCENT;

  let status: BudgetStatusKind;
  if (used > target) status = 'exceeded';
  else if (insufficient) status = 'insufficient-data';
  else if (target > 0 && (used * 100 >= target * nearingAt || (projected !== null && projected > target))) status = 'nearing';
  else status = 'on-track';

  return {
    usedMinor: used,
    targetMinor: target,
    remainingMinor: target - used,
    percentUsed: target === 0 ? (used > 0 ? 100 : 0) : Math.round((used * 100) / target),
    daysRemaining,
    projectedMinor: projected,
    status,
  };
}

// ---- Target versions ----------------------------------------------------------------------------------------------

export interface TargetVersion {
  readonly version: number;
  readonly targetMinor: number;
  /** Start date of the first period this target applies to. */
  readonly effectiveFrom: string;
}

/** The target a period had: the latest version in force from that period's start. A period before the first version has none. */
export function targetForPeriod(versions: readonly TargetVersion[], periodStart: string): number | null {
  let best: TargetVersion | null = null;
  for (const v of versions) if (v.effectiveFrom <= periodStart && (best === null || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.version > best.version))) best = v;
  return best === null ? null : best.targetMinor;
}

// ---- Periods ------------------------------------------------------------------------------------------------------

/** The current period of a budget, or null when a custom range is not running today. */
export const currentPeriod = (budget: BudgetDef, today: string, profile: PeriodProfile): Period | null => budgetPeriodFor(budget.period, today, profile);

/** The most periods a rebuild caches behind the current one (three years of months). */
export const MAX_CACHED_PERIODS = 36;

/**
 * The periods to cache for a budget: the current one and the earlier ones back to the period that holds its first target.
 * Every period comes from the period service; a custom range is its single range.
 */
export function periodsToCache(budget: BudgetDef, firstEffective: string, today: string, profile: PeriodProfile): Period[] {
  if (budget.period.rule === 'custom') {
    const p = budgetPeriodFor(budget.period, budget.period.customStart ?? today, profile);
    return p ? [p] : [];
  }
  const current = budgetPeriodFor(budget.period, today, profile);
  if (!current) return [];
  const out: Period[] = [current];
  let p: Period | null = current;
  while (out.length < MAX_CACHED_PERIODS && p !== null && p.start > firstEffective) {
    p = previousPeriod(p, profile);
    if (p) out.push(p);
  }
  return out;
}
