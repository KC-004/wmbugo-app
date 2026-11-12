import { err, ok } from '../shared/result';
import { toLocalDate } from '../shared/clock';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { budgetPeriodFor, customPeriod, isLocalDate } from '../profile/period';
import { currentPeriod, type BudgetDef } from './budgets';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, readPeriodProfile, rebuildPeriods, TARGET_VERSIONS_SQL } from './budgetStore';

/** The alert levels the editor offers, and the ones preselected (Story 4.6). */
export const ALERT_LEVELS = [50, 75, 80, 90, 100] as const;
export const DEFAULT_ALERT_LEVELS = [75, 90, 100] as const;

export interface SaveBudgetInput {
  /** Present when editing. */
  readonly id?: string;
  /** `overall` (Everything) or `category` (Some categories). */
  readonly scope: 'overall' | 'category';
  readonly categoryIds: readonly string[];
  /** Only entries posted on these accounts count; null means every account. */
  readonly accountIds: readonly string[] | null;
  readonly periodRule: 'default' | 'monthly' | 'weekly' | 'custom';
  readonly customStart?: string | null;
  readonly customEnd?: string | null;
  readonly targetMinor: number;
  readonly alertLevels: readonly number[];
}

/** `OVERALL_EXISTS:<budget id>`: there is already an overall budget (BDG-002); the id lets the sheet offer `Edit it`. */
export type OverallExists = `OVERALL_EXISTS:${string}`;

export type SaveBudgetError =
  | 'AMOUNT_REQUIRED'
  | 'CATEGORY_REQUIRED'
  | 'DATE_INVALID'
  | 'DATE_RANGE_INVALID'
  | 'ALERT_INVALID'
  | 'CATEGORY_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'BUDGET_NOT_FOUND'
  | 'NO_PROFILE'
  | OverallExists;

export const parseOverallExists = (code: string): string | null => (code.startsWith('OVERALL_EXISTS:') ? code.slice('OVERALL_EXISTS:'.length) : null);

const isDate = (s: string | null | undefined): s is string => typeof s === 'string' && isLocalDate(s);

interface BudgetRow {
  readonly name: string;
  readonly scope: string;
  readonly categoryIds: string;
  readonly accountIds: string | null;
  readonly periodRule: string;
  readonly customStart: string | null;
  readonly customEnd: string | null;
  readonly alertRule: string | null;
  readonly endedAfter: string | null;
}

/** What Undo needs to put one budget back as it was. */
export interface BudgetSnapshot {
  readonly row: BudgetRow;
  /** The target version this save added, to be removed again. */
  readonly addedVersion: number | null;
}

async function readRow(ctx: WriterContext, id: string): Promise<BudgetRow | null> {
  const r = (await ctx.query('SELECT name, scope, scope_category_ids, account_ids, period_rule, custom_start, custom_end, alert_rule, ended_after FROM budget WHERE id = ? AND removed_at IS NULL', [id]))[0];
  if (!r) return null;
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return { name: String(r[0]), scope: String(r[1]), categoryIds: String(r[2]), accountIds: s(r[3]), periodRule: String(r[4]), customStart: s(r[5]), customEnd: s(r[6]), alertRule: s(r[7]), endedAfter: s(r[8]) };
}

const dedupe = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

/** `Groceries`, `Groceries and Fuel`, `Groceries, Fuel +2`. */
function nameFor(scope: 'overall' | 'category', categoryNames: readonly string[]): string {
  if (scope === 'overall') return 'Overall';
  if (categoryNames.length <= 2) return categoryNames.join(' and ');
  return `${categoryNames.slice(0, 2).join(', ')} +${categoryNames.length - 2}`;
}

/**
 * Adds a budget or edits one (Story 4.6, BDG-001/002). The budget and its version 1 target go in one transaction with an
 * audit row and `BudgetsChanged`. One overall budget only: a second returns `OVERALL_EXISTS:<id>` and writes nothing. An
 * overall budget always follows the profile period. Editing the limit adds a new target version from the current period
 * (Story 4.7 adds the choice to start it next period); past periods keep the version they had.
 */
export const SaveBudget: UseCase<SaveBudgetInput, { budgetId: string; created: boolean; snapshot: BudgetSnapshot | null }, SaveBudgetError> = {
  name: 'SaveBudget',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.targetMinor) || input.targetMinor <= 0) return err('AMOUNT_REQUIRED');
    const categoryIds = dedupe(input.categoryIds);
    if (input.scope === 'category' && categoryIds.length === 0) return err('CATEGORY_REQUIRED');
    const periodRule = input.scope === 'overall' ? 'default' : input.periodRule;
    if (periodRule === 'custom') {
      if (!isDate(input.customStart) || !isDate(input.customEnd)) return err('DATE_INVALID');
      if (input.customEnd < input.customStart) return err('DATE_RANGE_INVALID');
    }
    const levels = dedupe(input.alertLevels).sort((a, b) => a - b);
    if (levels.some((l) => !(ALERT_LEVELS as readonly number[]).includes(l))) return err('ALERT_INVALID');

    const existing = input.id !== undefined ? await readRow(ctx, input.id) : null;
    if (input.id !== undefined && !existing) return err('BUDGET_NOT_FOUND');
    if (input.scope === 'overall') {
      const other = (await ctx.query("SELECT id FROM budget WHERE scope = 'overall' AND removed_at IS NULL AND id <> ?", [input.id ?? '']))[0];
      if (other) return err(`OVERALL_EXISTS:${String(other[0])}`);
    }
    const names: string[] = [];
    for (const id of categoryIds) {
      const c = (await ctx.query('SELECT name FROM category WHERE id = ? AND archived = 0', [id]))[0];
      if (!c) return err('CATEGORY_NOT_FOUND');
      names.push(String(c[0]));
    }
    for (const id of input.accountIds ?? []) if ((await ctx.query('SELECT 1 FROM account WHERE id = ?', [id])).length === 0) return err('ACCOUNT_NOT_FOUND');
    const read = await readPeriodProfile(ctx);
    if (!read) return err('NO_PROFILE');
    const today = toLocalDate(ctx.nowMs(), read.timezoneId);
    if (!today.ok) return err('NO_PROFILE');

    const accountIds = input.accountIds && input.accountIds.length > 0 ? JSON.stringify(dedupe(input.accountIds)) : null;
    const alertRule = JSON.stringify(levels);
    const custom = periodRule === 'custom';
    const id = existing ? input.id! : ctx.newId();
    const name = nameFor(input.scope, names);
    const scopeCategoryIds = JSON.stringify(input.scope === 'category' ? categoryIds : []);
    if (existing) {
      await ctx.execute(
        'UPDATE budget SET name = ?, scope = ?, scope_category_ids = ?, account_ids = ?, period_rule = ?, custom_start = ?, custom_end = ?, alert_rule = ? WHERE id = ?',
        [name, input.scope, scopeCategoryIds, accountIds, periodRule, custom ? input.customStart! : null, custom ? input.customEnd! : null, alertRule, id],
      );
    } else {
      await ctx.execute(
        'INSERT INTO budget (id, name, scope, scope_category_ids, account_ids, period_rule, custom_start, custom_end, alert_rule, muted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
        [id, name, input.scope, scopeCategoryIds, accountIds, periodRule, custom ? input.customStart! : null, custom ? input.customEnd! : null, alertRule, ctx.nowMs()],
      );
    }

    // The target: version 1 for a new budget, a new version from the current period when the limit changed.
    const def: BudgetDef = { id, scope: input.scope, categoryIds, budgetType: null, accountIds: input.accountIds && input.accountIds.length > 0 ? input.accountIds : null, period: { rule: periodRule, customStart: input.customStart ?? null, customEnd: input.customEnd ?? null } };
    const period = currentPeriod(def, today.value, read.profile) ?? (custom ? customPeriod(input.customStart!, input.customEnd!) : budgetPeriodFor({ rule: 'default' }, today.value, read.profile)!);
    const versions = mapTargetVersions(await ctx.query(TARGET_VERSIONS_SQL, [id]));
    const latest = versions.at(-1);
    let addedVersion: number | null = null;
    if (!latest || latest.targetMinor !== input.targetMinor) {
      addedVersion = (latest?.version ?? 0) + 1;
      await ctx.execute('INSERT INTO budget_target_version (budget_id, version, target_minor, effective_from) VALUES (?, ?, ?, ?)', [id, addedVersion, input.targetMinor, period.start]);
    }
    const rebuilt = await rebuildPeriods(ctx, [id]);
    if (typeof rebuilt === 'string') return err('NO_PROFILE');

    ctx.touch('budget', id, { ...(existing ? { edited: true } : { added: true }), label: name, scope: input.scope, period: periodRule });
    ctx.emit('BudgetsChanged', { budgetIds: [id] });
    return ok({ budgetId: id, created: !existing, snapshot: existing ? { row: existing, addedVersion } : { row: { name, scope: input.scope, categoryIds: scopeCategoryIds, accountIds, periodRule, customStart: null, customEnd: null, alertRule, endedAfter: null }, addedVersion } });
  },
};

/** Undo of a save: a new budget is removed (kept for audit), an edited one goes back to what it was. */
export const UndoSaveBudget: UseCase<{ budgetId: string; created: boolean; snapshot: BudgetSnapshot }, void, 'BUDGET_NOT_FOUND'> = {
  name: 'UndoSaveBudget',
  async execute(ctx, input) {
    if (!(await readRow(ctx, input.budgetId))) return err('BUDGET_NOT_FOUND');
    if (input.created) {
      await ctx.execute('UPDATE budget SET removed_at = ? WHERE id = ?', [ctx.nowMs(), input.budgetId]);
      await ctx.execute('DELETE FROM budget_period WHERE budget_id = ?', [input.budgetId]);
    } else {
      const r = input.snapshot.row;
      await ctx.execute('UPDATE budget SET name = ?, scope = ?, scope_category_ids = ?, account_ids = ?, period_rule = ?, custom_start = ?, custom_end = ?, alert_rule = ?, ended_after = ? WHERE id = ?', [
        r.name, r.scope, r.categoryIds, r.accountIds, r.periodRule, r.customStart, r.customEnd, r.alertRule, r.endedAfter, input.budgetId,
      ]);
      if (input.snapshot.addedVersion !== null) await ctx.execute('DELETE FROM budget_target_version WHERE budget_id = ? AND version = ?', [input.budgetId, input.snapshot.addedVersion]);
      const rebuilt = await rebuildPeriods(ctx, [input.budgetId]);
      if (typeof rebuilt === 'string') return err('BUDGET_NOT_FOUND');
    }
    ctx.touch('budget', input.budgetId, { undone: true });
    ctx.emit('BudgetsChanged', { budgetIds: [input.budgetId] });
    return ok(undefined);
  },
};

/** Active budgets as the sheet needs to edit them. Param: budget id. */
export async function readBudgetForEdit(q: Pick<WriterContext, 'query'>, id: string): Promise<(BudgetDef & { targetMinor: number }) | null> {
  const b = mapBudgets(await q.query(BUDGETS_SQL)).find((x) => x.id === id);
  if (!b) return null;
  const versions = mapTargetVersions(await q.query(TARGET_VERSIONS_SQL, [id]));
  return { ...b, targetMinor: versions.at(-1)?.targetMinor ?? 0 };
}
