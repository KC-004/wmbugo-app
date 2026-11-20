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
import { drillDown } from './drilldown';
import { spendingByMerchant } from './merchants';
import { loadInsightsContext, type InsightsFilters, type InsightsScope } from './scope';
import { spendingTotal } from './spending';

const ist = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(ist(10, 1, 6), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(83)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' } as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const expense = async (amountMinor: number, when: number, merchant: string | undefined, categoryId = 'cat_food') => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: a.value.accountId, ...(merchant !== undefined ? { merchant } : {}), occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  let n = 0;
  const refund = (originalId: string, amountMinor: number, when: number) => writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, occurredAtMs: when } }, 'user');
  clock.advance(ist(11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: PeriodPreset, filters: InsightsFilters = {}): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters });
  return { db, expense, refund, ctx, scope };
}

describe('spendingByMerchant (Story 7.6, INS-014)', () => {
  it('folds every spelling of a merchant into one, ranked by amount with the entry count and the best spelling as its name', async () => {
    const { db, expense, scope } = await setup();
    await expense(300_000, ist(11, 2), 'SWIGGY*BLR 8821');
    await expense(250_000, ist(11, 3), 'Swiggy');
    await expense(95_000, ist(11, 4), 'swiggy order 4410');
    await expense(100_000, ist(11, 5), 'Big Basket');
    const r = await spendingByMerchant(db, scope('this_cycle'));
    expect(r.ranked.map((m) => [m.key, m.displayMinor, m.entries])).toEqual([['swiggy', 645_000, 3], ['big basket', 100_000, 1]]);
    expect(r.ranked[0]!.name).toBe('SWIGGY*BLR 8821');
    expect(r.scope.label).toBe('1–30 Nov');
  });

  it('entries with no merchant form one No merchant group after the ranked ones, and are not ranked among them', async () => {
    const { db, expense, scope } = await setup();
    await expense(500_000, ist(11, 2), 'Swiggy');
    await expense(180_000, ist(11, 3), undefined);
    await expense(20_000, ist(11, 4), undefined);
    const r = await spendingByMerchant(db, scope('this_cycle'));
    expect(r.ranked.map((m) => m.key)).toEqual(['swiggy']);
    expect(r.noMerchant).toMatchObject({ name: 'No merchant', displayMinor: 200_000, entries: 2, noMerchant: true });
  });

  it('a merchant whose refunds are more than its spending is listed as back, not among the ranked, with no negative anywhere', async () => {
    const { db, expense, refund, scope } = await setup();
    const tv = await expense(900_000, ist(10, 20), 'Amazon', 'cat_shopping');
    await refund(tv, 900_000, ist(11, 5));
    await expense(100_000, ist(11, 6), 'Swiggy');
    const r = await spendingByMerchant(db, scope('this_cycle'));
    expect(r.ranked.map((m) => m.key)).toEqual(['swiggy']);
    expect(r.surplus).toHaveLength(1);
    expect(r.surplus[0]).toMatchObject({ name: 'Amazon', displayMinor: 0, backMinor: 900_000 });
    for (const m of [...r.ranked, ...r.surplus]) expect(Math.min(m.displayMinor, m.backMinor, m.entries)).toBeGreaterThanOrEqual(0);
  });

  it('a merchant filter leaves only that merchant, and its drill-down sums to its bar', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(300_000, ist(11, 2), 'SWIGGY*BLR 8821');
    await expense(250_000, ist(11, 3), 'Swiggy');
    await expense(100_000, ist(11, 5), 'Big Basket');
    const r = await spendingByMerchant(db, scope('this_cycle', { merchantKeys: ['swiggy'] }));
    expect(r.ranked.map((m) => m.key)).toEqual(['swiggy']);
    const d = await drillDown(db, scope('this_cycle'), { kind: 'merchant', key: 'swiggy', name: 'Swiggy' }, ctx);
    expect(d.spentMinor).toBe(550_000);
    expect(d.days.flatMap((x) => x.entries)).toHaveLength(2);
  });

  it('No merchant opens its entries the same way, and the groups add up to the period total', async () => {
    const { db, expense, ctx, scope } = await setup();
    await expense(500_000, ist(11, 2), 'Swiggy');
    await expense(200_000, ist(11, 3), undefined);
    const d = await drillDown(db, scope('this_cycle'), { kind: 'merchant', key: '', name: 'No merchant' }, ctx);
    expect(d.spentMinor).toBe(200_000);
    const r = await spendingByMerchant(db, scope('this_cycle'));
    const sum = [...r.ranked, ...(r.noMerchant ? [r.noMerchant] : [])].reduce((s, m) => s + m.displayMinor, 0);
    expect(sum).toBe((await spendingTotal(db, scope('this_cycle'))).spentMinor);
  });

  it('nothing spent gives nothing', async () => {
    const { db, scope } = await setup();
    expect(await spendingByMerchant(db, scope('this_cycle'))).toMatchObject({ ranked: [], noMerchant: null, surplus: [] });
  });
});
