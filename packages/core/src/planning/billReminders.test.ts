import { FakeClock, localMinutesOfDay, localToInstant } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import type { EventEnvelope } from '../writer/events';
import { openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import type { NotificationContent, NotificationPermission, Notifier, ScheduledNotification } from '../ports/notifier';
import { billSlotsToday, foldedOverflow, planBillReminders, reminderContent, syncBillReminders } from './billReminders';
import { budgetAlertHandlers } from './budgetAlerts';
import { MarkBillPaid, PauseRecurringRule, SaveRecurringRule, type SaveRecurringRuleInput } from './recurringCommands';
import { loadBillDetail } from './billsList';
import type { BillPayment, BillRule } from './recurring';

const rule = (over: Partial<BillRule> = {}): BillRule => ({
  id: 'r1', title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', customEvery: null, customUnit: null, anchorDate: '2026-12-05', accountId: null, categoryId: null, kind: 'rent', paidTo: null,
  endsOn: null, pausedAt: null, pausedOn: null, resumedOn: null, endedAt: null, endedOn: null, removedAt: null, remindDays: 1, ...over,
});
const paid = (dueDate: string, ruleId = 'r1'): BillPayment => ({ ruleId, dueDate, kind: 'marked', transactionId: null, recordedAt: 1 });
const summary = (list: ReturnType<typeof planBillReminders>) => list.map((r) => [r.remindOn, r.kind === 'bill' ? r.title : `+${r.moreCount}`]);

describe('local time helpers', () => {
  it('9:00 in Kolkata is 03:30 UTC, and daylight saving moves New York by an hour', () => {
    expect(localToInstant('2026-12-05', 9, 0, 'Asia/Kolkata')).toEqual({ ok: true, value: Date.UTC(2026, 11, 5, 3, 30) });
    expect(localToInstant('2026-03-07', 9, 0, 'America/New_York')).toEqual({ ok: true, value: Date.UTC(2026, 2, 7, 14) });
    expect(localToInstant('2026-03-09', 9, 0, 'America/New_York')).toEqual({ ok: true, value: Date.UTC(2026, 2, 9, 13) });
    expect(localToInstant('2026-12-05', 9, 0, 'Nowhere/Land')).toMatchObject({ ok: false });
    expect(localMinutesOfDay(Date.UTC(2026, 11, 5, 3, 30), 'Asia/Kolkata')).toEqual({ ok: true, value: 9 * 60 });
  });
});

describe('planBillReminders (Story 6.5, REC-003)', () => {
  it('plans the day before at 9, the day of, or 3 days before, and skips what is paid, paused, ended, off or too far', () => {
    expect(summary(planBillReminders([rule()], [], '2026-12-03'))).toEqual([['2026-12-04', 'Rent']]);
    expect(summary(planBillReminders([rule({ remindDays: 0 })], [], '2026-12-03'))).toEqual([['2026-12-05', 'Rent']]);
    expect(planBillReminders([rule({ remindDays: 3 })], [], '2026-12-03')).toEqual([]); // its 2 Dec reminder is in the past
    expect(summary(planBillReminders([rule({ remindDays: 3, anchorDate: '2026-12-08' })], [], '2026-12-03'))).toEqual([['2026-12-05', 'Rent']]);
    expect(planBillReminders([rule()], [paid('2026-12-05')], '2026-12-03')).toEqual([]); // 5 Dec is paid, 5 Jan is beyond 14 days
    expect(planBillReminders([rule({ remindDays: null })], [], '2026-12-03')).toEqual([]);
    expect(planBillReminders([rule({ pausedAt: 1, pausedOn: '2026-12-01' })], [], '2026-12-03')).toEqual([]);
    expect(planBillReminders([rule({ endedAt: 1, endedOn: '2026-12-01' })], [], '2026-12-03')).toEqual([]);
    expect(planBillReminders([rule({ anchorDate: '2026-12-30' })], [], '2026-12-03')).toEqual([]); // beyond 14 days
  });

  it('a 9:00 that has already passed today is not planned', () => {
    const r = rule({ remindDays: 0, anchorDate: '2026-12-03' });
    expect(planBillReminders([r], [], '2026-12-03', 8 * 60)).toHaveLength(1);
    expect(planBillReminders([r], [], '2026-12-03', 9 * 60)).toHaveLength(0);
  });

  it('five reminders on one day post the two earliest due dates and one "3 more reminders"; three post all three', () => {
    const five = ['Aa', 'Bb', 'Cc', 'Dd', 'Ee'].map((t, i) => rule({ id: `r${i}`, title: t }));
    const list = planBillReminders(five, [], '2026-12-03');
    expect(summary(list)).toEqual([['2026-12-04', 'Aa'], ['2026-12-04', 'Bb'], ['2026-12-04', '+3']]);
    expect(list[2]).toMatchObject({ kind: 'overflow', id: 'bills-more-2026-12-04' });
    expect(summary(planBillReminders(five.slice(0, 3), [], '2026-12-03'))).toEqual([['2026-12-04', 'Aa'], ['2026-12-04', 'Bb'], ['2026-12-04', 'Cc']]);
  });
});

describe('reminderContent', () => {
  it('reads "Rent is due tomorrow" with no amount, no badge and a generic lock screen', () => {
    const [r] = planBillReminders([rule()], [], '2026-12-03');
    const c = reminderContent(r!);
    expect(c).toEqual({ id: 'bill-r1-2026-12-05', channel: 'bill_reminders', title: 'Rent is due tomorrow', body: 'Tap to see your bills', publicTitle: 'Bill reminder', publicBody: 'Tap to see', badge: false, data: { screen: 'Bills', ruleId: 'r1' } });
    expect(`${c.title} ${c.body} ${c.publicTitle} ${c.publicBody}`).not.toMatch(/[0-9₹]/);
    expect(reminderContent(planBillReminders([rule({ remindDays: 0 })], [], '2026-12-04')[0]!).title).toBe('Rent is due today');
    expect(reminderContent(planBillReminders([rule({ remindDays: 3, anchorDate: '2026-12-08' })], [], '2026-12-03')[0]!).title).toBe('Rent is due in 3 days');
  });
});

class FakeNotifier implements Notifier {
  available = true;
  granted: NotificationPermission = 'granted';
  posted: NotificationContent[] = [];
  scheduled: ScheduledNotification[] = [];
  calls = 0;
  permission = async () => this.granted;
  requestPermission = async () => this.granted;
  post = async (c: NotificationContent) => {
    this.posted.push(c);
  };
  replaceScheduled = async (_channel: NotificationContent['channel'], items: readonly ScheduledNotification[]) => {
    this.calls += 1;
    this.scheduled = [...items];
  };
  onOpen = () => () => undefined;
}

const NOW = Date.UTC(2026, 11, 3, 2, 0, 0); // 3 Dec 2026, 07:30 in Kolkata

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(65)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  const save = async (over: Partial<SaveRecurringRuleInput> = {}) => {
    const r = await writer.run(SaveRecurringRule, { title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', kind: 'rent', ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  return { db, clock, writer, save, notifier: new FakeNotifier() };
}

describe('syncBillReminders', () => {
  it('a new bill defaults to 1 day before, schedules 09:00 local, and running it again changes nothing', async () => {
    const { db, save, notifier } = await setup();
    const id = await save();
    expect(await syncBillReminders(db, notifier, NOW)).toBe(1);
    expect(notifier.scheduled).toHaveLength(1);
    expect(notifier.scheduled[0]).toMatchObject({ atMs: Date.UTC(2026, 11, 4, 3, 30), content: { id: `bill-${id}-2026-12-05`, title: 'Rent is due tomorrow' } });
    const first = JSON.stringify(notifier.scheduled);
    await syncBillReminders(db, notifier, NOW);
    expect(JSON.stringify(notifier.scheduled)).toBe(first);
  });

  it('a paid, paused or switched-off bill schedules nothing', async () => {
    const { db, writer, save, notifier } = await setup();
    const a = await save({ title: 'A' });
    const b = await save({ title: 'B' });
    await save({ title: 'C', remindDays: null });
    await writer.run(MarkBillPaid, { ruleId: a, dueDate: '2026-12-05' }, 'user');
    await writer.run(PauseRecurringRule, { ruleId: b }, 'user');
    expect(await syncBillReminders(db, notifier, NOW)).toBe(0);
    expect(notifier.scheduled).toEqual([]);
  });

  it('without permission or a notifier it schedules nothing and clears what was left', async () => {
    const { db, save, notifier } = await setup();
    await save();
    await syncBillReminders(db, notifier, NOW);
    notifier.granted = 'denied';
    expect(await syncBillReminders(db, notifier, NOW)).toBe(0);
    expect(notifier.scheduled).toEqual([]);
    notifier.available = false;
    notifier.calls = 0;
    expect(await syncBillReminders(db, notifier, NOW)).toBe(0);
    expect(notifier.calls).toBe(0);
  });

  it('an edit keeps the reminder setting unless it is given, and turning it off clears the schedule', async () => {
    const { db, save, notifier } = await setup();
    const id = await save({ remindDays: 3 });
    await save({ id, title: 'Rent', anchorDate: '2026-12-08' });
    const d = (await loadBillDetail(db, NOW, id)) as { rule: BillRule };
    expect(d.rule.remindDays).toBe(3);
    await save({ id, anchorDate: '2026-12-08', remindDays: null });
    await syncBillReminders(db, notifier, NOW);
    expect(notifier.scheduled).toEqual([]);
  });

  it('refuses a reminder setting other than on the day, 1 or 3 days before', async () => {
    const { writer } = await setup();
    const r = await writer.run(SaveRecurringRule, { title: 'Rent', expectedAmountMinor: 100, cadence: 'monthly', anchorDate: '2026-12-05', kind: 'rent', remindDays: 2 as never }, 'user');
    expect(r).toMatchObject({ ok: false, code: 'REMIND_INVALID' });
  });
});

describe('bills before budget alerts (SET-003)', () => {
  it('with three bill reminders today a budget alert is folded into the "more reminders" notification, not posted on its own', async () => {
    const { db, clock, save, notifier } = await setup();
    clock.set(Date.UTC(2026, 11, 4, 1, 0)); // 4 Dec, 06:30 Kolkata
    for (const t of ['A', 'B', 'C', 'D']) await save({ title: t });
    expect(await billSlotsToday(db, clock.nowMs())).toEqual({ date: '2026-12-04', taken: 3, overflowMore: 2 });
    await db.query("INSERT INTO budget (id, name, scope, scope_category_ids, period_rule, alert_rule, muted, created_at) VALUES ('b1', 'Groceries', 'overall', '[]', 'default', '[75]', 0, 1)");
    const handlers = budgetAlertHandlers({ evaluate: async () => undefined, notifier, db, nowMs: () => clock.nowMs() });
    const event = { id: 'e1', name: 'BudgetThresholdCrossed', actor: 'system', payload: { budgetId: 'b1', periodStart: '2026-12-01', thresholdPct: 75 }, createdAt: 1 } as unknown as EventEnvelope;
    await handlers.BudgetThresholdCrossed[0]!(event);
    expect(notifier.posted).toHaveLength(1);
    expect(notifier.posted[0]).toMatchObject({ id: 'bills-more-2026-12-04', title: '3 more reminders', channel: 'bill_reminders' });
    expect(foldedOverflow('2026-12-04', 2).title).toBe('3 more reminders');
  });

  it('with a free slot the budget alert posts on its own', async () => {
    const { db, clock, save, notifier } = await setup();
    clock.set(Date.UTC(2026, 11, 4, 1, 0));
    await save({ title: 'A' });
    await db.query("INSERT INTO budget (id, name, scope, scope_category_ids, period_rule, alert_rule, muted, created_at) VALUES ('b1', 'Groceries', 'overall', '[]', 'default', '[75]', 0, 1)");
    const handlers = budgetAlertHandlers({ evaluate: async () => undefined, notifier, db, nowMs: () => clock.nowMs() });
    await handlers.BudgetThresholdCrossed[0]!({ id: 'e1', name: 'BudgetThresholdCrossed', actor: 'system', payload: { budgetId: 'b1', periodStart: '2026-12-01', thresholdPct: 75 }, createdAt: 1 } as unknown as EventEnvelope);
    expect(notifier.posted[0]).toMatchObject({ channel: 'budget_alerts', title: 'Budget update' });
  });
});
