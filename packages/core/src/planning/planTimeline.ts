import { budgetPeriodFor, daysBetween, periodRangeLabel } from '../profile/period';
import { toLocalDate } from '../shared/clock';
import type { Querier } from './budgets';
import { readPeriodProfile } from './budgetStore';
import { billOccurrences, nextDue, type BillOccurrence } from './recurring';
import { mapPayments, mapRules, RECURRING_PAYMENTS_SQL, RECURRING_RULES_SQL } from './recurringStore';

/**
 * The "Before payday" timeline on the Plan hub (Story 6.8, REC-010, SCR-13): the bills the user added that fall due from today
 * to the end of the current period, plus the ones from earlier in the period that were not seen yet. It never lists a bill the
 * user did not add, and it only ever reads: planned bills touch no balance, spending or budget figure.
 */

export interface TimelineItem {
  readonly ruleId: string;
  readonly title: string;
  readonly kind: BillOccurrence['kind'];
  readonly dueDate: string;
  readonly status: BillOccurrence['status'];
  readonly daysUntilDue: number | null;
  readonly expectedAmountMinor: number;
  readonly accountName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly cadence: string;
  readonly customEvery: number | null;
  readonly customUnit: string | null;
  /** For a paid due date: how it was paid and, for a linked one, the entry's date. */
  readonly paidBy: 'linked' | 'marked' | null;
  readonly paidOn: string | null;
}

export interface PlanTimeline {
  readonly today: string;
  readonly period: { readonly start: string; readonly end: string; readonly label: string; readonly daysLeft: number; /** The profile has a payday (`Before payday`) rather than month-end. */ readonly payCycle: boolean };
  readonly items: readonly TimelineItem[];
  /** Active bills (not paused, ended or removed): `3 bills you added`. */
  readonly activeBills: number;
  /** The soonest next due date among active bills: `3 bills · next: Rent on 5 Dec`. */
  readonly nextBill: { readonly title: string; readonly dueDate: string } | null;
}

export async function loadPlanTimeline(q: Querier, nowMs: number): Promise<PlanTimeline | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const todayR = toLocalDate(nowMs, read.timezoneId);
  if (!todayR.ok) return null;
  const today = todayR.value;
  const period = budgetPeriodFor({ rule: 'default' }, today, read.profile);
  if (!period) return null;
  const rules = mapRules(await q.query(RECURRING_RULES_SQL));
  const payments = mapPayments(await q.query(RECURRING_PAYMENTS_SQL));
  const names = new Map((await q.query('SELECT id, name FROM account')).map((r) => [String(r[0]), String(r[1])]));
  const cats = new Map((await q.query('SELECT id, icon, color_token FROM category')).map((r) => [String(r[0]), { icon: String(r[1]), color: String(r[2]) }]));
  const byRule = new Map(rules.map((r) => [r.id, r]));
  const txDates = new Map<string, string>();
  const linkedIds = payments.map((p) => p.transactionId).filter((x): x is string => x !== null);
  if (linkedIds.length > 0) for (const r of await q.query(`SELECT id, local_date FROM "transaction" WHERE id IN (${linkedIds.map(() => '?').join(',')})`, linkedIds)) txDates.set(String(r[0]), String(r[1]));
  const active = rules.filter((r) => r.pausedAt === null && r.endedAt === null && r.removedAt === null);
  const items: TimelineItem[] = billOccurrences(active, payments, period.start, period.end, today)
    // The history of older unpaid dates is not part of what is coming; only the one `Not seen yet` stays.
    .filter((o) => o.status !== 'not_marked_paid')
    .map((o) => {
      const rule = byRule.get(o.ruleId)!;
      const cat = rule.categoryId ? cats.get(rule.categoryId) : undefined;
      return {
        ruleId: o.ruleId,
        title: o.title,
        kind: o.kind,
        dueDate: o.dueDate,
        status: o.status,
        daysUntilDue: o.daysUntilDue ?? null,
        expectedAmountMinor: o.expectedAmountMinor,
        accountName: o.accountId ? (names.get(o.accountId) ?? null) : null,
        categoryIcon: cat?.icon ?? null,
        categoryColor: cat?.color ?? null,
        cadence: rule.cadence,
        customEvery: rule.customEvery,
        customUnit: rule.customUnit,
        paidBy: o.payment?.kind ?? null,
        paidOn: o.payment?.transactionId ? (txDates.get(o.payment.transactionId) ?? null) : null,
      };
    });
  let next: PlanTimeline['nextBill'] = null;
  for (const r of active) {
    const d = nextDue(r, payments.filter((p) => p.ruleId === r.id), today);
    if (d !== null && (next === null || d < next.dueDate)) next = { title: r.title, dueDate: d };
  }
  return {
    today,
    period: { start: period.start, end: period.end, label: periodRangeLabel(period.start, period.end), daysLeft: daysBetween(today, period.end) + 1, payCycle: read.profile.rule.kind !== 'none' },
    items,
    activeBills: active.length,
    nextBill: next,
  };
}
