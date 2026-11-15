import { ok } from '../shared/result';
import { toLocalDate } from '../shared/clock';
import type { EventHandler } from '../writer/outbox';
import type { Notifier, NotificationContent } from '../ports/notifier';
import { budgetPeriodFor } from '../profile/period';
import type { UseCase } from '../writer/ledgerWriter';
import { budgetFigures, type Querier } from './budgets';
import { BUDGETS_SQL, mapBudgets, mapTargetVersions, periodTarget, readPeriodProfile, TARGET_VERSIONS_SQL } from './budgetStore';
import { DEFAULT_ALERT_LEVELS } from './budgetCommands';
import { billSlotsToday, DAILY_NOTIFICATION_CAP, foldedOverflow } from './billReminders';

/**
 * Budget threshold alerts (Story 4.9, BDG-004): one calm heads-up when a budget crosses an alert level, never the same one
 * twice in a period. Only the period running today is looked at, so a change dated in an ended period can never alert.
 */

export interface FiredAlert {
  readonly budgetId: string;
  readonly periodStart: string;
  /** The highest level that was newly crossed. */
  readonly thresholdPct: number;
}

/**
 * For every active budget, finds the alert levels now crossed in the current period that were never recorded, records all
 * of them as fired in this one transaction, and raises exactly one `BudgetThresholdCrossed` for the highest (none when the
 * budget is muted: the crossings are still recorded, so turning alerts back on never fires old ones). Running it again with
 * nothing new does nothing, so a redelivered event fires nothing twice.
 */
export const EvaluateBudgetAlerts: UseCase<Record<string, never>, { fired: readonly FiredAlert[] }, never> = {
  name: 'EvaluateBudgetAlerts',
  async execute(ctx) {
    const read = await readPeriodProfile(ctx);
    if (!read) return ok({ fired: [] });
    const today = toLocalDate(ctx.nowMs(), read.timezoneId);
    if (!today.ok) return ok({ fired: [] });
    const fired: FiredAlert[] = [];
    for (const b of mapBudgets(await ctx.query(BUDGETS_SQL))) {
      if (b.scope === 'savings' || (b.endedAfter && today.value > b.endedAfter)) continue;
      const period = budgetPeriodFor(b.period, today.value, read.profile);
      if (!period) continue;
      const target = periodTarget(b, mapTargetVersions(await ctx.query(TARGET_VERSIONS_SQL, [b.id])), period);
      if (target === null || target <= 0) continue;
      const used = (await budgetFigures(ctx, b, period)).usedMinor;
      const levels = b.alertThresholds ?? [...DEFAULT_ALERT_LEVELS];
      const crossed = levels.filter((l) => used * 100 >= target * l);
      if (crossed.length === 0) continue;
      const already = new Set((await ctx.query('SELECT threshold_pct FROM budget_alert_fired WHERE budget_id = ? AND period_start = ?', [b.id, period.start])).map((r) => Number(r[0])));
      const fresh = crossed.filter((l) => !already.has(l));
      if (fresh.length === 0) continue;
      for (const l of fresh) await ctx.execute('INSERT INTO budget_alert_fired (budget_id, period_start, threshold_pct, fired_at) VALUES (?, ?, ?, ?)', [b.id, period.start, l, ctx.nowMs()]);
      const highest = Math.max(...fresh);
      ctx.touch('budget', b.id, { alertLevel: highest, muted: b.muted === true });
      if (!b.muted) {
        ctx.emit('BudgetThresholdCrossed', { budgetId: b.id, periodStart: period.start, thresholdPct: highest });
        fired.push({ budgetId: b.id, periodStart: period.start, thresholdPct: highest });
      }
    }
    return ok({ fired });
  },
};

/**
 * The notification for a crossing. No amount anywhere, neutral wording, no badge, and a generic lock-screen version:
 * `Groceries: 90% used this period`, `Groceries: limit reached this period` at 100%.
 */
export function budgetAlertContent(input: { budgetId: string; periodStart: string; name: string; thresholdPct: number }): NotificationContent {
  const limit = input.thresholdPct >= 100;
  return {
    id: `budget-${input.budgetId}-${input.periodStart}-${input.thresholdPct}`,
    channel: 'budget_alerts',
    title: 'Budget update',
    body: limit ? `${input.name}: limit reached this period` : `${input.name}: ${input.thresholdPct}% used this period`,
    publicTitle: 'Budget update',
    publicBody: 'Tap to see',
    badge: false,
    data: { screen: 'BudgetDetail', budgetId: input.budgetId, periodStart: input.periodStart },
  };
}

export interface BudgetAlertDeps {
  /** Runs `EvaluateBudgetAlerts` through the writer (the app's composition root provides it). */
  readonly evaluate: () => Promise<unknown>;
  readonly notifier: Notifier;
  readonly db: Querier;
  /** The clock, so a day's notification slots are today's. */
  readonly nowMs?: () => number;
}

/**
 * Planning's event handlers for alerts. A change to the ledger (or a budget edit) re-checks the current period, except a
 * change that touched a closed period, which can never alert. A crossing becomes a notification only when the notifier is
 * available and the permission is granted; the notification id is stable, so a redelivered event posts nothing new.
 */
export function budgetAlertHandlers(deps: BudgetAlertDeps): { TransactionsChanged: EventHandler[]; BudgetsChanged: EventHandler[]; BudgetThresholdCrossed: EventHandler[] } {
  const check: EventHandler = async (event) => {
    const p = event.payload as { closedPeriodTouched?: boolean };
    if (event.name === 'TransactionsChanged' && p.closedPeriodTouched === true) return;
    await deps.evaluate();
  };
  const post: EventHandler = async (event) => {
    if (!deps.notifier.available) return;
    const p = event.payload as { budgetId: string; periodStart: string; thresholdPct: number };
    if ((await deps.notifier.permission()) !== 'granted') return;
    const row = (await deps.db.query('SELECT name FROM budget WHERE id = ? AND removed_at IS NULL', [p.budgetId]))[0];
    if (!row) return;
    // Bill reminders claim the day's three slots first: with them taken the alert is folded into that day's `N more reminders`
    // (updated in place). Its threshold was recorded as fired already, so it is never posted again.
    const slots = deps.nowMs ? await billSlotsToday(deps.db, deps.nowMs()) : null;
    if (slots && slots.taken >= DAILY_NOTIFICATION_CAP) {
      await deps.notifier.post(foldedOverflow(slots.date, slots.overflowMore));
      return;
    }
    await deps.notifier.post(budgetAlertContent({ budgetId: p.budgetId, periodStart: p.periodStart, name: String(row[0]), thresholdPct: p.thresholdPct }));
  };
  return { TransactionsChanged: [check], BudgetsChanged: [check], BudgetThresholdCrossed: [post] };
}
