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
import { resolveInsightsPeriod, type PeriodPreset } from '../profile/insightsPeriods';
import { incomeVsExpense, spendingTrend } from './trends';
import { loadInsightsContext, type InsightsScope } from './scope';

const ist = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup(startMonth = 9, startDay = 1) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(ist(startMonth, startDay, 6), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(79)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' } as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const expense = async (amountMinor: number, when: number, categoryId = 'cat_food') => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: a.value.accountId, merchant: 'Swiggy', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const income = async (amountMinor: number, when: number) => {
    const r = await recordEntry(writer, { kind: 'income', amountMinor, categoryId: 'cat_in_salary', accountId: a.value.accountId, merchant: 'Acme', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
  };
  let n = 0;
  const refund = (originalId: string, amountMinor: number, when: number) => writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, occurredAtMs: when } }, 'user');
  clock.advance(ist(11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: PeriodPreset): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters: {} });
  return { db, expense, income, refund, ctx, scope };
}

describe('spendingTrend (Story 7.5, INS-010)', () => {
  it('one bucket per day with the exact refund-net spending, today marked, and a refund surplus as back', async () => {
    const { db, expense, refund, ctx, scope } = await setup();
    const tv = await expense(500_000, ist(10, 20), 'cat_shopping');
    await expense(100_000, ist(11, 3));
    await expense(50_000, ist(11, 3));
    await refund(tv, 150_000, ist(11, 5));
    const t = await spendingTrend(db, scope('this_cycle'), ctx);
    expect(t.granularity).toBe('day');
    expect(t.buckets).toHaveLength(8);
    expect(t.buckets.find((b) => b.start === '2026-11-03')).toMatchObject({ spentMinor: 150_000, backMinor: 0 });
    expect(t.buckets.find((b) => b.start === '2026-11-05')).toMatchObject({ spentMinor: 0, backMinor: 150_000 });
    expect(t.todayStart).toBe('2026-11-08');
    expect(t.options[0]).toBe('day');
  });

  it('the per-day buckets add up to the period total', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(100_000, ist(11, 1));
    await expense(250_000, ist(11, 7));
    const t = await spendingTrend(db, scope('this_cycle'), ctx);
    expect(t.buckets.reduce((s, b) => s + b.spentMinor, 0)).toBe(350_000);
  });

  it('weeks and months are offered only when they give at least two buckets, and an unsuitable choice falls back', async () => {
    const { db, ctx, scope } = await setup();
    const t = await spendingTrend(db, scope('this_cycle'), ctx, 'month');
    expect(t.options).toContain('day');
    expect(t.options).toContain('week');
    expect(t.options).not.toContain('month');
    expect(t.granularity).toBe('day');
    const wk = await spendingTrend(db, scope('this_cycle'), ctx, 'week');
    expect(wk.granularity).toBe('week');
    expect(wk.buckets.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves out days before the profile existed, and a profile that started today has too little for a trend', async () => {
    const { db, ctx, scope } = await setup(11, 8);
    const t = await spendingTrend(db, scope('this_cycle'), ctx);
    expect(t.buckets[0]!.start).toBe('2026-11-08');
    expect(t.options).toEqual([]);
  });
});

describe('incomeVsExpense (Story 7.5, INS-011)', () => {
  it('three cycles of history: Sep, Oct and Nov oldest first with income, out and the net unsigned', async () => {
    const { db, expense, income, ctx, scope } = await setup();
    await income(8_500_000, ist(9, 1));
    await expense(2_000_000, ist(9, 10));
    await income(8_500_000, ist(10, 1));
    await expense(2_700_000, ist(10, 10));
    await income(100_000, ist(11, 1));
    await expense(320_000, ist(11, 4));
    const r = await incomeVsExpense(db, scope('this_cycle'), ctx);
    expect(r.periods.map((p) => p.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(r.periods[1]).toMatchObject({ incomeMinor: 8_500_000, spentMinor: 2_700_000, netMinor: 5_800_000, net: 'kept' });
    expect(r.periods[2]).toMatchObject({ incomeMinor: 100_000, spentMinor: 320_000, netMinor: 220_000, net: 'short' });
    for (const p of r.periods) expect(Math.min(p.incomeMinor, p.spentMinor, p.backMinor, p.netMinor)).toBeGreaterThanOrEqual(0);
  });

  it('only the current period when nothing earlier is known, and transfers are never in or out', async () => {
    const { db, income, ctx, scope } = await setup(11, 1);
    await income(500_000, ist(11, 2));
    const r = await incomeVsExpense(db, scope('this_cycle'), ctx);
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]).toMatchObject({ label: 'Nov', incomeMinor: 500_000, spentMinor: 0, net: 'kept' });
  });

  it('a short period is labelled by its dates', async () => {
    const { db, ctx, scope } = await setup();
    const r = await incomeVsExpense(db, scope('seven_days'), ctx);
    expect(r.periods.at(-1)!.label).toBe('Nov 2–8');
  });
});
