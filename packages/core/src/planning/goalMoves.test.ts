import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordTransfer } from '../testing/capture';
import { SubmitCapture } from '../capture/submitCapture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { DeleteEntry } from '../ledger/editCommands';
import { SAVINGS_MOVED_IN_SQL } from '../ledger/savings';
import { canCountTowardGoal, CountTowardGoal, goalOfTransaction, goalProgress, loadGoalDetail, loadGoals, ReleaseGoalMoves, RemoveGoalTag, SaveGoal, SetAsideForGoal, setAsideTotal, TakeBackFromGoal } from './goals';

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0); // 12 Nov 2026

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(67)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const acc = async (name: string, type: 'bank' | 'savings_pot', openingMinor = 0) => {
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error(a.code);
    return a.value.accountId;
  };
  const hdfc = await acc('HDFC', 'bank', 100_000_000);
  const cash = await acc('Cash', 'bank', 10_000_000);
  const sip = await acc('SIP Axis MF', 'savings_pot');
  const goal = async (over: { targetMinor?: number; accountId?: string | null } = {}) => {
    const r = await writer.run(SaveGoal, { name: 'Goa trip', targetMinor: over.targetMinor ?? 3_000_000, dueMonth: '2027-03', icon: 'Airplane', color: 'cat-cyan', accountId: over.accountId === undefined ? sip : over.accountId }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.goalId;
  };
  let n = 0;
  const move = (amountMinor: number, goalId?: string, to = sip) =>
    writer.run(SubmitCapture, { submissionId: `mv-${++n}`, sourceKind: 'manual', transfer: { amountMinor, fromAccountId: hdfc, toAccountId: to }, ...(goalId ? { goalId } : {}) }, 'user');
  return { db, clock, writer, hdfc, cash, sip, goal, move };
}

const val = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('Moved to savings (Story 6.7)', () => {
  it('moves ₹5,000 into the pot for Goa trip: one transfer, one allocation in the same transaction, the Savings figure rises by 5,000 once', async () => {
    const { db, goal, move } = await setup();
    const id = await goal();
    const before = Number((await db.query(SAVINGS_MOVED_IN_SQL, ['2026-11-01', '2026-11-30']))[0]![0]);
    const r = val(await move(500_000, id));
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction" WHERE event_type = \'transfer\''))[0]![0])).toBe(1);
    expect((await db.query('SELECT kind, amount_minor, transaction_id, local_date, converted_minor FROM goal_allocation WHERE goal_id = ?', [id]))[0]!.map(String)).toEqual(['moved', '500000', r.value.transactionId, '2026-11-12', '0']);
    expect((await loadGoals(db))[0]).toMatchObject({ movedMinor: 500_000, setAsideMinor: 0, contributedMinor: 500_000, remainingMinor: 2_500_000 });
    expect(Number((await db.query(SAVINGS_MOVED_IN_SQL, ['2026-11-01', '2026-11-30']))[0]![0]) - before).toBe(500_000);
    expect((await db.query('SELECT event FROM outbox')).map((x) => String(x[0]))).toEqual(expect.arrayContaining(['TransactionsChanged', 'GoalsChanged']));
  });

  it('with ₹5,000 already set aside, moving ₹5,000 keeps the goal at ₹5,000 and holds nothing set aside twice', async () => {
    const { db, writer, goal, move } = await setup();
    const id = await goal();
    await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    expect(await setAsideTotal(db)).toBe(500_000);
    val(await move(500_000, id));
    expect((await loadGoals(db))[0]).toMatchObject({ setAsideMinor: 0, movedMinor: 500_000, contributedMinor: 500_000 });
    expect(await setAsideTotal(db)).toBe(0);
    // A smaller move converts only what it moves.
    const other = await goal({ accountId: null });
    await writer.run(SetAsideForGoal, { goalId: other, amountMinor: 500_000 }, 'user');
    val(await move(200_000, other));
    expect((await loadGoals(db)).find((g) => g.id === other)).toMatchObject({ setAsideMinor: 300_000, movedMinor: 200_000, contributedMinor: 500_000 });
    // Taking back is limited to what is still set aside.
    expect(await writer.run(TakeBackFromGoal, { goalId: other, amountMinor: 400_000 }, 'user')).toMatchObject({ ok: false, code: 'EXCEEDS_SET_ASIDE:300000' });
  });

  it('a move that is deleted drops its allocation and gives the set-aside back; a waiting move is not counted', async () => {
    const { db, writer, goal, move } = await setup();
    const id = await goal();
    await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    const m = val(await move(500_000, id));
    expect(val(await writer.run(DeleteEntry, { transactionId: m.value.transactionId }, 'user')).ok).toBe(true);
    // Counted nowhere the moment it is removed, even before the handler runs.
    expect((await loadGoals(db))[0]).toMatchObject({ setAsideMinor: 500_000, movedMinor: 0, contributedMinor: 500_000 });
    expect(val(await writer.run(ReleaseGoalMoves, {}, 'system')).value.released).toBe(1);
    expect(Number((await db.query('SELECT COUNT(*) FROM goal_allocation WHERE kind = \'moved\''))[0]![0])).toBe(0);
    expect(val(await writer.run(ReleaseGoalMoves, {}, 'system')).value.released).toBe(0);
    // Waiting for review: not counted, and not part of the history.
    const w = val(await move(100_000, id));
    await db.query("UPDATE \"transaction\" SET status = 'needs_review' WHERE id = ?", [w.value.transactionId]);
    expect((await loadGoals(db))[0]).toMatchObject({ movedMinor: 0 });
    expect(((await loadGoalDetail(db, id)) as { allocations: readonly { kind: string }[] }).allocations.filter((a) => a.kind === 'moved')).toHaveLength(0);
  });

  it('refuses a move that is not into a savings pot, and the whole transfer is rolled back', async () => {
    const { db, goal, move, cash } = await setup();
    const id = await goal();
    const transfers = Number((await db.query("SELECT COUNT(*) FROM \"transaction\" WHERE event_type = 'transfer'"))[0]![0]);
    expect(await move(100_000, id, cash)).toMatchObject({ ok: false, code: 'NOT_A_SAVINGS_MOVE' });
    expect(await move(100_000, 'nope')).toMatchObject({ ok: false, code: 'GOAL_NOT_FOUND' });
    expect(Number((await db.query("SELECT COUNT(*) FROM \"transaction\" WHERE event_type = 'transfer'"))[0]![0])).toBe(transfers);
  });

  it('a paused goal cannot receive a move', async () => {
    const { db, writer, goal, move } = await setup();
    const id = await goal();
    await db.query("UPDATE goal SET state = 'paused' WHERE id = ?", [id]);
    expect(await move(100_000, id)).toMatchObject({ ok: false, code: 'GOAL_NOT_ACTIVE' });
    expect(writer).toBeDefined();
  });
});

describe('Count toward a goal', () => {
  it('tags an existing savings transfer once, shows For Goa trip, and Remove undoes it', async () => {
    const { db, writer, hdfc, sip, goal } = await setup();
    const id = await goal();
    const other = await goal({ accountId: null });
    const t = val(await recordTransfer(writer, { amountMinor: 700_000, fromAccountId: hdfc, toAccountId: sip }));
    const tx = t.value.transactionId;
    expect(await canCountTowardGoal(db, tx)).toBe(true);
    val(await writer.run(CountTowardGoal, { transactionId: tx, goalId: id }, 'user'));
    expect(await goalOfTransaction(db, tx)).toEqual({ goalId: id, name: 'Goa trip' });
    expect(await canCountTowardGoal(db, tx)).toBe(false);
    expect(await writer.run(CountTowardGoal, { transactionId: tx, goalId: other }, 'user')).toMatchObject({ ok: false, code: 'ALREADY_TAGGED' });
    expect((await loadGoals(db)).find((g) => g.id === id)!.movedMinor).toBe(700_000);
    val(await writer.run(RemoveGoalTag, { transactionId: tx }, 'user'));
    expect(await goalOfTransaction(db, tx)).toBeNull();
    expect(await writer.run(RemoveGoalTag, { transactionId: tx }, 'user')).toMatchObject({ ok: false, code: 'NOT_TAGGED' });
    expect((await loadGoals(db)).find((g) => g.id === id)!.movedMinor).toBe(0);
  });

  it('is not offered for a transfer between ordinary accounts', async () => {
    const { db, writer, hdfc, cash } = await setup();
    const t = val(await recordTransfer(writer, { amountMinor: 100_000, fromAccountId: hdfc, toAccountId: cash }));
    expect(await canCountTowardGoal(db, t.value.transactionId)).toBe(false);
  });
});

describe('goalProgress (GOAL-003)', () => {
  const g = { contributedMinor: 1_000_000, remainingMinor: 2_000_000 };

  it('has a pace only with contributions in two calendar months, the first 30 or more days old', () => {
    expect(goalProgress(g, ['2026-09-15', '2026-10-20'], '2026-11-12').pace).toEqual({ monthlyMinor: 500_000, projectedMonth: '2027-03' });
    expect(goalProgress(g, ['2026-10-02', '2026-10-20'], '2026-11-12').pace).toBeNull(); // one month
    expect(goalProgress(g, ['2026-10-25', '2026-11-05'], '2026-11-12').pace).toBeNull(); // two months but 18 days old
    expect(goalProgress(g, [], '2026-11-12').pace).toBeNull();
    expect(goalProgress({ contributedMinor: 0, remainingMinor: 3_000_000 }, ['2026-09-15', '2026-10-20'], '2026-11-12').pace).toBeNull();
  });

  it('a reached goal projects this month, and a pace that does not divide rounds the months up', () => {
    expect(goalProgress({ contributedMinor: 1_000_000, remainingMinor: 0 }, ['2026-09-15', '2026-10-20'], '2026-11-12').pace?.projectedMonth).toBe('2026-11');
    expect(goalProgress({ contributedMinor: 1_000_000, remainingMinor: 1_100_000 }, ['2026-09-15', '2026-10-20'], '2026-11-12').pace).toEqual({ monthlyMinor: 500_000, projectedMonth: '2027-02' });
  });

  it('loadGoals with a clock carries the progress, and a paused goal still has one to hide', async () => {
    const { db, writer, goal } = await setup();
    const id = await goal();
    await writer.run(SetAsideForGoal, { goalId: id, amountMinor: 500_000 }, 'user');
    const g1 = (await loadGoals(db, NOW))[0]!;
    expect(g1.progress).toMatchObject({ contributedMinor: 500_000, remainingMinor: 2_500_000, pace: null });
    expect((await loadGoals(db))[0]!.progress).toBeNull();
  });
});
