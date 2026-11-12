import { err, ok } from '../shared/result';
import { toLocalDate } from '../shared/clock';
import type { UseCase } from '../writer/ledgerWriter';
import { budgetPeriodFor, previousPeriod } from '../profile/period';
import { PROMPT_BUDGET_YES, SETTING_ROUGH_INCOME } from '../usecases/setUpProfile';
import { SEEN_PROMPT_SQL } from '../profile/promptState';
import { DEFAULT_ALERT_LEVELS } from './budgetCommands';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, readPeriodProfile, rebuildPeriods, TARGET_VERSIONS_SQL, type RebuildError } from './budgetStore';
import type { Querier } from './budgets';

/**
 * The one-tap 50/30/20 targets (Story 4.10, BDG-009): Needs, Wants and Savings as three budgets on the default period,
 * made from one income figure. They are ordinary budgets in every other way; the template only groups them and remembers
 * the income they came from.
 */

export const TEMPLATE_503020 = '50_30_20';
/** The setup card on the Plan tab was dismissed (prompt_state), so it never comes back. */
export const PROMPT_503020_CARD_DISMISSED = 'budgets.503020-card-dismissed';
/** The `Your income changed` card was answered for a period (Update or Keep): hidden until the next period. */
export const incomeCardKey = (periodStart: string): string => `budgets.income-card.${periodStart}`;
/** How far the last full period's Salary must be from the template's income (more than this share) to offer an update. */
export const INCOME_CHANGE_SHARE = 0.1;

export interface TemplateTargets {
  readonly needsMinor: number;
  readonly wantsMinor: number;
  readonly savingsMinor: number;
}

/**
 * 50/30/20 of an income in whole minor units: Needs and Wants are rounded down and Savings takes the rest, so the three
 * always add up to the income exactly (₹80,000.01 gives 40,000.00 + 24,000.00 + 16,000.01).
 */
export function splitIncome(incomeMinor: number): TemplateTargets {
  const needsMinor = Math.floor(incomeMinor / 2);
  const wantsMinor = Math.floor((incomeMinor * 3) / 10);
  return { needsMinor, wantsMinor, savingsMinor: incomeMinor - needsMinor - wantsMinor };
}

export type TemplateError = 'INCOME_REQUIRED' | 'AMOUNT_REQUIRED' | 'TEMPLATE_EXISTS' | 'TEMPLATE_NOT_FOUND' | RebuildError;

const NEED = 'Needs';
const WANT = 'Wants';
const SAVE = 'Savings';

const validTargets = (t: TemplateTargets): boolean => [t.needsMinor, t.wantsMinor, t.savingsMinor].every((n) => Number.isSafeInteger(n) && n > 0);

/**
 * Creates the three budgets in one transaction with audit and `BudgetsChanged`. The targets are the 50/30/20 split of the
 * income unless the user edited them, and then they are saved as typed (they are not forced to add up to the income). A
 * second set is refused (`TEMPLATE_EXISTS`).
 */
export const CreateFiftyThirtyTwenty: UseCase<{ incomeMinor: number; targets?: TemplateTargets }, { budgetIds: string[] }, TemplateError> = {
  name: 'CreateFiftyThirtyTwenty',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.incomeMinor) || input.incomeMinor <= 0) return err('INCOME_REQUIRED');
    const targets = input.targets ?? splitIncome(input.incomeMinor);
    if (!validTargets(targets)) return err('AMOUNT_REQUIRED');
    if ((await ctx.query('SELECT 1 FROM budget WHERE template = ? AND removed_at IS NULL LIMIT 1', [TEMPLATE_503020]))[0]) return err('TEMPLATE_EXISTS');
    const read = await readPeriodProfile(ctx);
    if (!read) return err('NO_PROFILE');
    const today = toLocalDate(ctx.nowMs(), read.timezoneId);
    if (!today.ok) return err('DATE_INVALID');
    const period = budgetPeriodFor({ rule: 'default' }, today.value, read.profile)!;
    const levels = JSON.stringify([...DEFAULT_ALERT_LEVELS]);
    const rows: { name: string; scope: 'budget_type' | 'savings'; type: 'need' | 'want' | null; target: number }[] = [
      { name: NEED, scope: 'budget_type', type: 'need', target: targets.needsMinor },
      { name: WANT, scope: 'budget_type', type: 'want', target: targets.wantsMinor },
      { name: SAVE, scope: 'savings', type: null, target: targets.savingsMinor },
    ];
    const ids: string[] = [];
    for (const r of rows) {
      const id = ctx.newId();
      ids.push(id);
      await ctx.execute(
        "INSERT INTO budget (id, name, scope, scope_category_ids, scope_budget_type, account_ids, period_rule, template, template_income_minor, alert_rule, muted, created_at) VALUES (?, ?, ?, '[]', ?, NULL, 'default', ?, ?, ?, 0, ?)",
        [id, r.name, r.scope, r.type, TEMPLATE_503020, input.incomeMinor, levels, ctx.nowMs()],
      );
      await ctx.execute('INSERT INTO budget_target_version (budget_id, version, target_minor, effective_from) VALUES (?, 1, ?, ?)', [id, r.target, period.start]);
      ctx.touch('budget', id, { added: true, label: r.name, template: TEMPLATE_503020 });
    }
    const rebuilt = await rebuildPeriods(ctx, ids);
    if (typeof rebuilt === 'string') return err(rebuilt);
    ctx.emit('BudgetsChanged', { budgetIds: ids });
    return ok({ budgetIds: ids });
  },
};

/** Undo of the creation: the three budgets are removed (kept for audit) in one step. */
export const UndoFiftyThirtyTwenty: UseCase<{ budgetIds: readonly string[] }, void, 'TEMPLATE_NOT_FOUND'> = {
  name: 'UndoFiftyThirtyTwenty',
  async execute(ctx, input) {
    if (input.budgetIds.length === 0) return err('TEMPLATE_NOT_FOUND');
    for (const id of input.budgetIds) {
      await ctx.execute('UPDATE budget SET removed_at = ? WHERE id = ? AND template = ? AND removed_at IS NULL', [ctx.nowMs(), id, TEMPLATE_503020]);
      await ctx.execute('DELETE FROM budget_period WHERE budget_id = ?', [id]);
      ctx.touch('budget', id, { undone: true });
    }
    ctx.emit('BudgetsChanged', { budgetIds: [...input.budgetIds] });
    return ok(undefined);
  },
};

/**
 * `Edit targets`: new limits for Needs, Wants and Savings from the period running now. A target that did not change adds
 * no version; past periods keep what they had.
 */
export const ChangeTemplateTargets: UseCase<{ targets: TemplateTargets; /** The income the new targets are made from (the income card's Update). */ incomeMinor?: number }, { changed: number }, TemplateError> = {
  name: 'ChangeTemplateTargets',
  async execute(ctx, input) {
    if (!validTargets(input.targets)) return err('AMOUNT_REQUIRED');
    const read = await readPeriodProfile(ctx);
    if (!read) return err('NO_PROFILE');
    const today = toLocalDate(ctx.nowMs(), read.timezoneId);
    if (!today.ok) return err('DATE_INVALID');
    const period = budgetPeriodFor({ rule: 'default' }, today.value, read.profile)!;
    const budgets = mapBudgets(await ctx.query(BUDGETS_SQL)).filter((b) => b.template === TEMPLATE_503020);
    if (budgets.length === 0) return err('TEMPLATE_NOT_FOUND');
    const want = (b: { scope: string; budgetType: 'need' | 'want' | null }) => (b.scope === 'savings' ? input.targets.savingsMinor : b.budgetType === 'need' ? input.targets.needsMinor : input.targets.wantsMinor);
    const changedIds: string[] = [];
    for (const b of budgets) {
      const versions = mapTargetVersions(await ctx.query(TARGET_VERSIONS_SQL, [b.id]));
      const latest = versions.at(-1);
      const target = want(b);
      if (latest && latest.targetMinor === target) continue;
      await ctx.execute('INSERT INTO budget_target_version (budget_id, version, target_minor, effective_from) VALUES (?, ?, ?, ?)', [b.id, (latest?.version ?? 0) + 1, target, period.start]);
      ctx.touch('budget', b.id, { edited: true, label: b.name ?? '', template: TEMPLATE_503020 });
      changedIds.push(b.id);
    }
    if (input.incomeMinor !== undefined && Number.isSafeInteger(input.incomeMinor) && input.incomeMinor > 0) {
      await ctx.execute('UPDATE budget SET template_income_minor = ? WHERE template = ? AND removed_at IS NULL', [input.incomeMinor, TEMPLATE_503020]);
      for (const b of budgets) if (!changedIds.includes(b.id)) ctx.touch('budget', b.id, { incomeUpdated: true, template: TEMPLATE_503020 });
    }
    if (changedIds.length > 0) {
      const rebuilt = await rebuildPeriods(ctx, changedIds);
      if (typeof rebuilt === 'string') return err(rebuilt);
      ctx.emit('BudgetsChanged', { budgetIds: changedIds });
    }
    return ok({ changed: changedIds.length });
  },
};

export interface TemplateState {
  /** Set once the three budgets exist. */
  readonly exists: boolean;
  readonly targets: TemplateTargets | null;
  /** The income the template was made from. */
  readonly incomeMinor: number | null;
  /** What to pre-fill `Your monthly income` with: last full period's Salary, else the onboarding answer, else nothing. */
  readonly suggestedIncomeMinor: number | null;
  readonly suggestionSource: 'salary' | 'onboarding' | null;
  /** The onboarding `Try 50/30/20?` answer was Yes and its figure (null when no rough income was given). */
  readonly onboardingYes: boolean;
  readonly onboardingIncomeMinor: number | null;
  /** The income changed by more than 10% since the template was made: `Your income changed — update 50/30/20 to ₹90,000?` Hidden until the next period once answered. */
  readonly incomeChange: { readonly oldIncomeMinor: number; readonly newIncomeMinor: number; readonly periodStart: string } | null;
  /** The setup card `You wanted to try 50/30/20`: Yes at onboarding, nothing created yet, not dismissed. */
  readonly showSetupCard: boolean;
}

/** The income received as Salary in the last full period of the default pay period (confirmed entries, by their own dates). */
export async function lastPeriodSalaryMinor(q: Querier, nowMs: number): Promise<number | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const current = budgetPeriodFor({ rule: 'default' }, today.value, read.profile);
  const last = current ? previousPeriod(current, read.profile) : null;
  if (!last) return null;
  const rows = await q.query(
    "SELECT COALESCE(SUM(s.amount_minor), 0) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id WHERE t.event_type = 'income' AND t.status = 'confirmed' AND t.removed_at IS NULL AND s.category_id = 'cat_in_salary' AND t.local_date BETWEEN ? AND ?",
    [last.start, last.end],
  );
  const total = Number(rows[0]?.[0] ?? 0);
  return total > 0 ? total : null;
}

export async function loadTemplateState(q: Querier, nowMs: number): Promise<TemplateState> {
  const budgets = mapBudgets(await q.query(BUDGETS_SQL)).filter((b) => b.template === TEMPLATE_503020);
  let targets: TemplateTargets | null = null;
  let incomeMinor: number | null = null;
  if (budgets.length > 0) {
    const t = { needsMinor: 0, wantsMinor: 0, savingsMinor: 0 };
    for (const b of budgets) {
      const latest = mapTargetVersions(await q.query(TARGET_VERSIONS_SQL, [b.id])).at(-1)?.targetMinor ?? 0;
      if (b.scope === 'savings') t.savingsMinor = latest;
      else if (b.budgetType === 'need') t.needsMinor = latest;
      else t.wantsMinor = latest;
    }
    targets = t;
    const r = (await q.query('SELECT template_income_minor FROM budget WHERE template = ? AND removed_at IS NULL LIMIT 1', [TEMPLATE_503020]))[0];
    incomeMinor = r && r[0] !== null ? Number(r[0]) : null;
  }
  const yes = Number((await q.query(SEEN_PROMPT_SQL, [PROMPT_BUDGET_YES]))[0]?.[0] ?? 0) > 0;
  let rough: number | null = null;
  if (yes) {
    const row = (await q.query('SELECT value_json FROM settings WHERE key = ?', [SETTING_ROUGH_INCOME]))[0];
    const v = row ? Number(JSON.parse(String(row[0]))) : NaN;
    rough = Number.isSafeInteger(v) && v > 0 ? v : null;
  }
  const salary = await lastPeriodSalaryMinor(q, nowMs);
  const dismissed = Number((await q.query(SEEN_PROMPT_SQL, [PROMPT_503020_CARD_DISMISSED]))[0]?.[0] ?? 0) > 0;
  const exists = budgets.length > 0;
  let incomeChange: TemplateState['incomeChange'] = null;
  if (exists && incomeMinor !== null && salary !== null && Math.abs(salary - incomeMinor) > incomeMinor * INCOME_CHANGE_SHARE) {
    const read = await readPeriodProfile(q);
    const today = read ? toLocalDate(nowMs, read.timezoneId) : null;
    const current = read && today?.ok ? budgetPeriodFor({ rule: 'default' }, today.value, read.profile) : null;
    const answered = current ? Number((await q.query(SEEN_PROMPT_SQL, [incomeCardKey(current.start)]))[0]?.[0] ?? 0) > 0 : true;
    if (current && !answered) incomeChange = { oldIncomeMinor: incomeMinor, newIncomeMinor: salary, periodStart: current.start };
  }
  return {
    incomeChange,
    exists,
    targets,
    incomeMinor,
    suggestedIncomeMinor: salary ?? rough,
    suggestionSource: salary !== null ? 'salary' : rough !== null ? 'onboarding' : null,
    onboardingYes: yes,
    onboardingIncomeMinor: rough,
    showSetupCard: yes && !exists && !dismissed,
  };
}
