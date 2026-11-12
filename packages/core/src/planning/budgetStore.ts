import { err, ok } from '../shared/result';
import { toLocalDate } from '../shared/clock';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { budgetPeriodFor, periodDays, prorateTarget, type Period } from '../profile/period';
import { readPaydayRule } from '../profile/paydayChange';
import { SETTINGS_SQL, parseSettings, periodRule } from '../profile/settings';
import type { PeriodProfile } from '../profile/period';
import { periodsToCache, targetForPeriod, type BudgetDef, type Querier, type TargetVersion } from './budgets';

/** Active budgets (not removed), oldest first. Columns are read by `mapBudgets`. */
export const BUDGETS_SQL =
  'SELECT id, scope, scope_category_ids, scope_budget_type, account_ids, period_rule, custom_start, custom_end, alert_rule, name, template, ended_after FROM budget WHERE removed_at IS NULL ORDER BY created_at, id';

const jsonArray = (v: unknown): string[] => {
  try {
    const a: unknown = JSON.parse(String(v));
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const thresholds = (v: unknown): number[] | undefined => {
  if (v === null || v === undefined) return undefined;
  try {
    const a: unknown = JSON.parse(String(v));
    const list = Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number' && x > 0).sort((x, y) => x - y) : [];
    return list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
};

export function mapBudgets(rows: readonly (readonly unknown[])[]): BudgetDef[] {
  return rows.map((r) => {
    const alert = thresholds(r[8]);
    return {
      id: String(r[0]),
      name: String(r[9] ?? ''),
      template: r[10] === null || r[10] === undefined ? null : String(r[10]),
      endedAfter: r[11] === null || r[11] === undefined ? null : String(r[11]),
      scope: String(r[1]) as BudgetDef['scope'],
      categoryIds: jsonArray(r[2]),
      budgetType: r[3] === null || r[3] === undefined ? null : (String(r[3]) as 'need' | 'want'),
      accountIds: r[4] === null || r[4] === undefined ? null : jsonArray(r[4]),
      period: { rule: String(r[5]) as 'default' | 'monthly' | 'weekly' | 'custom', customStart: r[6] === null ? null : String(r[6]), customEnd: r[7] === null ? null : String(r[7]) },
      ...(alert ? { alertThresholds: alert } : {}),
    };
  });
}

/** The target versions of a budget, oldest first. Param: budget id. */
export const TARGET_VERSIONS_SQL = 'SELECT version, target_minor, effective_from FROM budget_target_version WHERE budget_id = ? ORDER BY version';

export const mapTargetVersions = (rows: readonly (readonly unknown[])[]): TargetVersion[] =>
  rows.map((r) => ({ version: Number(r[0]), targetMinor: Number(r[1]), effectiveFrom: String(r[2]) }));

/** What the period service needs, read the same way everywhere: payday rule, period mode and first day of the week. */
export async function readPeriodProfile(q: Querier): Promise<{ profile: PeriodProfile; timezoneId: string } | null> {
  const read = await readPaydayRule(q);
  if (!read) return null;
  const settings = parseSettings(await q.query(SETTINGS_SQL));
  return { profile: { rule: periodRule(read.rule, settings.periodMode), firstDay: settings.firstDay }, timezoneId: read.timezoneId };
}

export type RebuildError = 'NO_PROFILE' | 'DATE_INVALID';

/**
 * The target a period has: the version in force from its start, and for a shortened pay cycle (Story 4.8) pro-rated to its
 * length, but only for a budget that follows the default period. Weekly, monthly and custom budgets keep their own periods.
 */
export function periodTarget(budget: BudgetDef, versions: readonly TargetVersion[], period: Period): number | null {
  const base = targetForPeriod(versions, period.start);
  if (base === null) return null;
  return period.shortened && budget.period.rule === 'default' && period.normalDays ? prorateTarget(base, periodDays(period), period.normalDays) : base;
}

/** Rebuilds the cached periods of some budgets (or all) from the period service and their target versions. */
export async function rebuildPeriods(ctx: WriterContext, only?: readonly string[]): Promise<RebuildError | { budgets: number; periods: number }> {
  const read = await readPeriodProfile(ctx);
  if (!read) return 'NO_PROFILE';
  const today = toLocalDate(ctx.nowMs(), read.timezoneId);
  if (!today.ok) return 'DATE_INVALID';
  const budgets = mapBudgets(await ctx.query(BUDGETS_SQL)).filter((b) => !only || only.includes(b.id));
  let periods = 0;
  for (const b of budgets) {
    const versions = mapTargetVersions(await ctx.query(TARGET_VERSIONS_SQL, [b.id]));
    await ctx.execute('DELETE FROM budget_period WHERE budget_id = ?', [b.id]);
    if (versions.length === 0) continue;
    const first = versions.reduce((m, v) => (v.effectiveFrom < m ? v.effectiveFrom : m), versions[0]!.effectiveFrom);
    for (const p of periodsToCache(b, first, today.value, read.profile)) {
      const target = periodTarget(b, versions, p);
      if (target === null) continue;
      await ctx.execute('INSERT INTO budget_period (budget_id, start_date, end_date, target_minor, shortened) VALUES (?, ?, ?, ?, ?)', [b.id, p.start, p.end, target, p.shortened && b.period.rule === 'default' ? 1 : 0]);
      periods += 1;
    }
  }
  return { budgets: budgets.length, periods };
}

/**
 * Rebuilds the derived `budget_period` rows from the period service and the target versions. It runs when payday, the
 * period mode or the first day of the week changes (`ProfileChanged`). It touches only the cache: no transaction, split or
 * posting changes, and every budget figure is counted again from the entries' own dates.
 */
export const RebuildBudgetPeriods: UseCase<Record<string, never>, { budgets: number; periods: number }, RebuildError> = {
  name: 'RebuildBudgetPeriods',
  async execute(ctx: WriterContext) {
    const r = await rebuildPeriods(ctx);
    if (typeof r === 'string') return err(r);
    ctx.touch('budget_period', 'all', { rebuilt: true, budgets: r.budgets });
    return ok(r);
  },
};

// ---- Budgets that end with their category (Story 4.3 and 4.6) --------------------------------------------------------

/** Active category budgets that every one of whose categories is in `ids` and that have not ended yet. */
export async function budgetsEndingWith(q: Querier, ids: readonly string[]): Promise<{ id: string; name: string }[]> {
  const set = new Set(ids);
  return mapBudgets(await q.query(BUDGETS_SQL))
    .filter((b) => b.scope === 'category' && !b.endedAfter && b.categoryIds.length > 0 && b.categoryIds.every((c) => set.has(c)))
    .map((b) => ({ id: b.id, name: b.name ?? '' }));
}

/**
 * The only category of a budget was archived or merged: its last period is the one it is in now. It stays in history and
 * the entries and past periods are untouched. Returns the budgets that ended.
 */
export async function endBudgets(ctx: WriterContext, ids: readonly string[]): Promise<string[]> {
  const ending = await budgetsEndingWith(ctx, ids);
  if (ending.length === 0) return [];
  const read = await readPeriodProfile(ctx);
  if (!read) return [];
  const today = toLocalDate(ctx.nowMs(), read.timezoneId);
  if (!today.ok) return [];
  const defs = new Map(mapBudgets(await ctx.query(BUDGETS_SQL)).map((b) => [b.id, b]));
  const done: string[] = [];
  for (const e of ending) {
    const b = defs.get(e.id)!;
    const period = budgetPeriodFor(b.period, today.value, read.profile);
    const end = period?.end ?? b.period.customEnd ?? null;
    if (end === null) continue;
    await ctx.execute('UPDATE budget SET ended_after = ? WHERE id = ?', [end, e.id]);
    ctx.touch('budget', e.id, { ended: true, label: e.name });
    done.push(e.id);
  }
  return done;
}

/** A category came back (Restore, or Undo of a merge): the budgets that ended with it run again. Returns their ids. */
export async function reopenBudgets(ctx: WriterContext, ids: readonly string[]): Promise<string[]> {
  const set = new Set(ids);
  const back = mapBudgets(await ctx.query(BUDGETS_SQL)).filter((b) => b.scope === 'category' && b.endedAfter && b.categoryIds.length > 0 && b.categoryIds.every((c) => set.has(c)));
  for (const b of back) {
    await ctx.execute('UPDATE budget SET ended_after = NULL WHERE id = ?', [b.id]);
    ctx.touch('budget', b.id, { reopened: true, label: b.name ?? '' });
  }
  return back.map((b) => b.id);
}
