import { localMinutesOfDay, localToInstant, toLocalDate } from '../shared/clock';
import { readPaydayRule } from '../profile/paydayChange';
import { addDays } from '../profile/period';
import type { NotificationContent, Notifier, ScheduledNotification } from '../ports/notifier';
import type { Querier } from './budgets';
import { ruleOccurrences, type BillPayment, type BillRule } from './recurring';
import { mapPayments, mapRules, RECURRING_PAYMENTS_SQL, RECURRING_RULES_SQL } from './recurringStore';

/**
 * Bill reminders (Story 6.5, REC-003, SET-003). A reminder is a quiet, inexact notification around 9 am local time, never with
 * an amount and never with a badge. At most three non-capture notifications are posted a day: bill reminders claim the slots
 * first, and anything past the third is folded into one `N more reminders` notification that opens Bills.
 */

export const REMINDER_HOUR = 9;
/** The planner looks this many days ahead (today and the next 13). */
export const REMINDER_WINDOW_DAYS = 14;
/** SET-003: non-capture notifications a day. */
export const DAILY_NOTIFICATION_CAP = 3;

export type Relation = 'today' | 'tomorrow' | 'in_3_days';

export interface PlannedReminder {
  readonly id: string;
  /** The local date it is shown. */
  readonly remindOn: string;
  readonly kind: 'bill' | 'overflow';
  readonly ruleId: string | null;
  readonly title: string | null;
  readonly dueDate: string | null;
  readonly relation: Relation | null;
  /** For an overflow: how many reminders it stands for. */
  readonly moreCount: number;
}

const relationOf = (days: number): Relation => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in_3_days');

/**
 * Reminder slots for the next 14 days at 09:00 profile-local time for every unpaid due date of an active rule that has a
 * reminder. `nowMinutes` is the local time of day now, so today's 09:00 is not planned once it has passed. Per day the first
 * two go out individually and the rest become one `N more reminders` (three notifications at most); a day with three or fewer
 * reminders posts them all.
 */
export function planBillReminders(rules: readonly BillRule[], payments: readonly BillPayment[], today: string, nowMinutes = 0): PlannedReminder[] {
  const paid = new Set(payments.map((p) => `${p.ruleId}|${p.dueDate}`));
  const lastDay = addDays(today, REMINDER_WINDOW_DAYS - 1);
  const slots: { remindOn: string; dueDate: string; rule: BillRule; days: number }[] = [];
  for (const rule of rules) {
    if (rule.remindDays === null || rule.pausedAt !== null || rule.endedAt !== null || rule.removedAt !== null) continue;
    for (const dueDate of ruleOccurrences(rule, today, addDays(lastDay, rule.remindDays))) {
      if (paid.has(`${rule.id}|${dueDate}`)) continue;
      const remindOn = addDays(dueDate, -rule.remindDays);
      if (remindOn < today || remindOn > lastDay) continue;
      if (remindOn === today && nowMinutes >= REMINDER_HOUR * 60) continue;
      slots.push({ remindOn, dueDate, rule, days: rule.remindDays });
    }
  }
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) byDay.set(s.remindOn, [...(byDay.get(s.remindOn) ?? []), s]);
  const out: PlannedReminder[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const list = byDay.get(day)!.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.rule.title < b.rule.title ? -1 : 1));
    const single = list.length <= DAILY_NOTIFICATION_CAP ? list : list.slice(0, DAILY_NOTIFICATION_CAP - 1);
    for (const s of single) out.push({ id: `bill-${s.rule.id}-${s.dueDate}`, remindOn: day, kind: 'bill', ruleId: s.rule.id, title: s.rule.title, dueDate: s.dueDate, relation: relationOf(s.days), moreCount: 0 });
    if (list.length > DAILY_NOTIFICATION_CAP) out.push({ id: overflowId(day), remindOn: day, kind: 'overflow', ruleId: null, title: null, dueDate: null, relation: null, moreCount: list.length - single.length });
  }
  return out;
}

export const overflowId = (day: string): string => `bills-more-${day}`;

const WHEN: Record<Relation, string> = { today: 'due today', tomorrow: 'due tomorrow', in_3_days: 'due in 3 days' };

/** `Rent is due tomorrow` with `Tap to see your bills`; the lock screen says only `Bill reminder`. Never an amount, never a badge. */
export function reminderContent(r: PlannedReminder): NotificationContent {
  const open: Record<string, string> = r.kind === 'bill' ? { screen: 'Bills', ruleId: r.ruleId! } : { screen: 'Bills' };
  return {
    id: r.id,
    channel: 'bill_reminders',
    title: r.kind === 'bill' ? `${r.title} is ${WHEN[r.relation!]}` : r.moreCount === 1 ? '1 more reminder' : `${r.moreCount} more reminders`,
    body: 'Tap to see your bills',
    publicTitle: 'Bill reminder',
    publicBody: 'Tap to see',
    badge: false,
    data: open,
  };
}

async function loadPlan(q: Querier, nowMs: number): Promise<{ plan: PlannedReminder[]; today: string; timezoneId: string } | null> {
  const p = await readPaydayRule(q);
  if (!p) return null;
  const today = toLocalDate(nowMs, p.timezoneId);
  const minutes = localMinutesOfDay(nowMs, p.timezoneId);
  if (!today.ok || !minutes.ok) return null;
  const rules = mapRules(await q.query(RECURRING_RULES_SQL));
  const payments = mapPayments(await q.query(RECURRING_PAYMENTS_SQL));
  return { plan: planBillReminders(rules, payments, today.value, minutes.value), today: today.value, timezoneId: p.timezoneId };
}

/**
 * Makes the scheduled bill reminders exactly the planned ones, replacing whatever was scheduled before, so running it again
 * (a change, the app starting or resuming, a timezone change) is harmless. Without permission or a notifier nothing is
 * scheduled and anything left over is cleared. Returns how many reminders are scheduled.
 */
export async function syncBillReminders(q: Querier, notifier: Notifier, nowMs: number): Promise<number> {
  if (!notifier.available) return 0;
  const loaded = await loadPlan(q, nowMs);
  const granted = (await notifier.permission()) === 'granted';
  if (!loaded || !granted) {
    await notifier.replaceScheduled('bill_reminders', []);
    return 0;
  }
  const items: ScheduledNotification[] = [];
  for (const r of loaded.plan) {
    const at = localToInstant(r.remindOn, REMINDER_HOUR, 0, loaded.timezoneId);
    if (at.ok && at.value > nowMs) items.push({ content: reminderContent(r), atMs: at.value });
  }
  await notifier.replaceScheduled('bill_reminders', items);
  return items.length;
}

/**
 * How many of today's three notification slots bill reminders hold, and how many reminders the overflow stands for. A budget
 * alert arriving when the slots are taken is folded into the overflow instead of being posted on its own.
 */
export async function billSlotsToday(q: Querier, nowMs: number): Promise<{ date: string; taken: number; overflowMore: number } | null> {
  const p = await readPaydayRule(q);
  if (!p) return null;
  const today = toLocalDate(nowMs, p.timezoneId);
  if (!today.ok) return null;
  // The whole day, including a 09:00 that has already passed: those reminders were posted and still hold their slots.
  const rules = mapRules(await q.query(RECURRING_RULES_SQL));
  const payments = mapPayments(await q.query(RECURRING_PAYMENTS_SQL));
  const day = planBillReminders(rules, payments, today.value, 0).filter((r) => r.remindOn === today.value);
  return { date: today.value, taken: day.length, overflowMore: day.find((r) => r.kind === 'overflow')?.moreCount ?? 0 };
}

/** The overflow notification a folded budget alert updates in place: one more reminder than the bills already put in it. */
export function foldedOverflow(date: string, overflowMore: number): NotificationContent {
  return reminderContent({ id: overflowId(date), remindOn: date, kind: 'overflow', ruleId: null, title: null, dueDate: null, relation: null, moreCount: overflowMore + 1 });
}
