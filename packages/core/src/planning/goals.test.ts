import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from '../ledger/accounts';
import { homeSummary } from '../insights/homeSummary';
import { ChangeGoalState, loadGoalDetail, loadGoals, parseExceedsSetAside, SaveGoal, SetAsideForGoal, setAsideTotal, TakeBackFromGoal, UndoAddGoal, UndoGoalAllocation, type SaveGoalInput } from './goals';
import { SaveBudget } from './budgetCommands';

const NOW = Date.UTC(2026, 10, 9, 10, 0, 0); // 9 Nov 2026

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(66)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const base: SaveGoalInput = { name: 'Goa trip', targetMinor: 3_000_000, dueMonth: '2027-03', icon: 'Airplane', color: 'cat-cyan' };
  const save = (over: Partial<SaveGoalInput> = {}) => writer.run(SaveGoal, { ...base, ...over }, 'user');
  const goal = async (over: Partial<SaveGoalInput> = {}) => {
    const r = await save(over);
    if (!r.ok) throw new Error(r.code);
    return r.value.goalId;
  };
  return { db, clock, writer, accountId: a.value.accountId, save, goal };
}

describe('SaveGoal (Story 6.6)', () => {
  it('saves Goa trip, ₹30,000, by March 2027, with audit and GoalsChanged, and moves nothing', async () => {
    const { db, save, accountId } = await setup();
    await db.query('DELETE FROM outbox');
    const postings = Number((await db.query('SELECT COUNT(*) FROM posting'))[0]![0]);
    const r = await save({ accountId });
    expect(r).toMatchObject({ ok: true, value: { created: true } });
    const goals = await loadGoals(db);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ name: 'Goa trip', targetMinor: 3_000_000, dueDate: '2027-03-01', state: 'active', setAsideMinor: 0, contributedMinor: 0, remainingMinor: 3_000_000, funded: false, accountName: 'HDFC' });
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'SaveGoal'"))[0]![0])).toBe(1);
    expect((await db.query('SELECT event FROM outbox')).map((x) => String(x[0]))).toContain('GoalsChanged');
    expect(Number((await db.query('SELECT COUNT(*) FROM posting'))[0]![0])).toBe(postings);
  });

  it('refuses an empty name, no amount, a past month, an unknown colour and an unknown account, and writes nothing', async () => {
    const { db, save } = await setup();
    expect(await save({ name: ' ' })).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
    expect(await save({ targetMinor: 0 })).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await save({ dueMonth: '2026-10' })).toMatchObject({ ok: false, code: 'DATE_PAST' });
    expect(await save({ dueMonth: '2026-13' })).toMatchObject({ ok: false, code: 'DATE_INVALID' });
    expect(await save({ color: 'red' })).toMatchObject({ ok: false, code: 'COLOR_INVALID' });
    expect(await save({ accountId: 'nope' })).toMatchObject({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await save({ id: 'nope' })).toMatchObject({ ok: false, code: 'GOAL_NOT_FOUND' });
    expect((await save({ dueMonth: '2026-11' })).ok).toBe(true); // this month is allowed
    expect(await loadGoals(db)).toHaveLength(1);
  });

  it('edits in place, and an edit that keeps a month now past is not refused', async () => {
    const { clock, db, goal, save } = await setup();
    const id = await goal();
    clock.set(Date.UTC(2027, 4, 1)); // May 2027: March is past
    expect((await save({ id, name: 'Goa holiday' })).ok).toBe(true);
    expect((await loadGoals(db))[0]!.name).toBe('Goa holiday');
    expect(await save({ id, dueMonth: '2027-04' })).toMatchObject({ ok: false, code: 'DATE_PAST' });
  });

  it('Undo of adding removes an empty goal and archives one that has contributions', async () => {
    const { db, writer, goal } = await setup();
    const a = await goal();
    const b = await goal({ name: 'Bike' });
    await writer.run(SetAsideForGoal, { goalId: b, amountMinor: 100 }, 'user');
    await writer.run(UndoAddGoal, { goalId: a }, 'user');
    await writer.run(UndoAddGoal, { goalId: b }, 'user');
    const rest = await loadGoals(db);
    expect(rest.map((g) => [g.name, g.state])).toEqual([['Bike', 'archived']]);
  });
});

describe('Set aside and take back (GOAL-002)', () => {
  it('set aside shows 5,000 of 30,000 and changes no balance, In accounts, spending, budget or Home figure', async () => {
    const snapshot = async (aside: boolean) => {
      const { db, clock, writer, accountId, goal } = await setup();
      await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 6_000_000, alertLevels: [75] }, 'user');
      await recordEntry(writer, { kind: 'expense', amountMinor: 250_000, categoryId: 'cat_food', accountId, merchant: 'X', occurredAtMs: NOW });
      if (aside) {
        const id = await goal();
        expect((await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user')).ok).toBe(true);
        expect((await loadGoals(db))[0]).toMatchObject({ setAsideMinor: 500_000, contributedMinor: 500_000, remainingMinor: 2_500_000 });
        expect(await setAsideTotal(db)).toBe(500_000);
      }
      const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).map((a) => [a.postingsMinor, a.balanceNotSet]);
      const tx = (await db.query('SELECT COUNT(*), COALESCE(SUM(amount_minor),0) FROM "transaction"'))[0];
      const strip = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID'));
      return strip({ accounts, tx, home: await homeSummary(db, clock.nowMs()) });
    };
    expect(await snapshot(true)).toEqual(await snapshot(false));
  });

  it('take back reduces what is set aside, and more than is set aside is refused with the amount', async () => {
    const { db, writer, goal } = await setup();
    const id = await goal();
    await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    expect((await writer.run(TakeBackFromGoal, { goalId: id, amountMinor: 200_000 }, 'user')).ok).toBe(true);
    expect((await loadGoals(db))[0]!.setAsideMinor).toBe(300_000);
    const over = await writer.run(TakeBackFromGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(parseExceedsSetAside(over.code)).toBe(300_000);
    expect(await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 0 }, 'user')).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await writer.run(SetAsideForGoal, { goalId: 'nope', amountMinor: 1 }, 'user')).toMatchObject({ ok: false, code: 'GOAL_NOT_FOUND' });
  });

  it('the history keeps every allocation, newest first, and Undo removes just that one', async () => {
    const { db, writer, goal } = await setup();
    const id = await goal();
    const a = await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    await writer.run(TakeBackFromGoal, { goalId: id, amountMinor: 200_000 }, 'user');
    const d = (await loadGoalDetail(db, id)) as Exclude<Awaited<ReturnType<typeof loadGoalDetail>>, 'missing'>;
    expect(d.allocations.map((x) => [x.kind, x.amountMinor])).toEqual([['taken_back', 200_000], ['set_aside', 500_000]]);
    if (a.ok) expect((await writer.run(UndoGoalAllocation, { allocationId: a.value.allocationId }, 'user')).ok).toBe(true);
    expect(((await loadGoalDetail(db, id)) as { allocations: readonly unknown[] }).allocations).toHaveLength(1);
    expect(await loadGoalDetail(db, 'nope')).toBe('missing');
  });
});

describe('lifecycle (GOAL-004)', () => {
  it('paused still holds its money; completed and archived stop holding it; restore holds it again; allocations are kept', async () => {
    const { db, writer, goal } = await setup();
    const id = await goal();
    await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    const to = (s: 'active' | 'paused' | 'completed' | 'archived') => writer.run(ChangeGoalState, { goalId: id, to: s }, 'user');
    expect((await to('paused')).ok).toBe(true);
    expect(await setAsideTotal(db)).toBe(500_000);
    expect(await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 1 }, 'user')).toMatchObject({ ok: false, code: 'NOT_ACTIVE' });
    expect((await to('completed')).ok).toBe(true);
    expect(await setAsideTotal(db)).toBe(0);
    expect((await loadGoals(db))[0]).toMatchObject({ state: 'completed', setAsideMinor: 500_000 });
    expect((await to('active')).ok).toBe(true);
    expect(await setAsideTotal(db)).toBe(500_000);
    expect((await to('archived')).ok).toBe(true);
    expect(await setAsideTotal(db)).toBe(0);
    expect(await to('paused')).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    expect((await to('active')).ok).toBe(true);
    expect(await setAsideTotal(db)).toBe(500_000);
    expect(((await loadGoalDetail(db, id)) as { allocations: readonly unknown[] }).allocations).toHaveLength(1);
  });

  it('a goal whose allocations reach the target is funded, and setAsideTotal sums active goals only', async () => {
    const { db, writer, goal } = await setup();
    const a = await goal({ name: 'A', targetMinor: 100_000 });
    const b = await goal({ name: 'B' });
    await writer.run(SetAsideForGoal, { goalId: a, amountMinor: 100_000 }, 'user');
    await writer.run(SetAsideForGoal, { goalId: b, amountMinor: 200_000 }, 'user');
    expect((await loadGoals(db)).map((g) => [g.name, g.funded, g.remainingMinor])).toEqual([['A', true, 0], ['B', false, 2_800_000]]);
    expect(await setAsideTotal(db)).toBe(300_000);
    await writer.run(ChangeGoalState, { goalId: a, to: 'completed' }, 'user');
    expect(await setAsideTotal(db)).toBe(200_000);
  });
});
