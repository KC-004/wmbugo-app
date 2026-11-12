import { err, ok } from '../shared/result';
import { toLocalDate } from '../shared/clock';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { paydayRuleFromRow } from '../profile/period';
import { SETTINGS_SQL, parseSettings, periodRule } from '../profile/settings';
import type { PeriodProfile } from '../profile/period';
import { periodsToCache, targetForPeriod, type BudgetDef, type Querier, type TargetVersion } from './budgets';

/** Active budgets (not removed), oldest first. Columns are read by `mapBudgets`. */
export const BUDGETS_SQL =
  'SELECT id, scope, scope_category_ids, scope_budget_type, account_ids, period_rule, custom_start, custom_end, alert_rule FROM budget WHERE removed_at IS NULL ORDER BY created_at, id';

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
  const p = (await q.query('SELECT payday_rule, payday_day, timezone_id FROM profile LIMIT 1'))[0];
  if (!p) return null;
  const settings = parseSettings(await q.query(SETTINGS_SQL));
  const rule = periodRule(paydayRuleFromRow(p[0] === null ? null : String(p[0]), p[1] === null ? null : Number(p[1])), settings.periodMode);
  return { profile: { rule, firstDay: settings.firstDay }, timezoneId: String(p[2]) };
}

export type RebuildError = 'NO_PROFILE' | 'DATE_INVALID';

/**
 * Rebuilds the derived `budget_period` rows from the period service and the target versions. It runs when payday, the
 * period mode or the first day of the week changes (`ProfileChanged`). It touches only the cache: no transaction, split or
 * posting changes, and every budget figure is counted again from the entries' own dates.
 */
export const RebuildBudgetPeriods: UseCase<Record<string, never>, { budgets: number; periods: number }, RebuildError> = {
  name: 'RebuildBudgetPeriods',
  async execute(ctx: WriterContext) {
    const read = await readPeriodProfile(ctx);
    if (!read) return err('NO_PROFILE');
    const today = toLocalDate(ctx.nowMs(), read.timezoneId);
    if (!today.ok) return err('DATE_INVALID');
    const budgets = mapBudgets(await ctx.query(BUDGETS_SQL));
    let periods = 0;
    for (const b of budgets) {
      const versions = mapTargetVersions(await ctx.query(TARGET_VERSIONS_SQL, [b.id]));
      await ctx.execute('DELETE FROM budget_period WHERE budget_id = ?', [b.id]);
      if (versions.length === 0) continue;
      const first = versions.reduce((m, v) => (v.effectiveFrom < m ? v.effectiveFrom : m), versions[0]!.effectiveFrom);
      for (const p of periodsToCache(b, first, today.value, read.profile)) {
        const target = targetForPeriod(versions, p.start);
        if (target === null) continue;
        await ctx.execute('INSERT INTO budget_period (budget_id, start_date, end_date, target_minor, shortened) VALUES (?, ?, ?, ?, 0)', [b.id, p.start, p.end, target]);
        periods += 1;
      }
    }
    ctx.touch('budget_period', 'all', { rebuilt: true, budgets: budgets.length });
    return ok({ budgets: budgets.length, periods });
  },
};
