import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { ChangeGoalState, SaveGoal, SetAsideForGoal } from '../planning/goals';
import { MarkBillPaid, SaveRecurringRule } from '../planning/recurringCommands';
import { homeComingUp, homeSavingsGoal } from './homeBillsGoals';

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0); // 12 Nov 2026

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(70)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  const bill = async (title: string, anchorDate: string) => {
    const r = await writer.run(SaveRecurringRule, { title, expectedAmountMinor: 100_000, cadence: 'monthly', anchorDate, kind: 'other' }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  const goal = async (name: string, dueMonth: string | null) => {
    const r = await writer.run(SaveGoal, { name, targetMinor: 3_000_000, dueMonth, icon: 'Airplane', color: 'cat-cyan' }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.goalId;
  };
  return { db, clock, writer, bill, goal };
}

describe('homeComingUp (Story 6.10)', () => {
  it('is not there without an active bill', async () => {
    const { db } = await setup();
    expect(await homeComingUp(db, NOW)).toBeNull();
  });

  it('lists up to three unpaid bills in the period, soonest first, with +N more, and leaves out paid ones', async () => {
    const { db, writer, bill } = await setup();
    const paid = await bill('Paid', '2026-11-13');
    for (const [t, d] of [['E', '2026-11-16'], ['A', '2026-11-14'], ['C', '2026-11-18'], ['B', '2026-11-15'], ['D', '2026-11-17']] as const) await bill(t, d);
    await writer.run(MarkBillPaid, { ruleId: paid, dueDate: '2026-11-13' }, 'user');
    const c = (await homeComingUp(db, NOW))!;
    expect(c.items.map((i) => i.title)).toEqual(['A', 'B', 'E']);
    expect(c.moreCount).toBe(2);
    expect(c.payCycle).toBe(true);
  });

  it('with bills but none due before the period ends it has no rows', async () => {
    const { db, bill } = await setup();
    await bill('Rent', '2026-12-05');
    expect(await homeComingUp(db, NOW)).toMatchObject({ items: [], moreCount: 0 });
  });
});

describe('homeSavingsGoal (Story 6.10)', () => {
  it('is not there without an active goal, and a paused or completed goal does not count', async () => {
    const { db, writer, goal } = await setup();
    expect(await homeSavingsGoal(db, NOW)).toBeNull();
    const g = await goal('Only', null);
    await writer.run(ChangeGoalState, { goalId: g, to: 'paused' }, 'user');
    expect(await homeSavingsGoal(db, NOW)).toBeNull();
  });

  it('picks the goal with the nearest By date, else the most recently contributed, and counts the others', async () => {
    const { db, clock, writer, goal } = await setup();
    const far = await goal('Far', '2027-09');
    const near = await goal('Near', '2027-03');
    await goal('Undated', null);
    expect(await homeSavingsGoal(db, NOW)).toMatchObject({ goal: { id: near }, moreCount: 2 });
    await writer.run(ChangeGoalState, { goalId: near, to: 'archived' }, 'user');
    expect((await homeSavingsGoal(db, NOW))!.goal.id).toBe(far);
    await writer.run(ChangeGoalState, { goalId: far, to: 'completed' }, 'user');
    const a = await goal('A', null);
    const b = await goal('B', null);
    clock.advance(1000);
    await writer.run(SetAsideForGoal, { goalId: a, amountMinor: 100 }, 'user');
    clock.advance(1000);
    await writer.run(SetAsideForGoal, { goalId: b, amountMinor: 100 }, 'user');
    clock.advance(1000);
    await writer.run(SetAsideForGoal, { goalId: a, amountMinor: 100 }, 'user');
    expect((await homeSavingsGoal(db, clock.nowMs()))!.goal.id).toBe(a);
  });
});
