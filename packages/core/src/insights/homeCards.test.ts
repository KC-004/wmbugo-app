import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { SaveBudget } from '../planning/budgetCommands';
import { CreateFiftyThirtyTwenty } from '../planning/budgetTemplate';
import { homeBudgetCards, homeIncomeExpense } from './homeCards';

const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(17)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 0 }, 'user');
  if (!a.ok || !b.ok) throw new Error('account');
  const bank = a.value.accountId;
  const spend = async (categoryId: string, amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: bank, merchant: 'X', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
  };
  const earn = async (amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'income', amountMinor, categoryId: 'cat_in_salary', accountId: bank, merchant: 'Acme', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
  };
  const budget = (categoryIds: string[], targetMinor: number, periodRule: 'default' | 'weekly' = 'default') =>
    writer.run(SaveBudget, { scope: 'category', categoryIds, accountIds: null, periodRule, targetMinor, alertLevels: [75, 90, 100] }, 'user');
  return { db, writer, spend, earn, budget, bank, cash: b.value.accountId };
}

describe('homeIncomeExpense (Story 5.4)', () => {
  it('income in, refund-net spent out, and the net in the right direction', async () => {
    const { db, spend, earn } = await setup();
    await earn(8_500_000, ist(11, 1));
    await spend('cat_food', 814_000, ist(11, 3));
    const r = (await homeIncomeExpense(db, NOW))!;
    expect(r).toMatchObject({ incomeMinor: 8_500_000, spentMinor: 814_000, net: { kind: 'in', minor: 7_686_000 }, period: { start: '2026-11-01', end: '2026-11-30' } });
  });

  it('spending over income is out, with the size as a positive amount', async () => {
    const { db, spend, earn } = await setup();
    await earn(500_000, ist(11, 1));
    await spend('cat_food', 820_000, ist(11, 3));
    expect((await homeIncomeExpense(db, NOW))!.net).toEqual({ kind: 'out', minor: 320_000 });
  });

  it('equal is even, and an empty period is genuine zeros', async () => {
    const empty = await setup();
    expect(await homeIncomeExpense(empty.db, NOW)).toMatchObject({ incomeMinor: 0, spentMinor: 0, net: { kind: 'even', minor: 0 } });
    const eq = await setup();
    await eq.earn(100_000, ist(11, 1));
    await eq.spend('cat_food', 100_000, ist(11, 2));
    expect((await homeIncomeExpense(eq.db, NOW))!.net).toEqual({ kind: 'even', minor: 0 });
  });

  it('transfers and card payments are in neither, and other periods are left out', async () => {
    const { db, spend, bank, cash, writer } = await setup();
    await recordTransfer(writer, { amountMinor: 500_000, fromAccountId: bank, toAccountId: cash });
    await spend('cat_food', 40_000, ist(10, 20)); // October: not this period
    expect(await homeIncomeExpense(db, NOW)).toMatchObject({ incomeMinor: 0, spentMinor: 0 });
  });

  it('a refund of an earlier purchase lowers spent but never below zero', async () => {
    const { db, writer, bank } = await setup();
    const old = await recordEntry(writer, { kind: 'expense', amountMinor: 200_000, categoryId: 'cat_food', accountId: bank, merchant: 'X', occurredAtMs: ist(10, 5) });
    if (!old.ok) throw new Error(old.code);
    const { SubmitCapture } = await import('../capture/submitCapture');
    const r = await writer.run(SubmitCapture, { submissionId: 'rf-1', sourceKind: 'manual', refund: { originalId: old.value.transactionId, amountMinor: 160_000, recoveryKind: 'refund' } }, 'user');
    if (!r.ok) throw new Error(r.code);
    expect(await homeIncomeExpense(db, NOW)).toMatchObject({ spentMinor: 0, incomeMinor: 0, net: { kind: 'even', minor: 0 } });
  });

  it('is null before onboarding', async () => {
    expect(await homeIncomeExpense(new NodeSqliteDatabase().applyRealMigrations(), NOW)).toBeNull();
  });
});

describe('homeBudgetCards (Story 5.4)', () => {
  it('lists category budgets by percent used, highest first, and never the overall budget', async () => {
    const { db, writer, spend, budget } = await setup();
    await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 9_000_000, alertLevels: [75, 90, 100] }, 'user');
    await budget(['cat_food'], 1_000_000);
    await budget(['cat_groceries'], 1_000_000);
    await spend('cat_food', 300_000, ist(11, 3));
    await spend('cat_groceries', 850_000, ist(11, 4));
    const c = (await homeBudgetCards(db, NOW))!;
    expect(c.categoryBudgets.map((r) => [r.name, r.status.percentUsed])).toEqual([['Groceries', 85], ['Food & Drinks', 30]]);
    expect(c.categoryBudgets.every((r) => r.scope !== 'overall')).toBe(true);
    expect(c.nws).toBeNull();
    expect(c.defaultPeriod).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });

  it('a budget on its own period keeps that period, different from the default', async () => {
    const { db, budget } = await setup();
    await budget(['cat_food'], 1_000_000, 'weekly');
    const c = (await homeBudgetCards(db, NOW))!;
    expect(c.categoryBudgets[0]!.period).not.toEqual(expect.objectContaining(c.defaultPeriod));
    expect(c.categoryBudgets[0]!.periodLabel).toMatch(/^Weekly/);
  });

  it('with 50/30/20 targets it gives Needs, Wants, Savings and what is not classified', async () => {
    const { db, writer, spend } = await setup();
    await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000, targets: { needsMinor: 2_500_000, wantsMinor: 1_500_000, savingsMinor: 500_000 } }, 'user');
    await spend('cat_groceries', 1_500_000, ist(11, 3));
    await spend('cat_uncategorised', 300_000, ist(11, 5));
    const c = (await homeBudgetCards(db, NOW))!;
    expect(c.categoryBudgets).toEqual([]);
    expect(c.nws!.rows.map((r) => r.name).sort()).toEqual(['Needs', 'Savings', 'Wants']);
    expect(c.nws!.typeSummary).toMatchObject({ notClassifiedMinor: 300_000 });
  });

  it('is empty without any budget, and null before onboarding', async () => {
    const { db } = await setup();
    expect(await homeBudgetCards(db, NOW)).toMatchObject({ categoryBudgets: [], nws: null });
    expect(await homeBudgetCards(new NodeSqliteDatabase().applyRealMigrations(), NOW)).toBeNull();
  });
});
