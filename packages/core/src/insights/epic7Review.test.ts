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
import { activityIdsQuery } from '../ledger/activitySearch';
import { filterFacets } from '../ledger/spendingQueries';
import { SetSplits } from '../ledger/splits';
import { SaveBudget } from '../planning/budgetCommands';
import { ChangeGoalState, SaveGoal } from '../planning/goals';
import { resolveInsightsPeriod, type PeriodPreset } from '../profile/insightsPeriods';
import { buildDrillCsv, CsvAmountError } from './csvExport';
import { drillDown } from './drilldown';
import { spendingByMerchant } from './merchants';
import { onTrack } from './onTrack';
import { loadInsightsContext, type InsightsFilters, type InsightsScope } from './scope';
import { spendingChange, spendingTotal } from './spending';
import { incomeVsExpense } from './trends';

const ist = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup(profileStart = ist(10, 1, 6)) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(profileStart, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(101)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' } as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('account');
  const hdfc = a.value.accountId;
  const expense = async (amountMinor: number, when: number, merchant: string | undefined, categoryId = 'cat_food', note?: string) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: hdfc, ...(merchant !== undefined ? { merchant } : {}), ...(note ? { note } : {}), occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const income = async (amountMinor: number, when: number) => {
    const r = await recordEntry(writer, { kind: 'income', amountMinor, categoryId: 'cat_in_salary', accountId: hdfc, merchant: 'Acme Pay', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
  };
  let n = 0;
  const refund = (originalId: string, amountMinor: number, when: number) => writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, occurredAtMs: when } }, 'user');
  const budget = async (over: Record<string, unknown>) => {
    const r = await writer.run(SaveBudget, { scope: 'category', categoryIds: ['cat_food'], accountIds: null, periodRule: 'default', targetMinor: 500_000, alertLevels: [75, 90, 100], ...over } as never, 'user');
    if (!r.ok) throw new Error(r.code);
  };
  clock.advance(ist(11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: PeriodPreset, filters: InsightsFilters = {}): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters });
  return { db, writer, clock, expense, income, refund, budget, ctx, scope, hdfc };
}

describe('tag and source filters run in SQL (review)', () => {
  it('a tag filter is an exact match: an underscore is not a wildcard and case matters', async () => {
    const { db, expense, scope } = await setup();
    const a = await expense(100_000, ist(11, 2), 'A');
    const b = await expense(200_000, ist(11, 3), 'B');
    const c = await expense(400_000, ist(11, 4), 'C');
    db.raw.exec(`UPDATE "transaction" SET tags_json = '["a_b"]' WHERE id = '${a}'`);
    db.raw.exec(`UPDATE "transaction" SET tags_json = '["axb"]' WHERE id = '${b}'`);
    db.raw.exec(`UPDATE "transaction" SET tags_json = '["Trip"]' WHERE id = '${c}'`);
    expect((await spendingTotal(db, scope('this_cycle', { tags: ['a_b'] }))).spentMinor).toBe(100_000);
    expect((await spendingTotal(db, scope('this_cycle', { tags: ['trip'] }))).spentMinor).toBe(0);
    expect((await spendingTotal(db, scope('this_cycle', { tags: ['Trip', 'axb'] }))).spentMinor).toBe(600_000);
  });

  it('a source filter counts only entries from that source', async () => {
    const { db, expense, scope } = await setup();
    const a = await expense(100_000, ist(11, 2), 'A');
    await expense(300_000, ist(11, 3), 'B');
    db.raw.exec(`UPDATE source_record SET source_kind = 'csv' WHERE transaction_id = '${a}'`);
    expect((await spendingTotal(db, scope('this_cycle', { sources: ['csv'] }))).spentMinor).toBe(100_000);
    expect((await spendingTotal(db, scope('this_cycle', { sources: ['manual'] }))).spentMinor).toBe(300_000);
  });

  it('the filter sheet options list the tags and sources present, and ignore a malformed tag list', async () => {
    const { db, expense } = await setup();
    const a = await expense(100_000, ist(11, 2), 'A');
    const b = await expense(100_000, ist(11, 3), 'B');
    db.raw.exec(`UPDATE "transaction" SET tags_json = '["work","trip"]' WHERE id = '${a}'`);
    db.raw.exec(`UPDATE "transaction" SET tags_json = 'not json' WHERE id = '${b}'`);
    db.raw.exec(`UPDATE source_record SET source_kind = 'upi' WHERE transaction_id = '${a}'`);
    const f = await filterFacets(db, { start: '2026-11-01', end: '2026-11-30' });
    expect(f.tags).toEqual(['trip', 'work']);
    expect([...f.sources].sort()).toEqual(['manual', 'upi']);
  });
});

describe('the merchant filter reaches past the period on screen (review)', () => {
  it('a refund in November of an October purchase follows its merchant, and the drill-down and the merchant row agree', async () => {
    const { db, expense, refund, ctx, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), 'Amazon', 'cat_shopping');
    await refund(tv, 400_000, ist(11, 5));
    await expense(100_000, ist(11, 6), 'Swiggy');
    const filtered = scope('this_cycle', { merchantKeys: ['amazon'] });
    expect(await spendingTotal(db, filtered)).toMatchObject({ spentMinor: 0, backMinor: 400_000 });
    const row = (await spendingByMerchant(db, scope('this_cycle'))).surplus.find((m) => m.key === 'amazon');
    expect(row?.backMinor).toBe(400_000);
    const d = await drillDown(db, scope('this_cycle'), { kind: 'merchant', key: 'amazon', name: 'Amazon' }, ctx);
    expect(d.backMinor).toBe(400_000);
    expect(d.days.flatMap((x) => x.entries)).toHaveLength(1);
  });

  it('the baseline of a merchant-filtered change counts spellings that only the earlier window has', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(100_000, ist(10, 5), 'Swiggy');
    await expense(50_000, ist(11, 4), 'Zomato');
    const c = await spendingChange(db, scope('this_cycle', { merchantKeys: ['swiggy'] }), ctx);
    expect(c).toMatchObject({ kind: 'change', direction: 'down', percent: 100, previousMinor: 100_000 });
  });
});

describe('the first day is the first confirmed entry (review)', () => {
  it('a rejected or deleted early entry does not move it', async () => {
    const { db, expense, clock } = await setup(ist(11, 1, 6));
    const early = await expense(100_000, ist(9, 5), 'Early');
    const gone = await expense(100_000, ist(9, 6), 'Gone');
    db.raw.exec(`UPDATE "transaction" SET status = 'excluded' WHERE id = '${early}'`);
    db.raw.exec(`UPDATE "transaction" SET removed_at = 1, removal_kind = 'deleted' WHERE id = '${gone}'`);
    const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
    expect(ctx.firstDay).toBe('2026-11-01');
  });
});

describe('income against expense counts a refund surplus as kept (review)', () => {
  it('income ₹1,000 and a ₹9,000 refund of an October purchase keeps ₹10,000', async () => {
    const { db, expense, income, refund, ctx, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), 'Amazon', 'cat_shopping');
    await income(100_000, ist(11, 2));
    await refund(tv, 900_000, ist(11, 5));
    const r = await incomeVsExpense(db, scope('this_cycle'), ctx);
    expect(r.periods.at(-1)).toMatchObject({ incomeMinor: 100_000, spentMinor: 0, backMinor: 900_000, net: 'kept', netMinor: 1_000_000 });
  });

  it('a transfer is in neither column', async () => {
    const { db, writer, hdfc, ctx, scope } = await setup();
    const cash = (await db.query("SELECT id FROM account WHERE name = 'Cash'"))[0]![0] as string;
    const t = await recordTransfer(writer, { amountMinor: 500_000, fromAccountId: hdfc, toAccountId: cash, occurredAtMs: ist(11, 3) });
    expect(t.ok).toBe(true);
    const r = await incomeVsExpense(db, scope('this_cycle'), ctx);
    expect(r.periods.at(-1)).toMatchObject({ incomeMinor: 0, spentMinor: 0, backMinor: 0, net: 'even' });
  });
});

describe('budgets in a running or past period (review)', () => {
  it('a weekly budget viewed in this cycle shows the week around today, the way Plan does, not the last week of the month', async () => {
    const { db, clock, expense, budget, ctx, scope } = await setup();
    await budget({ periodRule: 'weekly' });
    await expense(100_000, ist(11, 3), 'Swiggy');
    const r = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    expect(r.budgets[0]).toMatchObject({ usedMinor: 100_000, period: { start: '2026-11-02', end: '2026-11-08' } });
  });

  it('a weekly budget viewed in last cycle shows the week that overlaps the cycle end', async () => {
    const { db, clock, budget, ctx, scope } = await setup();
    await budget({ periodRule: 'weekly' });
    const r = await onTrack(db, scope('last_cycle'), ctx, clock.nowMs());
    expect(r.budgets[0]!.periodLabel).toMatch(/^Weekly · /);
    expect(r.budgets[0]!.period.start <= '2026-10-31' && r.budgets[0]!.period.end >= '2026-10-31').toBe(true);
  });
});

describe('a split entry in a drill-down (review)', () => {
  it('shows only the portion in the category being drilled, and the two portions add up to the whole', async () => {
    const { db, writer, expense, ctx, scope } = await setup();
    const id = await expense(100_000, ist(11, 4), 'Mixed Mart', 'cat_groceries');
    const r = await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 70_000 }, { categoryId: 'cat_personal', amountMinor: 30_000 }] }, 'user');
    expect(r.ok).toBe(true);
    const groceries = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_groceries', name: 'Groceries' }, ctx);
    const personal = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_personal', name: 'Personal Care' }, ctx);
    expect(groceries.days[0]!.entries[0]).toMatchObject({ id, amountMinor: 70_000 });
    expect(personal.days[0]!.entries[0]).toMatchObject({ id, amountMinor: 30_000 });
    expect(groceries.spentMinor + personal.spentMinor).toBe(100_000);
    expect((await drillDown(db, scope('this_cycle'), { kind: 'spent' }, ctx)).days[0]!.entries).toHaveLength(2);
  });
});

describe('goals on track are the active and paused ones (review)', () => {
  it('lists a paused goal and leaves out an archived one', async () => {
    const { db, writer, clock, ctx, scope } = await setup();
    const make = async (name: string) => {
      const g = await writer.run(SaveGoal, { name, targetMinor: 1_000_000, icon: 'Airplane', color: 'cat-cyan' }, 'user');
      if (!g.ok) throw new Error(g.code);
      return g.value.goalId;
    };
    const paused = await make('Paused one');
    const archived = await make('Archived one');
    await make('Active one');
    await writer.run(ChangeGoalState, { goalId: paused, to: 'paused' }, 'user');
    await writer.run(ChangeGoalState, { goalId: archived, to: 'archived' }, 'user');
    const r = await onTrack(db, scope('this_cycle'), ctx, clock.nowMs());
    expect(r.goals.map((g) => g.name).sort()).toEqual(['Active one', 'Paused one']);
  });
});

describe('the CSV is safe to open (review)', () => {
  it('carries the note, keeps a hostile header on one line, and refuses to write a blank amount', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(123_456, ist(11, 3), 'Cafe', 'cat_food', 'with, comma');
    const d = await drillDown(db, scope('this_cycle'), { kind: 'category', id: 'cat_food', name: 'Food' }, ctx);
    const csv = buildDrillCsv(d, { timezoneId: 'Asia/Kolkata', currencyCode: 'INR', exponent: 2, filtersText: 'Account X\n2026-11-03,=HYPERLINK("x")' });
    const lines = csv.split('\n');
    expect(lines[1]).toBe('# Filters: Account X 2026-11-03,=HYPERLINK("x")');
    expect(lines).toContain('2026-11-03,Cafe,Food & Drinks,HDFC,expense,1234.56,INR,"with, comma"');
    expect(() => buildDrillCsv(d, { timezoneId: 'Asia/Kolkata', currencyCode: 'INR', exponent: -1, filtersText: '' })).toThrow(CsvAmountError);
  });
});

describe('Activity applies the merchant, tag and source filters a drill-down hands it (review, Story 7.2)', () => {
  const ids = async (db: NodeSqliteDatabase, q: Parameters<typeof activityIdsQuery>[0]) => {
    const { sql, params } = activityIdsQuery(q, { exponent: 2, nowMs: ist(11, 8) });
    return (await db.query(sql, params)).map((r) => String(r[0])).sort();
  };

  it('lists the same entries as the figure: a merchant spelling, a refund under its original merchant, a tag and a source', async () => {
    const { db, expense, refund } = await setup();
    const a = await expense(100_000, ist(11, 2), 'Swiggy');
    const b = await expense(200_000, ist(11, 3), 'Zomato');
    const tv = await expense(900_000, ist(10, 20), 'Amazon', 'cat_shopping');
    await refund(tv, 400_000, ist(11, 5));
    db.raw.exec(`UPDATE "transaction" SET tags_json = '["trip"]' WHERE id = '${b}'`);
    db.raw.exec(`UPDATE source_record SET source_kind = 'csv' WHERE transaction_id = '${a}'`);
    const nov = { fromDate: '2026-11-01', toDate: '2026-11-30' };
    expect(await ids(db, { ...nov, descriptions: ['Swiggy'] })).toEqual([a]);
    expect(await ids(db, { ...nov, tags: ['trip'] })).toEqual([b]);
    expect(await ids(db, { ...nov, sources: ['csv'] })).toEqual([a]);
    const amazon = await ids(db, { ...nov, descriptions: ['Amazon'] });
    expect(amazon).toHaveLength(1);
    expect(amazon[0]).not.toBe(tv);
  });
});
