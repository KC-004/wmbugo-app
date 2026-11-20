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
import { bucketsOf, granularityFor } from '../profile/insightsBuckets';
import { resolveInsightsPeriod, type PeriodPreset } from '../profile/insightsPeriods';
import { buildCsv, csvCell } from '../shared/csv';
import { buildDrillCsv, csvFileName } from './csvExport';
import { drillDown, narrowScope, type DrillTarget } from './drilldown';
import { loadInsightsContext, type InsightsFilters, type InsightsScope } from './scope';
import { spendingByCategory, spendingTotal, incomeTotal } from './spending';

const ist = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(ist(10, 1, 6), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(73)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' } as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('account');
  const expense = async (amountMinor: number, when: number, over: { categoryId?: string; accountId?: string; merchant?: string } = {}) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: over.categoryId ?? 'cat_food', accountId: over.accountId ?? a.value.accountId, merchant: over.merchant ?? 'Swiggy', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const income = async (amountMinor: number, when: number) => {
    const r = await recordEntry(writer, { kind: 'income', amountMinor, categoryId: 'cat_in_salary', accountId: a.value.accountId, merchant: 'Acme Pay', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
  };
  let n = 0;
  const refund = (originalId: string, amountMinor: number, when: number) => writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, occurredAtMs: when } }, 'user');
  clock.advance(ist(11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: PeriodPreset, filters: InsightsFilters = {}): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters });
  return { db, expense, income, refund, ctx, scope, hdfc: a.value.accountId, cash: b.value.accountId };
}

describe('the drill-down lists exactly what the figure counted (Story 7.3, PRD 8.9)', () => {
  it('Spent: the entries sum to the Spent figure, with a refund subtracting, for the whole period', async () => {
    const { db, expense, refund, ctx, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), { categoryId: 'cat_shopping' });
    await expense(1_000_000, ist(11, 3));
    await expense(200_000, ist(11, 4), { categoryId: 'cat_shopping', merchant: 'Amazon' });
    await refund(tv, 400_000, ist(11, 5));
    const d = await drillDown(db, scope('this_cycle'), { kind: 'spent' }, ctx);
    const total = await spendingTotal(db, scope('this_cycle'));
    expect(d.spentMinor).toBe(total.spentMinor);
    expect(d.backMinor).toBe(total.backMinor);
    expect(d.spentMinor).toBe(800_000);
    const flat = d.days.flatMap((x) => x.entries);
    expect(flat.reduce((s, e) => s + (e.type === 'refund' ? -e.amountMinor : e.amountMinor), 0)).toBe(800_000);
    expect(d.explanation).toMatchObject({ formula: 'spent', timeframe: '1–30 Nov', entryCount: 3 });
  });

  it('every segment type reconciles: category, merchant, day, account filter and income', async () => {
    const { db, expense, income, refund, ctx, scope, cash } = await setup();
    const tv = await expense(900_000, ist(10, 20), { categoryId: 'cat_shopping' });
    await expense(1_000_000, ist(11, 3));
    await expense(250_000, ist(11, 3), { merchant: 'SWIGGY*BLR 8821' });
    await expense(30_000, ist(11, 5), { categoryId: 'cat_shopping', merchant: 'Amazon', accountId: cash });
    await refund(tv, 100_000, ist(11, 6));
    await income(8_500_000, ist(11, 1));
    const sum = (d: Awaited<ReturnType<typeof drillDown>>) => d.days.flatMap((x) => x.entries).reduce((s, e) => s + (e.type === 'refund' ? -e.amountMinor : e.amountMinor), 0);
    const cases: { target: DrillTarget; expected: () => Promise<number>; scope?: InsightsScope }[] = [
      { target: { kind: 'category', id: 'cat_food', name: 'Food' }, expected: async () => (await spendingByCategory(db, { ...scope('this_cycle'), filters: { categoryIds: ['cat_food'] } })).rows.reduce((s, r) => s + r.displayMinor - r.backMinor, 0) },
      { target: { kind: 'merchant', key: 'swiggy', name: 'Swiggy' }, expected: async () => 1_250_000 },
      { target: { kind: 'bucket', start: '2026-11-03', end: '2026-11-03', label: 'Nov 3' }, expected: async () => 1_250_000 },
      { target: { kind: 'spent' }, scope: scope('this_cycle', { accountIds: [cash] }), expected: async () => 30_000 },
      { target: { kind: 'income' }, expected: async () => (await incomeTotal(db, scope('this_cycle'))).incomeMinor },
    ];
    for (const c of cases) {
      const d = await drillDown(db, c.scope ?? scope('this_cycle'), c.target, ctx);
      expect(sum(d)).toBe(await c.expected());
    }
  });

  it('a refund-surplus segment reads backMinor with its entries, never a negative; a segment with nothing has no entries', async () => {
    const { db, expense, refund, ctx, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), { categoryId: 'cat_shopping' });
    await refund(tv, 900_000, ist(11, 5));
    const d = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_shopping', name: 'Shopping' }, ctx);
    expect(d).toMatchObject({ spentMinor: 0, backMinor: 900_000 });
    expect(d.days[0]).toMatchObject({ backMinor: 900_000, spentMinor: 0 });
    const none = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_transport', name: 'Transport' }, ctx);
    expect(none).toMatchObject({ spentMinor: 0, backMinor: 0 });
    expect(none.days).toEqual([]);
  });

  it('a split entry shows only the portion in the category being drilled', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(100_000, ist(11, 4));
    const d = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_food', name: 'Food' }, ctx);
    expect(d.days[0]!.entries[0]).toMatchObject({ amountMinor: 100_000, merchant: 'Swiggy', accountName: 'HDFC' });
  });
});

describe('the chart behind a drill-down', () => {
  it('has a bar per day for a month, with empty days at zero, and the bars add up to the figure', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(100_000, ist(11, 3));
    await expense(50_000, ist(11, 3));
    await expense(70_000, ist(11, 20));
    const d = await drillDown(db, scope('this_cycle'), { kind: 'spent' }, ctx);
    expect(d.granularity).toBe('day');
    expect(d.buckets).toHaveLength(30);
    expect(d.buckets.find((b) => b.start === '2026-11-03')).toMatchObject({ spentMinor: 150_000, label: 'Nov 3' });
    expect(d.buckets.find((b) => b.start === '2026-11-04')).toMatchObject({ spentMinor: 0, backMinor: 0 });
    expect(d.buckets.reduce((s, b) => s + b.spentMinor, 0)).toBe(d.spentMinor);
  });

  it('uses weeks over 31 days and months over 92 days, clipped to the period', () => {
    const profile = { rule: { kind: 'first' } as never, firstDay: 'mon' as const };
    expect(granularityFor({ start: '2026-11-01', end: '2026-11-30' })).toBe('day');
    expect(granularityFor({ start: '2026-10-01', end: '2026-11-15' })).toBe('week');
    expect(granularityFor({ start: '2026-01-01', end: '2026-11-08' })).toBe('month');
    const weeks = bucketsOf({ start: '2026-10-01', end: '2026-11-15' }, 'week', profile.firstDay);
    expect(weeks[0]).toEqual({ start: '2026-10-01', end: '2026-10-04' });
    expect(weeks.at(-1)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    const months = bucketsOf({ start: '2026-01-15', end: '2026-04-10' }, 'month', profile.firstDay);
    expect(months.map((m) => m.start)).toEqual(['2026-01-15', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(months.at(-1)!.end).toBe('2026-04-10');
  });
});

describe('How this is worked out', () => {
  it('names the baseline for the Spent figure when there is one, and says none when there is not', async () => {
    const { db, expense, ctx, scope } = await setup();
    const none = await drillDown(db, scope('this_cycle'), { kind: 'spent' }, ctx);
    expect(none.explanation.baseline).toEqual({ kind: 'none' });
    await expense(1_250_000, ist(10, 5));
    await expense(1_400_000, ist(11, 4));
    const some = await drillDown(db, scope('this_cycle'), { kind: 'spent' }, ctx);
    expect(some.explanation.baseline).toEqual({ kind: 'amount', label: 'Oct 1–8', previousMinor: 1_250_000 });
    expect((await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_food', name: 'Food' }, ctx)).explanation.baseline).toBeNull();
  });

  it('narrowing a scope changes only what the target names and leaves the overview alone', async () => {
    const { ctx, scope } = await setup();
    const base = scope('this_cycle', { accountIds: ['a'] });
    expect(narrowScope(base, { kind: 'category', id: 'c', name: 'C' }).filters).toEqual({ accountIds: ['a'], categoryIds: ['c'] });
    expect(narrowScope(base, { kind: 'bucket', start: '2026-11-05', end: '2026-11-05', label: 'Nov 5' }).period).toMatchObject({ start: '2026-11-05', end: '2026-11-05' });
    expect(base.period.start).toBe('2026-11-01');
    expect(ctx.today).toBe('2026-11-08');
  });
});

describe('the CSV export (INS-006)', () => {
  it('escapes formula starts, quotes and commas, and writes the header lines and one row per entry', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(123_456, ist(11, 3), { merchant: '=SUM(A1)' });
    await expense(50_000, ist(11, 4), { merchant: 'Cafe, "Big" Bean' });
    const d = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_food', name: 'Food' }, ctx);
    const csv = buildDrillCsv(d, { timezoneId: 'Asia/Kolkata', currencyCode: 'INR', exponent: 2, filtersText: 'Category Food' });
    const lines = csv.split('\n');
    expect(lines.slice(0, 6)).toEqual(['# Period 2026-11-01 to 2026-11-30 (inclusive)', '# Filters: Category Food', '# Timezone Asia/Kolkata', '# Currency INR', '# Schema wmbugo-insights-1', 'date,merchant,category,account,type,amount,currency,note']);
    expect(lines).toContain("2026-11-03,'=SUM(A1),Food & Drinks,HDFC,expense,1234.56,INR,");
    expect(lines).toContain('2026-11-04,"Cafe, ""Big"" Bean",Food & Drinks,HDFC,expense,500.00,INR,');
    expect(csv.endsWith('\n')).toBe(true);
    expect(csv).not.toMatch(/,-\d/);
  });

  it('every dangerous cell start is prefixed and a plain cell is left alone', () => {
    for (const c of ['=1+1', '+1', '-1', '@x', '\tx', '\rx']) expect(csvCell(c).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('Swiggy')).toBe('Swiggy');
    expect(csvCell(null)).toBe('');
    expect(buildCsv(['# h'], ['a'], [['1']])).toBe('# h\na\n1\n');
  });

  it('names the file after the segment and the dates', () => {
    expect(csvFileName('Food & Drinks', '2026-11-01', '2026-11-30')).toBe('wmbugo-food-drinks-2026-11-01-to-2026-11-30.csv');
    expect(csvFileName('', '2026-11-01', '2026-11-30')).toBe('wmbugo-spending-2026-11-01-to-2026-11-30.csv');
  });
});
