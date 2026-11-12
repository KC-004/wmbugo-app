import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { OutboxDispatcher } from '../writer/outbox';
import type { EventEnvelope } from '../writer/events';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { ReverseTransaction } from '../ledger/refunds';
import type { NotificationContent, NotificationPermission, Notifier } from '../ports/notifier';
import { budgetAlertContent, budgetAlertHandlers, EvaluateBudgetAlerts } from './budgetAlerts';
import { SaveBudget, type SaveBudgetInput } from './budgetCommands';
import { budgetFigures } from './budgets';
import { loadBudgetDetail } from './budgetDetail';

const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;

class FakeNotifier implements Notifier {
  available = true;
  granted: NotificationPermission = 'granted';
  posted: NotificationContent[] = [];
  permission = async () => this.granted;
  requestPermission = async () => this.granted;
  post = async (c: NotificationContent) => {
    this.posted.push(c);
  };
  onOpen = () => () => undefined;
}

async function setup(startMs = ist(11, 12)) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(startMs, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(71)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const notifier = new FakeNotifier();
  const handlers = budgetAlertHandlers({ evaluate: () => writer.run(EvaluateBudgetAlerts, {}, 'system'), notifier, db });
  const dispatcher = new OutboxDispatcher({ db, clock, logger: createRedactingLogger({ write: () => undefined }), handlers });
  /** Delivers until nothing is pending (a handler can raise a new event). */
  const deliver = async () => {
    for (let i = 0; i < 5; i++) if ((await dispatcher.deliverPending()).delivered === 0) break;
  };
  const spend = async (amountMinor: number, at: number, categoryId = 'cat_groceries') => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId, merchant: 'Shop', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
    await deliver();
    return r.value.transactionId;
  };
  const base: SaveBudgetInput = { scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 1_000_000, alertLevels: [75, 90, 100] };
  const save = async (over: Partial<SaveBudgetInput> = {}) => {
    const r = await writer.run(SaveBudget, { ...base, ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    await deliver();
    return r.value.budgetId;
  };
  const crossings = async () => (await db.query("SELECT payload_json FROM outbox WHERE event = 'BudgetThresholdCrossed' ORDER BY created_at, rowid")).map((r) => JSON.parse(String(r[0])) as { budgetId: string; periodStart: string; thresholdPct: number });
  const fired = async (id: string) => (await db.query('SELECT period_start, threshold_pct FROM budget_alert_fired WHERE budget_id = ? ORDER BY period_start, threshold_pct', [id])).map((r) => [String(r[0]), Number(r[1])]);
  return { db, clock, writer, accountId, notifier, deliver, spend, save, crossings, fired, dispatcher };
}

describe('budget threshold alerts (Story 4.9, BDG-004)', () => {
  it('a Groceries budget at 74% then one expense to 91% fires exactly one alert, for 90%, and records 75% as fired too', async () => {
    const { save, spend, crossings, fired, notifier } = await setup();
    const id = await save();
    await spend(740_000, ist(11, 3));
    expect(await crossings()).toEqual([]);
    await spend(170_000, ist(11, 4));
    expect(await crossings()).toEqual([{ budgetId: id, periodStart: '2026-11-01', thresholdPct: 90 }]);
    expect(await fired(id)).toEqual([['2026-11-01', 75], ['2026-11-01', 90]]);
    expect(notifier.posted.map((n) => n.body)).toEqual(['Groceries: 90% used this period']);
  });

  it('a refund that drops it to 70% and spending back to 80% fires no 75% alert again this period', async () => {
    const { save, spend, refundOf, crossings, notifier } = await setupWithRefund();
    await save();
    const big = await spend(910_000, ist(11, 3));
    expect((await crossings()).map((c) => c.thresholdPct)).toEqual([90]);
    await refundOf(big, 210_000); // used 700,000: 70%
    await spend(100_000, ist(11, 6)); // 80%: crosses 75% again, already fired
    expect((await crossings()).map((c) => c.thresholdPct)).toEqual([90]);
    expect(notifier.posted).toHaveLength(1);
    // Going on to the limit fires the next level only.
    await spend(200_000, ist(11, 7));
    expect((await crossings()).map((c) => c.thresholdPct)).toEqual([90, 100]);
    expect(notifier.posted.at(-1)!.body).toBe('Groceries: limit reached this period');
  });

  it('is idempotent: evaluating again, or redelivering the event, fires and records nothing new', async () => {
    const { writer, save, spend, crossings, fired, notifier, db } = await setup();
    const id = await save();
    await spend(800_000, ist(11, 3));
    const before = await fired(id);
    for (let i = 0; i < 3; i++) expect(await writer.run(EvaluateBudgetAlerts, {}, 'system')).toMatchObject({ ok: true, value: { fired: [] } });
    expect(await fired(id)).toEqual(before);
    expect(await crossings()).toHaveLength(1);
    // Redelivering the crossing posts the same notification id (it replaces, it does not add).
    const ev = (await db.query("SELECT id, payload_json FROM outbox WHERE event = 'BudgetThresholdCrossed'"))[0]!;
    const handlers = budgetAlertHandlers({ evaluate: async () => undefined, notifier, db });
    const envelope = { id: String(ev[0]), name: 'BudgetThresholdCrossed', actor: 'system', payload: JSON.parse(String(ev[1])), createdAt: 1 } as unknown as EventEnvelope;
    await handlers.BudgetThresholdCrossed[0]!(envelope);
    expect(new Set(notifier.posted.map((n) => n.id)).size).toBe(1);
  });

  it('a reversal on 2 Nov of a 30 Oct payment fires nothing for October and leaves October correct', async () => {
    const { db, writer, clock, save, spend, crossings, fired, deliver, notifier } = await setup(ist(10, 20));
    const id = await save({ periodRule: 'monthly' });
    const oct = await spend(900_000, ist(10, 30));
    expect((await crossings()).map((c) => c.thresholdPct)).toEqual([90]);
    expect(await fired(id)).toEqual([['2026-10-01', 75], ['2026-10-01', 90]]);
    const posted = notifier.posted.length;
    clock.advance(Date.UTC(2026, 10, 2, 5) - clock.nowMs()); // 2 Nov
    expect((await writer.run(ReverseTransaction, { transactionId: oct }, 'user')).ok).toBe(true);
    await deliver();
    expect(await fired(id)).toEqual([['2026-10-01', 75], ['2026-10-01', 90]]); // nothing new, nothing for November
    expect((await crossings()).map((c) => c.thresholdPct)).toEqual([90]);
    expect(notifier.posted).toHaveLength(posted);
    // October's totals are correct: the reversed payment no longer counts there.
    const budget = { id, scope: 'category' as const, categoryIds: ['cat_groceries'], budgetType: null, accountIds: null, period: { rule: 'monthly' as const } };
    expect((await budgetFigures(db, budget, { start: '2026-10-01', end: '2026-10-31' })).usedMinor).toBe(0);
  });

  it('a TransactionsChanged event flagged closedPeriodTouched is not evaluated at all', async () => {
    const { db, save, notifier } = await setup();
    await save();
    let evaluated = 0;
    const handlers = budgetAlertHandlers({ evaluate: async () => void (evaluated += 1), notifier, db });
    const ev = (closed: boolean) => ({ id: 'e', name: 'TransactionsChanged', actor: 'user', payload: { transactionIds: ['x'], ...(closed ? { closedPeriodTouched: true } : {}) }, createdAt: 1 }) as unknown as EventEnvelope;
    await handlers.TransactionsChanged[0]!(ev(true));
    expect(evaluated).toBe(0);
    await handlers.TransactionsChanged[0]!(ev(false));
    expect(evaluated).toBe(1);
  });

  it('a new period starts fresh: the same level can fire once in each period', async () => {
    const { save, spend, crossings, clock, fired } = await setup(ist(10, 12));
    const id = await save();
    await spend(800_000, ist(10, 15));
    clock.advance(Date.UTC(2026, 10, 5, 5) - clock.nowMs());
    await spend(800_000, ist(11, 5));
    expect(await fired(id)).toEqual([['2026-10-01', 75], ['2026-11-01', 75]]);
    expect((await crossings()).map((c) => c.periodStart)).toEqual(['2026-10-01', '2026-11-01']);
  });
});

describe('muting, permission and wording (Story 4.9)', () => {
  it('a muted budget records its crossings but posts nothing and raises no event; unmuting never back-fires them', async () => {
    const { db, save, spend, crossings, fired, notifier } = await setup();
    const id = await save({ muted: true });
    await spend(950_000, ist(11, 3));
    expect(await fired(id)).toEqual([['2026-11-01', 75], ['2026-11-01', 90]]);
    expect(await crossings()).toEqual([]);
    expect(notifier.posted).toEqual([]);
    await save({ id, muted: false });
    expect(await crossings()).toEqual([]);
    // The next level is a fresh crossing and does alert.
    await spend(100_000, ist(11, 5));
    expect((await crossings()).map((c) => c.thresholdPct)).toEqual([100]);
    expect(Number((await db.query('SELECT muted FROM budget WHERE id = ?', [id]))[0]![0])).toBe(0);
  });

  it('deselecting every Alert me at chip mutes the budget', async () => {
    const { db, save, spend, crossings } = await setup();
    const id = await save({ alertLevels: [] });
    expect(Number((await db.query('SELECT muted FROM budget WHERE id = ?', [id]))[0]![0])).toBe(1);
    await spend(950_000, ist(11, 3));
    expect(await crossings()).toEqual([]);
  });

  it('with permission denied, or a notifier that is not available, nothing is posted, but the crossing is recorded', async () => {
    const { save, spend, notifier, fired } = await setup();
    notifier.granted = 'denied';
    const id = await save();
    await spend(800_000, ist(11, 3));
    expect(notifier.posted).toEqual([]);
    expect(await fired(id)).toEqual([['2026-11-01', 75]]);
    notifier.granted = 'granted';
    notifier.available = false;
    await spend(150_000, ist(11, 4));
    expect(notifier.posted).toEqual([]);
  });

  it('the notification never contains an amount, is neutral, has no badge and a generic lock-screen version', () => {
    for (const pct of [75, 80, 90, 100]) {
      const n = budgetAlertContent({ budgetId: 'b1', periodStart: '2026-11-01', name: 'Groceries', thresholdPct: pct });
      const all = `${n.title} ${n.body} ${n.publicTitle} ${n.publicBody}`;
      expect(all).not.toMatch(/[₹$€£]|\bRs\b|rupee|\d{3,}/i);
      expect(all).not.toMatch(/overspent|!|exceed/i);
      expect(n.badge).toBe(false);
      expect(n.channel).toBe('budget_alerts');
      expect([n.publicTitle, n.publicBody].join(' · ')).toBe('Budget update · Tap to see');
      expect(n.data).toEqual({ screen: 'BudgetDetail', budgetId: 'b1', periodStart: '2026-11-01' });
    }
    expect(budgetAlertContent({ budgetId: 'b1', periodStart: '2026-11-01', name: 'Groceries', thresholdPct: 90 }).body).toBe('Groceries: 90% used this period');
    expect(budgetAlertContent({ budgetId: 'b1', periodStart: '2026-11-01', name: 'Groceries', thresholdPct: 100 }).body).toBe('Groceries: limit reached this period');
  });

  it('tapping opens that budget and period: the detail loads by period start with its contributing entries', async () => {
    const { db, clock, save, spend } = await setup(ist(10, 12));
    const id = await save();
    await spend(800_000, ist(10, 15));
    clock.advance(Date.UTC(2026, 10, 12, 5) - clock.nowMs());
    const d = await loadBudgetDetail(db, id, '2026-10-01', clock.nowMs());
    expect(d).toMatchObject({ periodLabel: '1–31 Oct', back: 1, usedMinor: 800_000 });
    expect(d !== 'missing' && d !== null && d.entries).toHaveLength(1);
    expect(await loadBudgetDetail(db, id, '2026-11-01', clock.nowMs())).toMatchObject({ back: 0, isCurrent: true });
    expect(await loadBudgetDetail(db, id, '2025-01-01', clock.nowMs())).toBe('missing');
  });
});

/** The base setup plus a refund helper. */
async function setupWithRefund() {
  const s = await setup();
  const refundOf = async (originalId: string, amountMinor: number) => {
    s.clock.advance(1000);
    const r = await s.writer.run(SubmitCapture, { submissionId: `rf-${originalId}-${amountMinor}`, sourceKind: 'manual', refund: { originalId, amountMinor, recoveryKind: 'refund' } }, 'user');
    if (!r.ok) throw new Error(r.code);
    await s.deliver();
  };
  return { ...s, refundOf };
}
