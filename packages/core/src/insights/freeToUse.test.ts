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
import { SaveBudget } from '../planning/budgetCommands';
import { CreateFiftyThirtyTwenty } from '../planning/budgetTemplate';
import { ChangeGoalState, SaveGoal, SetAsideForGoal } from '../planning/goals';
import { MarkBillPaid, SaveRecurringRule } from '../planning/recurringCommands';
import { freeToUse, shortfallAfterHolding } from './freeToUse';
import { homeSummary } from './homeSummary';

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0); // 12 Nov 2026

async function setup(opts: { accounts?: boolean } = {}) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(69)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const account = async (name: string, openingMinor: number, type: 'bank' | 'savings_pot' | 'cash' = 'bank') => {
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error(a.code);
    return a.value.accountId;
  };
  const limit = async (targetMinor: number) => {
    const r = await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor, alertLevels: [75] }, 'user');
    if (!r.ok) throw new Error(r.code);
  };
  const bill = async (title: string, expectedAmountMinor: number, anchorDate: string) => {
    const r = await writer.run(SaveRecurringRule, { title, expectedAmountMinor, cadence: 'monthly', anchorDate, kind: 'rent' }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  const goalSetAside = async (amountMinor: number, name = 'Goa trip') => {
    const g = await writer.run(SaveGoal, { name, targetMinor: 9_000_000, icon: 'Airplane', color: 'cat-cyan' }, 'user');
    if (!g.ok) throw new Error(g.code);
    const a = await writer.run(SetAsideForGoal, { goalId: g.value.goalId, amountMinor }, 'user');
    if (!a.ok) throw new Error(a.code);
    return g.value.goalId;
  };
  const hdfc = opts.accounts === false ? '' : await account('HDFC', 4_200_000);
  return { db, clock, writer, account, limit, bill, goalSetAside, hdfc };
}

const ok = (r: Awaited<ReturnType<typeof freeToUse>>) => {
  if (r.gate !== 'ok') throw new Error(`gate ${r.gate}`);
  return r;
};

describe('freeToUse (Story 6.9)', () => {
  it('Left 18,000, accounts 42,000, bills and set aside 30,000 is 12,000, and says which side is smaller', async () => {
    const { db, limit, bill, goalSetAside } = await setup();
    await limit(1_800_000);
    await bill('Rent', 1_800_000, '2026-11-20');
    await goalSetAside(1_200_000);
    const f = ok(await freeToUse(db, NOW));
    expect(f).toMatchObject({ leftMinor: 1_800_000, assetsMinor: 4_200_000, billsReservedMinor: 1_800_000, billsCount: 1, setAsideMinor: 1_200_000, leavesMinor: 1_200_000, valueMinor: 1_200_000, shortByMinor: 0, smaller: 'accounts' });
  });

  it('Left 60,000, accounts 50,000, no bills, 12,400 set aside is 37,600 and the balances and Left are unchanged', async () => {
    const { db, limit, goalSetAside, account } = await setup();
    await account('Cash', 800_000, 'cash');
    await limit(6_000_000);
    const before = await freeToUse(db, NOW);
    expect(ok(before)).toMatchObject({ assetsMinor: 5_000_000, valueMinor: 5_000_000 });
    await goalSetAside(1_240_000);
    const f = ok(await freeToUse(db, NOW));
    expect(f).toMatchObject({ valueMinor: 3_760_000, assetsMinor: 5_000_000, leftMinor: 6_000_000, smaller: 'accounts' });
    expect(ok(before).assetsMinor).toBe(f.assetsMinor);
    expect(ok(before).leftMinor).toBe(f.leftMinor);
  });

  it('Left 60,000, accounts 30,000, set aside 20,000 then 35,000 is short by 5,000', async () => {
    const { db, writer, limit, account, goalSetAside } = await setup({ accounts: false });
    await account('HDFC', 3_000_000);
    await limit(6_000_000);
    const gid = await goalSetAside(2_000_000);
    expect(ok(await freeToUse(db, NOW))).toMatchObject({ valueMinor: 1_000_000, shortByMinor: 0 });
    await writer.run(SetAsideForGoal, { goalId: gid, amountMinor: 1_500_000 }, 'user');
    expect(ok(await freeToUse(db, NOW))).toMatchObject({ valueMinor: -500_000, shortByMinor: 500_000 });
  });

  it('the paid bill stops being reserved, a bill after payday is not, and a completed goal frees its money', async () => {
    const { db, writer, limit, bill, goalSetAside } = await setup();
    await limit(6_000_000);
    const rent = await bill('Rent', 1_800_000, '2026-11-20');
    await bill('Next month', 500_000, '2026-12-05');
    expect(ok(await freeToUse(db, NOW))).toMatchObject({ billsReservedMinor: 1_800_000, billsCount: 1, valueMinor: 2_400_000 });
    await writer.run(MarkBillPaid, { ruleId: rent, dueDate: '2026-11-20' }, 'user');
    expect(ok(await freeToUse(db, NOW))).toMatchObject({ billsReservedMinor: 0, billsCount: 0, valueMinor: 4_200_000 });
    const gid = await goalSetAside(1_000_000);
    expect(ok(await freeToUse(db, NOW)).valueMinor).toBe(3_200_000);
    await writer.run(ChangeGoalState, { goalId: gid, to: 'completed' }, 'user');
    expect(ok(await freeToUse(db, NOW)).valueMinor).toBe(4_200_000);
  });

  it('J-BILLS: adding Rent due before payday lowers Free to use by its amount', async () => {
    const { db, limit, bill } = await setup();
    await limit(6_000_000);
    expect(ok(await freeToUse(db, NOW)).valueMinor).toBe(4_200_000);
    await bill('Rent', 1_800_000, '2026-11-20');
    expect(ok(await freeToUse(db, NOW)).valueMinor).toBe(2_400_000);
  });

  it('only 50/30/20 targets: Left equals the Home figure, with the not classified part named', async () => {
    const { db, writer, hdfc } = await setup();
    await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user');
    await recordEntry(writer, { kind: 'expense', amountMinor: 300_000, categoryId: 'cat_uncategorised', accountId: hdfc, merchant: 'X', occurredAtMs: NOW });
    const f = ok(await freeToUse(db, NOW));
    const home = (await homeSummary(db, NOW))!;
    expect(f.leftMinor).toBe(home.leftMinor);
    expect(f.notClassifiedMinor).toBeGreaterThanOrEqual(0);
    expect(home.heroMode).toBe('nws_only');
  });

  it('the gate: no limit, then no account with a balance, then ok whatever bills and goals exist', async () => {
    const none = await setup({ accounts: false });
    expect(await freeToUse(none.db, NOW)).toEqual({ gate: 'needs_limit' });
    await none.limit(6_000_000);
    expect(await freeToUse(none.db, NOW)).toEqual({ gate: 'needs_account', hasAccounts: false });
    await none.account('Cash', 0, 'cash');
    expect(ok(await freeToUse(none.db, NOW)).valueMinor).toBe(0);
    // A savings pot never counts as an asset, and an account with no balance set does not either.
    const pots = await setup({ accounts: false });
    await pots.limit(6_000_000);
    await pots.account('SIP', 9_000_000, 'savings_pot');
    expect(await freeToUse(pots.db, NOW)).toEqual({ gate: 'needs_account', hasAccounts: false });
    const notSet = await setup({ accounts: false });
    await notSet.limit(6_000_000);
    const r = await notSet.writer.run(AddAccount, { name: 'No balance', type: 'bank', openingMinor: null }, 'user');
    expect(r.ok).toBe(true);
    const gate = await freeToUse(notSet.db, NOW);
    expect(gate).toMatchObject({ gate: 'needs_account' });
  });

  it('counts an account with no balance set as `not set` beside one that has one', async () => {
    const { db, limit, writer } = await setup();
    await limit(6_000_000);
    await writer.run(AddAccount, { name: 'No balance', type: 'bank', openingMinor: null }, 'user');
    const f = ok(await freeToUse(db, NOW));
    expect(f.notSetAccounts).toBe(1);
    expect(f.assetsMinor).toBe(4_200_000);
  });
});

describe('shortfallAfterHolding (GOAL-004)', () => {
  it('warns only when holding more would leave Free to use below zero, and only when the gate passes', async () => {
    const { db, limit, bill } = await setup();
    await limit(6_000_000);
    await bill('Rent', 1_800_000, '2026-11-20');
    const f = await freeToUse(db, NOW); // 42,000 - 18,000 = 24,000
    expect(shortfallAfterHolding(f, 2_400_000)).toBeNull(); // leaves exactly zero
    expect(shortfallAfterHolding(f, 2_900_000)).toBe(500_000);
    expect(shortfallAfterHolding(f, 0)).toBeNull();
    expect(shortfallAfterHolding({ gate: 'needs_limit' }, 9_999_999)).toBeNull();
  });
});
