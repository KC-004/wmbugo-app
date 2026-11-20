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
import { SaveBudget } from '../planning/budgetCommands';
import { CreateFiftyThirtyTwenty } from '../planning/budgetTemplate';
import { SaveGoal, SetAsideForGoal } from '../planning/goals';
import { isBudgetPeriod, onTrack } from './onTrack';
import { loadInsightsContext, type InsightsFilters, type InsightsScope } from './scope';

const ist = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(ist(10, 1, 6), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(89)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' } as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('account');
  const expense = async (amountMinor: number, when: number, categoryId = 'cat_food', accountId = a.value.accountId) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId, merchant: 'Shop', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  let n = 0;
  const refund = (originalId: string, amountMinor: number, when: number) => writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, occurredAtMs: when } }, 'user');
  const budget = async (over: Record<string, unknown>) => {
    const r = await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 5_000_000, alertLevels: [75, 90, 100], ...over } as never, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.budgetId;
  };
  clock.advance(ist(11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: PeriodPreset, filters: InsightsFilters = {}): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters });
  return { db, writer, clock, expense, refund, budget, ctx, scope, hdfc: a.value.accountId, cash: b.value.accountId };
}

describe('onTrack budgets (Story 7.7, INS-013)', () => {
  it('lists the overall budget first, then category budgets by percent used, highest first', async () => {
    const { db, clock, expense, budget, ctx, scope } = await setup();
    await budget({ scope: 'overall', targetMinor: 5_000_000 });
    await budget({ scope: 'category', categoryIds: ['cat_food'], targetMinor: 1_000_000 });
    await budget({ scope: 'category', categoryIds: ['cat_transport'], targetMinor: 400_000 });
    await expense(850_000, ist(11, 3), 'cat_food');
    await expense(380_000, ist(11, 4), 'cat_transport');
    const r = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    expect(r.budgetsState).toBe('ok');
    expect(r.budgets.map((x) => [x.group, x.usedMinor, x.status.percentUsed])).toEqual([['overall', 1_230_000, 25], ['categories', 380_000, 95], ['categories', 850_000, 85]]);
    expect(r.scope.label).toBe('1–30 Nov');
  });

  it('a past pay cycle shows that cycle with its own figures, and a refund surplus is carried on the row', async () => {
    const { db, clock, expense, refund, budget, ctx, scope } = await setup();
    await budget({ scope: 'category', categoryIds: ['cat_shopping'], targetMinor: 1_000_000 });
    const tv = await expense(900_000, ist(10, 20), 'cat_shopping');
    await expense(100_000, ist(11, 3), 'cat_shopping');
    await refund(tv, 900_000, ist(11, 5));
    const last = await onTrack(db, scope('last_cycle'), ctx, clock.nowMs());
    expect(last.budgets[0]).toMatchObject({ usedMinor: 900_000, periodLabel: '1–31 Oct' });
    const now = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    expect(now.budgets[0]).toMatchObject({ usedMinor: 0, refundSurplusMinor: 800_000 });
  });

  it('only whole budget periods show budgets: a 7-day or custom selection says to pick a cycle or month', async () => {
    const { db, clock, ctx, scope } = await setup();
    expect(isBudgetPeriod(scope('this_cycle'), ctx)).toBe(true);
    expect(isBudgetPeriod(scope('last_cycle'), ctx)).toBe(true);
    expect(isBudgetPeriod(scope('this_month'), ctx)).toBe(true);
    expect(isBudgetPeriod(scope('seven_days'), ctx)).toBe(false);
    const r = await onTrack(db, scope('seven_days'), ctx, clock.nowMs());
    expect(r).toMatchObject({ budgetsState: 'not_budget_period', budgets: [], nws: null });
  });

  it('an Insights filter never changes a budget: it keeps its own categories and accounts', async () => {
    const { db, clock, expense, budget, ctx, scope, cash } = await setup();
    await budget({ scope: 'overall', targetMinor: 5_000_000 });
    await expense(500_000, ist(11, 3));
    const plain = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    const filtered = await onTrack(db, scope('this_cycle', { accountIds: [cash] }), ctx, clock.nowMs());
    expect(plain.budgets.length).toBeGreaterThan(0);
    expect(filtered.budgets.map((x) => x.usedMinor)).toEqual(plain.budgets.map((x) => x.usedMinor));
  });

  it('no budgets gives an empty list, not an error', async () => {
    const { db, clock, ctx, scope } = await setup();
    expect((await onTrack(db, scope('this_cycle'), ctx, clock.nowMs())).budgets).toEqual([]);
  });
});

describe('onTrack Needs, Wants, Savings (INS-020)', () => {
  it('with 50/30/20 targets the rows carry used and target; the amounts and Not classified come from the same query as Plan', async () => {
    const { db, writer, clock, expense, ctx, scope } = await setup();
    const t = await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 10_000_000 }, 'user');
    expect(t.ok).toBe(true);
    await expense(2_200_000, ist(11, 3), 'cat_groceries'); // a need
    await expense(900_000, ist(11, 4), 'cat_shopping'); // a want
    await expense(300_000, ist(11, 5), 'cat_other'); // no type
    const r = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    expect(r.nws!.needs).toMatchObject({ usedMinor: 2_200_000, targetMinor: 5_000_000 });
    expect(r.nws!.wants).toMatchObject({ usedMinor: 900_000, targetMinor: 3_000_000 });
    expect(r.nws!.amounts).toMatchObject({ needsMinor: 2_200_000, wantsMinor: 900_000, notClassifiedMinor: 300_000 });
    expect(r.nws!.notClassifiedCategoryIds).toContain('cat_other');
  });

  it('without targets only the amounts are known', async () => {
    const { db, clock, expense, ctx, scope } = await setup();
    await expense(400_000, ist(11, 3), 'cat_groceries');
    const r = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    expect(r.nws).toMatchObject({ needs: null, wants: null, savings: null, amounts: { needsMinor: 400_000 } });
  });
});

describe('onTrack goals (INS-025)', () => {
  it('lists active and paused goals with their progress, whatever the period or filters', async () => {
    const { db, writer, clock, ctx, scope } = await setup();
    const g = await writer.run(SaveGoal, { name: 'Goa trip', targetMinor: 3_000_000, dueMonth: '2027-03', icon: 'Airplane', color: 'cat-cyan' }, 'user');
    if (!g.ok) throw new Error(g.code);
    await writer.run(SetAsideForGoal, { goalId: g.value.goalId, amountMinor: 500_000 }, 'user');
    const r = await onTrack(db, scope('seven_days', { categoryIds: ['cat_food'] }), ctx, clock.nowMs());
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0]).toMatchObject({ name: 'Goa trip', contributedMinor: 500_000, targetMinor: 3_000_000 });
  });

  it('no goals gives none', async () => {
    const { db, clock, ctx, scope } = await setup();
    expect((await onTrack(db, scope('this_cycle'), ctx, clock.nowMs())).goals).toEqual([]);
  });
});
