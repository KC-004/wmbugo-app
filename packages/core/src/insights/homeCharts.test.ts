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
import { ACTIVITY_SQL, groupByDay, mapActivityRows } from '../ledger/readModels';
import { SubmitCapture } from '../capture/submitCapture';
import { homeSpend7d, homeTopCategories } from './homeCharts';

const DAY = 86_400_000;
const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 10, 0, 0); // 18 Nov 2026, 15:30 in Kolkata

async function setup(createdDaysAgo = 30) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW - createdDaysAgo * DAY, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(29)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(createdDaysAgo * DAY);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const bank = a.value.accountId;
  const spend = async (categoryId: string, amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: bank, merchant: 'X', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const refund = async (originalId: string, amountMinor: number) => {
    const r = await writer.run(SubmitCapture, { submissionId: `rf-${originalId}`, sourceKind: 'manual', refund: { originalId, amountMinor, recoveryKind: 'refund' } }, 'user');
    if (!r.ok) throw new Error(r.code);
  };
  return { db, writer, spend, refund };
}

describe('homeTopCategories (Story 5.5)', () => {
  it('ranks refund-net spending, the most first, with each share of the period', async () => {
    const { db, spend } = await setup();
    await spend('cat_food', 420_000, ist(11, 3));
    await spend('cat_groceries', 600_000, ist(11, 4));
    await spend('cat_transport', 180_000, ist(11, 5));
    const t = (await homeTopCategories(db, NOW))!;
    expect(t.rows.map((r) => [r.name, r.amountMinor, r.sharePercent])).toEqual([['Groceries', 600_000, 50], ['Food & Drinks', 420_000, 35], ['Transport', 180_000, 15]]);
    expect(t.totalMinor).toBe(1_200_000);
    expect(t.rows[0]).toMatchObject({ icon: expect.any(String), colorToken: expect.stringMatching(/^cat-/), categoryIds: expect.arrayContaining(['cat_groceries']) });
    expect(t.period).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });

  it('keeps five, and counts the others in the share', async () => {
    const { db, spend } = await setup();
    const ids = ['cat_food', 'cat_groceries', 'cat_transport', 'cat_housing', 'cat_family', 'cat_health'];
    for (const [i, id] of ids.entries()) await spend(id, (600 - i * 50) * 1000, ist(11, 2 + i));
    const t = (await homeTopCategories(db, NOW))!;
    expect(t.rows).toHaveLength(5);
    expect(t.totalMinor).toBeGreaterThan(t.rows.reduce((s, r) => s + r.amountMinor, 0));
  });

  it('shows Uncategorised as Not classified, ranked like any category', async () => {
    const { db, spend } = await setup();
    await spend('cat_food', 100_000, ist(11, 3));
    await spend('cat_uncategorised', 300_000, ist(11, 4));
    const t = (await homeTopCategories(db, NOW))!;
    expect(t.rows.map((r) => r.name)).toEqual(['Not classified', 'Food & Drinks']);
  });

  it('a category whose refunds exceed its spending this period is not ranked, and no amount is negative', async () => {
    const { db, spend, refund } = await setup();
    const old = await spend('cat_shopping', 900_000, ist(10, 5)); // bought in October
    await spend('cat_shopping', 200_000, ist(11, 3));
    await refund(old, 900_000); // refunded in November: net 2,000 - 9,000
    await spend('cat_food', 100_000, ist(11, 4));
    const t = (await homeTopCategories(db, NOW))!;
    expect(t.rows.map((r) => r.name)).toEqual(['Food & Drinks']);
    expect(t.rows.every((r) => r.amountMinor > 0)).toBe(true);
  });

  it('a ranked category never reads 0 percent', async () => {
    const { db, spend } = await setup();
    await spend('cat_food', 10_000_000, ist(11, 3));
    await spend('cat_transport', 100, ist(11, 4));
    const t = (await homeTopCategories(db, NOW))!;
    expect(t.rows.map((r) => r.sharePercent).every((p) => p >= 1)).toBe(true);
  });

  it('has no rows with no spending, and is null before onboarding', async () => {
    const { db } = await setup();
    expect(await homeTopCategories(db, NOW)).toMatchObject({ rows: [], totalMinor: 0 });
    expect(await homeTopCategories(new NodeSqliteDatabase().applyRealMigrations(), NOW)).toBeNull();
  });
});

describe('homeSpend7d (Story 5.5)', () => {
  it('gives seven days ending today, the last one labelled Today, refund-net and floored at zero', async () => {
    const { db, spend, refund } = await setup();
    await spend('cat_food', 100_000, ist(11, 12));
    const big = await spend('cat_food', 50_000, ist(11, 14));
    await spend('cat_food', 70_000, ist(11, 18));
    await refund(big, 20_000); // today: refund-net of the original's own day is not today's business, the refund lands today
    const s = (await homeSpend7d(db, NOW))!;
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
    expect(s.days.map((d) => d.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Today']);
    expect(s.days[0]!.spentMinor).toBe(100_000);
    expect(s.days[2]!.spentMinor).toBe(50_000);
    expect(s.days[6]!.spentMinor).toBe(50_000); // 70,000 spent, 20,000 refunded today
    expect(s.days[6]!.isToday).toBe(true);
    expect(s.since).toBeNull();
  });

  it('matches the Activity day header Spent for every day (cross-check)', async () => {
    const { db, spend, refund } = await setup();
    const a = await spend('cat_food', 100_000, ist(11, 14));
    await spend('cat_groceries', 40_000, ist(11, 14));
    await spend('cat_food', 90_000, ist(11, 16));
    await refund(a, 30_000);
    const s = (await homeSpend7d(db, NOW))!;
    const rows = mapActivityRows(await db.query(ACTIVITY_SQL, [100]));
    const header = new Map(groupByDay(rows).map((g) => [g.localDate, g.spentMinor]));
    for (const d of s.days) expect(d.spentMinor).toBe(header.get(d.date) ?? 0);
  });

  it('a profile created three days ago shows only those days with Since, and later empty days are real zeros', async () => {
    const { db, spend } = await setup(3);
    await spend('cat_food', 80_000, ist(11, 16));
    const s = (await homeSpend7d(db, NOW))!;
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
    expect(s.since).toBe('2026-11-15');
    expect(s.days.map((d) => d.spentMinor)).toEqual([0, 80_000, 0, 0]);
  });

  it('a profile that claims to be created in the future still gives today, never an empty card', async () => {
    const { db } = await setup(0);
    await db.query('UPDATE profile SET created_at = ?', [NOW + 3 * DAY]);
    const s = (await homeSpend7d(db, NOW))!;
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-18']);
  });

  it('is null before onboarding', async () => {
    expect(await homeSpend7d(new NodeSqliteDatabase().applyRealMigrations(), NOW)).toBeNull();
  });
});
