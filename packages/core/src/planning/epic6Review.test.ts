import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SubmitCapture } from '../capture/submitCapture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { homeSavingsGoal } from '../insights/homeBillsGoals';
import { DismissBillMatch, findBillMatch, LinkBillPayment } from './billLinks';
import { loadBillsList } from './billsList';
import { goalProgress, loadGoals, SaveGoal, SetAsideForGoal, TakeBackFromGoal, UndoGoalAllocation, CountTowardGoal } from './goals';
import { EndRecurringRule, MarkBillPaid, PauseRecurringRule, ResumeRecurringRule, SaveRecurringRule, type SaveRecurringRuleInput } from './recurringCommands';
import { loadBillOccurrences } from './recurringStore';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 11, 3, 10, 0, 0); // 3 Dec 2026
const at = (month: number, day: number) => Date.UTC(2026, month - 1, day, 9, 0, 0) - 5.5 * 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(91)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const acc = async (name: string, type: 'bank' | 'savings_pot', openingMinor = 0) => {
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error(a.code);
    return a.value.accountId;
  };
  const hdfc = await acc('HDFC', 'bank', 100_000_000);
  const sip = await acc('SIP', 'savings_pot');
  const other = await acc('Other pot', 'savings_pot');
  const rule = async (over: Partial<SaveRecurringRuleInput> = {}) => {
    const r = await writer.run(SaveRecurringRule, { title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', accountId: hdfc, categoryId: 'cat_housing', kind: 'rent', paidTo: 'Ramesh Kumar', ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  const goal = async (over: { name?: string; accountId?: string | null } = {}) => {
    const r = await writer.run(SaveGoal, { name: over.name ?? 'Goa trip', targetMinor: 3_000_000, dueMonth: '2027-03', icon: 'Airplane', color: 'cat-cyan', accountId: over.accountId === undefined ? sip : over.accountId }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.goalId;
  };
  let n = 0;
  const move = (amountMinor: number, goalId?: string, to = sip) => writer.run(SubmitCapture, { submissionId: `mv-${++n}`, sourceKind: 'manual', transfer: { amountMinor, fromAccountId: hdfc, toAccountId: to }, ...(goalId ? { goalId } : {}) }, 'user');
  const spend = async (over: { amountMinor?: number; when?: number; status?: 'needs_review' } = {}) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: over.amountMinor ?? 1_800_000, categoryId: 'cat_housing', accountId: hdfc, merchant: 'Ramesh Kumar', occurredAtMs: over.when ?? at(12, 4) });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  return { db, clock, writer, hdfc, sip, other, rule, goal, move, spend };
}

describe('pausing a bill more than once (review D1)', () => {
  it('keeps the dates skipped in the first pause skipped after a second pause and resume', async () => {
    const { db, clock, writer, rule } = await setup();
    const id = await rule({ cadence: 'weekly', anchorDate: '2026-12-03' });
    expect((await writer.run(PauseRecurringRule, { ruleId: id }, 'user')).ok).toBe(true); // 3 Dec
    clock.advance(8 * DAY);
    expect((await writer.run(ResumeRecurringRule, { ruleId: id }, 'user')).ok).toBe(true); // 11 Dec
    clock.advance(4 * DAY);
    expect((await writer.run(PauseRecurringRule, { ruleId: id }, 'user')).ok).toBe(true); // 15 Dec
    clock.advance(9 * DAY);
    expect((await writer.run(ResumeRecurringRule, { ruleId: id }, 'user')).ok).toBe(true); // 24 Dec
    const dates = (await loadBillOccurrences(db, clock.nowMs(), '2026-12-01', '2026-12-31')).map((o) => o.dueDate);
    // 3 and 10 Dec fall in the first gap, 17 Dec in the second; only 24 and 31 Dec are real due dates.
    expect(dates).toEqual(['2026-12-24', '2026-12-31']);
  });

  it('ending a paused bill keeps the paused dates skipped instead of showing them as unpaid history', async () => {
    const { db, clock, writer, rule } = await setup();
    const id = await rule({ cadence: 'weekly', anchorDate: '2026-12-03' });
    await writer.run(PauseRecurringRule, { ruleId: id }, 'user'); // 3 Dec
    clock.advance(15 * DAY);
    expect((await writer.run(EndRecurringRule, { ruleId: id }, 'user')).ok).toBe(true); // 18 Dec
    const dates = (await loadBillOccurrences(db, clock.nowMs(), '2026-12-01', '2026-12-31')).map((o) => o.dueDate);
    expect(dates).toEqual([]);
  });
});

describe('a bill whose end date has passed (review D3)', () => {
  it('reads Ended and is left out of the subscriptions total without anyone pressing End', async () => {
    const { db, clock, rule } = await setup();
    await rule({ title: 'Netflix', kind: 'subscription', anchorDate: '2026-11-01', endsOn: '2026-11-30', paidTo: null });
    await rule({ title: 'Spotify', kind: 'subscription', anchorDate: '2026-12-10', paidTo: null });
    const list = (await loadBillsList(db, clock.nowMs()))!;
    expect(list.ended.map((b) => b.title)).toEqual(['Netflix']);
    expect(list.active.map((b) => b.title)).toEqual(['Spotify']);
    expect(list.subscriptions.counted).toBe(1);
  });
});

describe('findBillMatch leaves out what cannot be paid (review)', () => {
  it('skips a paused rule, an ended rule and a due date that is already paid, and still offers a waiting entry', async () => {
    const { db, writer, rule, spend } = await setup();
    const paused = await rule({ title: 'Rent paused' });
    await writer.run(PauseRecurringRule, { ruleId: paused }, 'user');
    expect(await findBillMatch(db, await spend())).toBeNull();
    const ended = await rule({ title: 'Rent ended' });
    await writer.run(EndRecurringRule, { ruleId: ended }, 'user');
    expect(await findBillMatch(db, await spend())).toBeNull();
    const live = await rule({ title: 'Rent live' });
    const tx = await spend();
    expect((await findBillMatch(db, tx))?.ruleId).toBe(live);
    await writer.run(MarkBillPaid, { ruleId: live, dueDate: '2026-12-05' }, 'user');
    expect(await findBillMatch(db, tx)).toBeNull();
  });
});

describe('DismissBillMatch (review)', () => {
  it('raises RecurringChanged so the prompt goes away at once, and refuses an unknown entry', async () => {
    const { db, writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    expect((await writer.run(DismissBillMatch, { ruleId: id, transactionId: 'nope' }, 'user')).ok).toBe(false);
    expect((await writer.run(DismissBillMatch, { ruleId: id, transactionId: tx }, 'user')).ok).toBe(true);
    expect((await db.query("SELECT event FROM outbox WHERE event = 'RecurringChanged'")).length).toBeGreaterThan(0);
  });

  it('LinkBillPayment refuses an excluded entry', async () => {
    const { db, writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    db.raw.exec(`UPDATE "transaction" SET status = 'excluded' WHERE id = '${tx}'`);
    expect(await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user')).toMatchObject({ ok: false, code: 'NOT_AN_EXPENSE' });
  });
});

describe('goal rules (review)', () => {
  it('refuses a name over 40 characters', async () => {
    const { writer } = await setup();
    const r = await writer.run(SaveGoal, { name: 'x'.repeat(41), targetMinor: 1000, icon: 'Airplane', color: 'cat-cyan' }, 'user');
    expect(r).toMatchObject({ ok: false, code: 'NAME_TOO_LONG' });
  });

  it('undoing a set-aside is refused once a move has replaced part of it, so nothing goes below zero', async () => {
    const { db, writer, goal, move } = await setup();
    const id = await goal();
    const a = await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    if (!a.ok) throw new Error('set aside');
    expect((await move(300_000, id)).ok).toBe(true); // replaces 300,000 of the 500,000
    expect((await loadGoals(db))[0]!.setAsideMinor).toBe(200_000);
    expect(await writer.run(UndoGoalAllocation, { allocationId: a.value.allocationId }, 'user')).toMatchObject({ ok: false, code: 'PART_MOVED' });
    expect((await loadGoals(db))[0]!.setAsideMinor).toBe(200_000);
  });

  it('a move into a different pot than the goal names is refused and the transfer rolls back; one into its own pot counts', async () => {
    const { db, goal, move, other } = await setup();
    const id = await goal();
    expect(await move(100_000, id, other)).toMatchObject({ ok: false, code: 'NOT_GOALS_ACCOUNT' });
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction" WHERE event_type = \'transfer\''))[0]![0])).toBe(0);
    expect((await move(100_000, id)).ok).toBe(true);
  });

  it('a goal tag on an entry is refused, not silently dropped', async () => {
    const { writer, hdfc, goal } = await setup();
    const id = await goal();
    const r = await writer.run(SubmitCapture, { submissionId: 'e1', sourceKind: 'manual', goalId: id, entry: { kind: 'expense', amountMinor: 1000, categoryId: 'cat_housing', accountId: hdfc } }, 'user');
    expect(r).toMatchObject({ ok: false, code: 'SUBMISSION_INVALID' });
  });

  it('counting a transfer toward a goal still works for a waiting move (it counts once confirmed)', async () => {
    const { writer, goal, move } = await setup();
    const id = await goal();
    const m = await move(100_000);
    if (!m.ok) throw new Error('move');
    expect((await writer.run(CountTowardGoal, { transactionId: m.value.transactionId, goalId: id }, 'user')).ok).toBe(true);
  });

  it('shows no pace when the target is more than a century away', () => {
    const p = goalProgress({ contributedMinor: 200, remainingMinor: 99_000_000 }, ['2026-01-01', '2026-03-01'], '2026-12-03');
    expect(p.pace).toBeNull();
  });
});

describe('the Home goal pick when none has a date (review)', () => {
  it('goes by the latest set-aside or counted move, never by a take-back', async () => {
    const { db, clock, writer, goal } = await setup();
    // Two goals without a date: the second gets the newest set-aside, the first only a later take-back.
    const make = async (name: string) => {
      const r = await writer.run(SaveGoal, { name, targetMinor: 3_000_000, icon: 'Airplane', color: 'cat-cyan' }, 'user');
      if (!r.ok) throw new Error(r.code);
      return r.value.goalId;
    };
    expect(goal).toBeDefined();
    const a = await make('A');
    const b = await make('B');
    await writer.run(SetAsideForGoal, { goalId: a, amountMinor: 100_000 }, 'user');
    clock.advance(1000);
    await writer.run(SetAsideForGoal, { goalId: b, amountMinor: 100_000 }, 'user');
    clock.advance(1000);
    await writer.run(TakeBackFromGoal, { goalId: a, amountMinor: 50_000 }, 'user');
    const pick = await homeSavingsGoal(db, clock.nowMs());
    expect(pick?.goal.name).toBe('B');
  });
});
