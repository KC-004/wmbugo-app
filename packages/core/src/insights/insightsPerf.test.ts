import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { categoryNets, dayNets, incomeNet, merchantNets, spendingNet } from '../ledger/spendingQueries';
import { resolveInsightsPeriod } from '../profile/insightsPeriods';
import { spendingByCategory, spendingChange, spendingTotal, kept } from './spending';
import { spendingByMerchant } from './merchants';
import { incomeVsExpense, spendingTrend } from './trends';
import { onTrack } from './onTrack';
import { loadInsightsContext, type InsightsScope } from './scope';

const ist = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h, 0, 0) - 5.5 * 3_600_000;
const CATEGORIES = ['cat_food', 'cat_groceries', 'cat_transport', 'cat_housing', 'cat_bills', 'cat_shopping', 'cat_health', 'cat_entertainment'];
const MERCHANTS = ['Swiggy', 'Zomato', 'Amazon', 'Big Basket', 'Uber', 'Airtel', 'Apollo', 'BookMyShow', 'SWIGGY*BLR 8821', 'UPI-Amazon 4410'];

/** 10,000 confirmed entries across 24 months, written straight into SQLite so the test measures the queries, not the writer. */
async function bigLedger() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(ist(2024, 11, 1, 6), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(97)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' } as never, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 1_000_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const account = a.value.accountId;
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const stmts: string[] = [];
  for (let i = 0; i < 10_000; i++) {
    const monthIdx = rnd(24);
    const y = 2024 + Math.floor((10 + monthIdx) / 12);
    const m = ((10 + monthIdx) % 12) + 1;
    const d = 1 + rnd(28);
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const income = i % 40 === 0;
    const amount = 10_000 + rnd(500_000);
    const type = income ? 'income' : 'expense';
    const desc = income ? 'Acme Pay' : MERCHANTS[rnd(MERCHANTS.length)]!;
    const cat = income ? 'cat_in_salary' : CATEGORIES[rnd(CATEGORIES.length)]!;
    stmts.push(
      `INSERT INTO "transaction" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,original_description,tags_json,needs_category,created_at,updated_at) VALUES ('t${i}','${type}','confirmed',${amount},${i},'${date}','Asia/Kolkata','${desc.replace(/'/g, "''")}','[]',0,1,1)`,
      `INSERT INTO split (id,transaction_id,category_id,amount_minor) VALUES ('s${i}','t${i}','${cat}',${amount})`,
      `INSERT INTO posting (id,transaction_id,account_id,direction,signed_amount_minor,posting_kind) VALUES ('p${i}','t${i}','${account}','${income ? 'in' : 'out'}',${income ? amount : -amount},'normal')`,
    );
  }
  db.raw.exec('BEGIN');
  for (const s of stmts) db.raw.exec(s);
  db.raw.exec('COMMIT');
  clock.advance(ist(2026, 11, 8, 10) - clock.nowMs());
  const ctx = (await loadInsightsContext(db, clock.nowMs()))!;
  const scope = (preset: 'this_cycle' | 'this_year'): InsightsScope => ({ period: resolveInsightsPeriod(preset, ctx.today, ctx.profile)!, filters: {} });
  return { db, clock, ctx, scope };
}

describe('Insights over 10,000 entries across 24 months (Story 7.8, NFR-06)', () => {
  jest.setTimeout(120_000);
  let ledger: Awaited<ReturnType<typeof bigLedger>>;
  beforeAll(async () => {
    ledger = await bigLedger();
  });
  afterEach(() => jest.restoreAllMocks());

  it('every figure for the whole year comes back quickly and is consistent: the category nets add up to the total', async () => {
    const { db, ctx, scope, clock } = ledger;
    const s = scope('this_year');
    const t0 = Date.now();
    const by = await spendingByCategory(db, s);
    const total = await spendingTotal(db, s);
    await spendingChange(db, s, ctx);
    await kept(db, s);
    await spendingByMerchant(db, s);
    await spendingTrend(db, s, ctx);
    await incomeVsExpense(db, s, ctx);
    await onTrack(db, s, ctx, clock.nowMs());
    const ms = Date.now() - t0;
    expect(by.rows.reduce((x, r) => x + r.displayMinor - r.backMinor, 0)).toBe(total.spentMinor - total.backMinor);
    // A smoke guard on this machine, not the device benchmark: the real NFR-06 run is recorded on the reference devices.
    expect(ms).toBeLessThan(30_000);
  });

  it('aggregates in SQLite: every Insights statement groups or sums, and none returns a row per entry', async () => {
    const { db, scope } = ledger;
    const s = scope('this_year');
    const range = { start: s.period.start, end: s.period.end };
    const rec = { sql: [] as string[] };
    const sizes: number[] = [];
    const real = db.query.bind(db);
    jest.spyOn(db, 'query').mockImplementation(async (sql, params) => {
      const rows = await real(sql, params);
      if (/FROM split s JOIN "transaction" t|FROM "transaction" t WHERE/.test(sql)) sizes.push(rows.length);
      rec.sql.push(sql);
      return rows;
    });
    await categoryNets(db, range);
    await spendingNet(db, range);
    await dayNets(db, range);
    await incomeNet(db, range);
    await merchantNets(db, range);
    const heavy = rec.sql.filter((x) => /FROM split s JOIN "transaction" t|SUM\(t\.amount_minor\)/.test(x));
    expect(heavy.length).toBeGreaterThan(0);
    for (const q of heavy) expect(q).toMatch(/SUM\(|GROUP BY|COUNT\(/);
    // No statement hands back anything near one row per entry (10,000): categories, days and merchants are a few hundred at most.
    for (const n of sizes) expect(n).toBeLessThan(800);
  });

  it('the filtered split query is answered through an index on the transaction, not a scan of the whole ledger', async () => {
    const { db, scope } = ledger;
    const s = scope('this_cycle');
    const plan = await db.query(
      "EXPLAIN QUERY PLAN SELECT COALESCE(c.parent_id, c.id), SUM(CASE WHEN t.event_type = 'expense' THEN s.amount_minor ELSE -s.amount_minor END) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.local_date BETWEEN ? AND ? AND t.event_type IN ('expense','refund') GROUP BY 1",
      [s.period.start, s.period.end],
    );
    const text = plan.map((r) => String(r[3] ?? r.join(' '))).join('\n');
    expect(text).toMatch(/transaction_(status_date|date)_idx|USING (COVERING )?INDEX/i);
    expect(text).not.toMatch(/SCAN t\b|SCAN "transaction"|SCAN transaction/i);
  });
});
