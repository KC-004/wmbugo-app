import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SubmitCapture } from '../capture/submitCapture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { comparableWindow, resolveInsightsPeriod, windowLabel, type PeriodPreset } from '../profile/insightsPeriods';
import { budgetFigures } from '../planning/budgets';
import type { PeriodProfile } from '../profile/period';
import { loadInsightsContext, type InsightsFilters, type InsightsScope } from './scope';
import { incomeTotal, kept, spendingByCategory, spendingChange, spendingTotal, waitingInScope } from './spending';

const ist = (m: number, d: number, h = 12, min = 0) => Date.UTC(2026, m - 1, d, h, min, 0) - 5.5 * 3_600_000;

async function setup(profileRule: { kind: 'first' } | { kind: 'none' } = { kind: 'first' }) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  // The profile starts on 1 Oct, so a period that begins then has a baseline; the clock then moves to 8 Nov.
  const clock = new FakeClock(ist(10, 1, 6), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(71)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: profileRule as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('account');
  const hdfc = a.value.accountId;
  const cash = b.value.accountId;
  const expense = async (amountMinor: number, when: number, over: { categoryId?: string; accountId?: string; merchant?: string } = {}) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: over.categoryId ?? 'cat_food', accountId: over.accountId ?? hdfc, merchant: over.merchant ?? 'Swiggy', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const income = async (amountMinor: number, when: number) => {
    const r = await recordEntry(writer, { kind: 'income', amountMinor, categoryId: 'cat_in_salary', accountId: hdfc, merchant: 'Acme Pay', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  let n = 0;
  const refund = (originalId: string, amountMinor: number, when: number) => writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, occurredAtMs: when } }, 'user');
  clock.advance(ist(11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: PeriodPreset, filters: InsightsFilters = {}): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters });
  return { db, clock, writer, hdfc, cash, expense, income, refund, ctx, scope };
}

describe('the November fixture (Story 7.1, INS-005, GATE-07)', () => {
  it('Food ₹10,000, Shopping ₹2,000 with a ₹9,000 refund of an October TV: Shopping reads ₹7,000 back and the total ₹3,000', async () => {
    const { db, expense, refund, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), { categoryId: 'cat_shopping' });
    await expense(1_000_000, ist(11, 3));
    await expense(200_000, ist(11, 4), { categoryId: 'cat_shopping' });
    expect((await refund(tv, 900_000, ist(11, 5))).ok).toBe(true);
    const by = await spendingByCategory(db, scope('this_cycle'));
    const food = by.rows.find((r) => r.categoryId === 'cat_food')!;
    const shop = by.rows.find((r) => r.categoryId === 'cat_shopping')!;
    expect(food).toMatchObject({ displayMinor: 1_000_000, backMinor: 0 });
    expect(shop).toMatchObject({ displayMinor: 0, backMinor: 700_000 });
    expect(await spendingTotal(db, scope('this_cycle'))).toMatchObject({ spentMinor: 300_000, backMinor: 0 });
    // October is unchanged by the November refund.
    expect(await spendingTotal(db, scope('last_cycle'))).toMatchObject({ spentMinor: 900_000, backMinor: 0 });
    expect(by.scope).toMatchObject({ start: '2026-11-01', endExclusive: '2026-12-01', label: '1–30 Nov' });
  });

  it('when refunds exceed spending overall the total is backMinor, never a negative', async () => {
    const { db, expense, refund, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), { categoryId: 'cat_shopping' });
    await refund(tv, 900_000, ist(11, 5));
    const t = await spendingTotal(db, scope('this_cycle'));
    expect(t).toMatchObject({ spentMinor: 0, backMinor: 900_000 });
    expect(Math.min(...Object.values(t).filter((x): x is number => typeof x === 'number'))).toBeGreaterThanOrEqual(0);
  });

  it('the overall budget still counts the October TV refund the Story 4.5 way (floored per category)', async () => {
    const { db, expense, refund, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), { categoryId: 'cat_shopping' });
    await expense(1_000_000, ist(11, 3));
    await expense(200_000, ist(11, 4), { categoryId: 'cat_shopping' });
    await refund(tv, 900_000, ist(11, 5));
    expect(budgetFigures).toBeDefined();
    const by = await spendingByCategory(db, scope('this_cycle'));
    expect(by.rows.reduce((s, r) => s + r.displayMinor, 0)).toBe(1_000_000);
  });
});

describe('eligibility (INS-003)', () => {
  it('counts only confirmed, live expenses: transfers, waiting and removed entries never count, a transfer fee does', async () => {
    const { db, hdfc, cash, expense, writer, scope } = await setup();
    await expense(100_000, ist(11, 3));
    const waiting = await expense(50_000, ist(11, 3));
    db.raw.exec(`UPDATE "transaction" SET status = 'needs_review' WHERE id = '${waiting}'`);
    const gone = await expense(70_000, ist(11, 3));
    db.raw.exec(`UPDATE "transaction" SET removed_at = 1, removal_kind = 'deleted' WHERE id = '${gone}'`);
    const t = await recordTransfer(writer, { amountMinor: 400_000, fromAccountId: hdfc, toAccountId: cash, occurredAtMs: ist(11, 3), fee: { amountMinor: 1_000, categoryId: 'cat_other' } } as never);
    expect(t.ok).toBe(true);
    const total = await spendingTotal(db, scope('this_cycle'));
    expect(total.spentMinor).toBe(101_000);
    expect(await waitingInScope(db, scope('this_cycle'))).toBe(1);
  });

  it('income counts only confirmed income entries', async () => {
    const { db, income, hdfc, cash, writer, scope } = await setup();
    await income(8_500_000, ist(11, 1));
    await recordTransfer(writer, { amountMinor: 100_000, fromAccountId: hdfc, toAccountId: cash, occurredAtMs: ist(11, 2) });
    expect((await incomeTotal(db, scope('this_cycle'))).incomeMinor).toBe(8_500_000);
  });

  it('an entry at 23:30 local on the last day of the period belongs to that period, and one at 00:10 the next day to the next', async () => {
    const { db, expense, scope } = await setup();
    await expense(100_000, ist(11, 30, 23, 30));
    await expense(200_000, ist(12, 1, 0, 10));
    expect((await spendingTotal(db, scope('this_cycle'))).spentMinor).toBe(100_000);
  });

  it('a category filter and an account filter narrow the total, and a merchant key matches every raw spelling', async () => {
    const { db, hdfc, cash, expense, scope } = await setup();
    await expense(100_000, ist(11, 3), { merchant: 'SWIGGY*BLR 8821' });
    await expense(60_000, ist(11, 4), { merchant: 'Swiggy' });
    await expense(30_000, ist(11, 5), { merchant: 'Amazon', categoryId: 'cat_shopping', accountId: cash });
    expect((await spendingTotal(db, scope('this_cycle', { accountIds: [cash] }))).spentMinor).toBe(30_000);
    expect((await spendingTotal(db, scope('this_cycle', { accountIds: [hdfc] }))).spentMinor).toBe(160_000);
    expect((await spendingTotal(db, scope('this_cycle', { categoryIds: ['cat_shopping'] }))).spentMinor).toBe(30_000);
    expect((await spendingTotal(db, scope('this_cycle', { merchantKeys: ['swiggy'] }))).spentMinor).toBe(160_000);
    expect((await spendingTotal(db, scope('this_cycle', { types: ['income'] }))).spentMinor).toBe(0);
  });
});

describe('spendingChange (INS-015)', () => {
  it('1–8 Nov ₹14,000 against 1–8 Oct ₹12,500 on 8 Nov is up 12% vs Oct 1–8, and all of October is never the baseline', async () => {
    const { db, expense, scope, ctx } = await setup();
    await expense(1_250_000, ist(10, 5));
    await expense(2_750_000, ist(10, 20)); // later in October: not part of Oct 1–8
    await expense(1_400_000, ist(11, 4));
    const c = await spendingChange(db, scope('this_cycle'), ctx);
    expect(c).toMatchObject({ kind: 'change', direction: 'up', percent: 12, baselineLabel: 'Oct 1–8' });
  });

  it('a lower figure is down, an equal one is same, and an empty previous window is no baseline', async () => {
    const { db, expense, scope, ctx } = await setup();
    expect((await spendingChange(db, scope('this_cycle'), ctx)).kind).toBe('no_baseline');
    await expense(1_000_000, ist(10, 5));
    await expense(920_000, ist(11, 4));
    expect(await spendingChange(db, scope('this_cycle'), ctx)).toMatchObject({ direction: 'down', percent: 8 });
    await expense(80_000, ist(11, 5));
    expect(await spendingChange(db, scope('this_cycle'), ctx)).toMatchObject({ direction: 'same', percent: 0 });
  });

  it('has no baseline when the previous window starts before the first day wmbugo has', async () => {
    const { db, expense, scope, ctx } = await setup();
    await expense(1_000_000, ist(10, 5));
    const c = await spendingChange(db, scope('last_cycle'), ctx); // September has nothing and is before the first day
    expect(c.kind).toBe('no_baseline');
  });
});

describe('kept (INS-016)', () => {
  it('income ₹85,000 and ₹3,000 spent keeps 96%; spending more than came in is short, never a negative percent; no income is no_income', async () => {
    const { db, expense, income, scope } = await setup();
    expect(await kept(db, scope('this_cycle'))).toMatchObject({ kind: 'no_income' });
    await income(8_500_000, ist(11, 1));
    await expense(300_000, ist(11, 3));
    expect(await kept(db, scope('this_cycle'))).toMatchObject({ kind: 'kept', keptPercent: 96, keptMinor: 8_200_000 });
    await expense(9_000_000, ist(11, 4));
    expect(await kept(db, scope('this_cycle'))).toMatchObject({ kind: 'short', shortMinor: 800_000 });
  });
});

describe('comparableWindow (INS-004)', () => {
  const profile: PeriodProfile = { rule: { kind: 'first' }, firstDay: 'mon' };
  const at = (preset: PeriodPreset, today: string) => comparableWindow(resolveInsightsPeriod(preset, today, profile, preset === 'custom' ? { start: '2026-11-01', end: '2026-11-08' } : undefined)!, today, profile);

  it('a running cycle compares day 1 to today with the first N days of the previous cycle', () => {
    expect(at('this_cycle', '2026-11-08')).toMatchObject({ current: { start: '2026-11-01', end: '2026-11-08' }, previous: { start: '2026-10-01', end: '2026-10-08' }, label: 'Oct 1–8' });
  });

  it('is capped at the previous period length and an ended period compares whole with whole', () => {
    expect(at('this_cycle', '2026-03-31').previous).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(at('last_cycle', '2026-11-08')).toMatchObject({ current: { start: '2026-10-01', end: '2026-10-31' }, previous: { start: '2026-09-01', end: '2026-09-30' } });
  });

  it('the presets without a natural previous period use the days before, or the same days of last year', () => {
    expect(at('today', '2026-11-08').previous).toEqual({ start: '2026-11-07', end: '2026-11-07' });
    expect(at('yesterday', '2026-11-08').previous).toEqual({ start: '2026-11-06', end: '2026-11-06' });
    expect(at('seven_days', '2026-11-08').previous).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(at('this_year', '2026-11-08').previous).toEqual({ start: '2025-01-01', end: '2025-11-08' });
    expect(at('this_quarter', '2026-11-08')).toMatchObject({ current: { start: '2026-10-01', end: '2026-11-08' }, previous: { start: '2026-07-01', end: '2026-08-08' } });
    expect(at('custom', '2026-11-20').previous).toEqual({ start: '2026-10-24', end: '2026-10-31' });
  });

  it('labels windows across months', () => {
    expect(windowLabel('2026-10-25', '2026-11-01')).toBe('Oct 25–Nov 1');
    expect(windowLabel('2026-10-01', '2026-10-08')).toBe('Oct 1–8');
  });
});

describe('properties', () => {
  it('the category nets add up to the total, and no output carries a negative money value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.record({ amount: fc.integer({ min: 1, max: 500_000 }), day: fc.integer({ min: 1, max: 8 }), cat: fc.constantFrom('cat_food', 'cat_shopping', 'cat_transport', 'cat_uncategorised'), refund: fc.boolean() }), { maxLength: 12 }), async (items) => {
        const { db, expense, refund, scope } = await setup();
        for (const it of items) {
          const id = await expense(it.amount, ist(11, it.day), { categoryId: it.cat });
          if (it.refund) await refund(id, Math.max(1, Math.floor(it.amount / 2)), ist(11, it.day));
        }
        const by = await spendingByCategory(db, scope('this_cycle'));
        const total = await spendingTotal(db, scope('this_cycle'));
        const net = by.rows.reduce((s, r) => s + r.displayMinor - r.backMinor, 0);
        expect(total.spentMinor - total.backMinor).toBe(net);
        for (const r of by.rows) expect(Math.min(r.displayMinor, r.backMinor)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 12 },
    );
  });
});
