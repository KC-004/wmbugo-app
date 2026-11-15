import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import type { PaydayRule } from '../profile/payday';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { SaveBudget } from '../planning/budgetCommands';
import { CreateFiftyThirtyTwenty } from '../planning/budgetTemplate';
import { SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL } from '../ledger/readModels';
import { TO_CHECK_SQL } from '../capture/reviewQueue';
import { homeSummary } from './homeSummary';

const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 10, 0, 0); // 18 Nov 2026, 15:30 in Kolkata

async function setup(payday: PaydayRule = { kind: 'first' }, withAccount = true) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(7)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  let bank = '';
  if (withAccount) {
    const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
    if (!a.ok) throw new Error('account');
    bank = a.value.accountId;
  }
  const spend = async (categoryId: string, amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: bank, merchant: 'X', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
  };
  return { db, writer, spend, bank };
}

const overall = (targetMinor: number) => ({ scope: 'overall' as const, categoryIds: [], accountIds: null, periodRule: 'default' as const, targetMinor, alertLevels: [75, 90, 100] });

describe('homeSummary (Story 5.1)', () => {
  it('under an overall budget: left, used, target and the days to payday', async () => {
    const { db, writer, spend } = await setup();
    await writer.run(SaveBudget, overall(2_000_000), 'user');
    await spend('cat_food', 814_000, ist(11, 3));
    const s = (await homeSummary(db, NOW))!;
    expect(s).toMatchObject({ today: '2026-11-18', heroMode: 'overall', leftMinor: 1_186_000, usedMinor: 814_000, targetMinor: 2_000_000, notClassifiedMinor: 0, spentThisPeriodMinor: 814_000, daysLeft: 13, daysToPayday: 13, toCheckCount: 0 });
    expect(s.period).toMatchObject({ start: '2026-11-01', end: '2026-11-30', shortened: false });
    expect(s.accounts.hasAccounts).toBe(true);
  });

  it('over the budget: left goes below zero for the presenter to show as Over', async () => {
    const { db, writer, spend } = await setup();
    await writer.run(SaveBudget, overall(2_000_000), 'user');
    await spend('cat_food', 2_234_000, ist(11, 3));
    expect(await homeSummary(db, NOW)).toMatchObject({ heroMode: 'overall', leftMinor: -234_000, usedMinor: 2_234_000 });
  });

  it('only 50/30/20: nws_only with the not-classified part named', async () => {
    const { db, writer, spend } = await setup();
    await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000, targets: { needsMinor: 2_500_000, wantsMinor: 1_500_000, savingsMinor: 500_000 } }, 'user');
    await spend('cat_groceries', 1_500_000, ist(11, 3));
    await spend('cat_uncategorised', 300_000, ist(11, 5));
    expect(await homeSummary(db, NOW)).toMatchObject({ heroMode: 'nws_only', targetMinor: 4_000_000, usedMinor: 1_800_000, leftMinor: 2_200_000, notClassifiedMinor: 300_000 });
  });

  it('no budget: spent_only with the refund-net spent figure and no budget numbers', async () => {
    const { db, spend } = await setup();
    await spend('cat_food', 120_000, ist(11, 3));
    expect(await homeSummary(db, NOW)).toMatchObject({ heroMode: 'spent_only', leftMinor: null, usedMinor: null, targetMinor: null, spentThisPeriodMinor: 120_000 });
  });

  it('not salaried: no days to payday, but days left in the month', async () => {
    const { db } = await setup({ kind: 'none' });
    expect(await homeSummary(db, NOW)).toMatchObject({ daysToPayday: null, daysLeft: 13 });
  });

  it('a payday mid-month counts the days until the next payday', async () => {
    const { db } = await setup({ kind: 'day', day: 25 });
    const s = (await homeSummary(db, NOW))!;
    expect(s.period).toMatchObject({ start: '2026-10-25', end: '2026-11-24' });
    expect(s.daysToPayday).toBe(7); // 18 Nov to 25 Nov
    expect(s.daysLeft).toBe(7);
  });

  it('no accounts: hasAccounts is false and nothing is invented', async () => {
    const { db } = await setup({ kind: 'first' }, false);
    const s = (await homeSummary(db, NOW))!;
    expect(s.accounts).toMatchObject({ hasAccounts: false, inAccountsMinor: null, cardDuesMinor: null });
  });

  it('the review queue count is the number of entries that need checking', async () => {
    const { db } = await setup();
    db.raw.exec(
      `INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('w1','expense','needs_review',5000,${NOW},'2026-11-17','Asia/Kolkata',${NOW},${NOW})`,
    );
    expect((await homeSummary(db, NOW))!.toCheckCount).toBe(1);
  });

  it('is null before onboarding has made a profile', async () => {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    expect(await homeSummary(db, NOW)).toBeNull();
  });
});

describe('Home query plans and size (Story 5.1, NFR-05)', () => {
  const plan = async (db: NodeSqliteDatabase, sql: string, params: (string | number)[]) =>
    (await db.query(`EXPLAIN QUERY PLAN ${sql}`, params)).map((r) => String(r[3])).join(' | ');

  // A SCAN line without an index means a table scan (older SQLite prints SCAN TABLE).
  const scans = (p: string) => p.split(' | ').filter((l) => /^SCAN (TABLE )?"?(transaction|split)"?( |$)/.test(l) && !/USING/.test(l));

  it('the check itself sees a table scan', async () => {
    const { db } = await setup();
    expect(scans(await plan(db, 'SELECT id FROM "transaction" WHERE note = ?', ['x']))).not.toHaveLength(0);
  });

  it.each([
    ['spent', SPENT_EXPENSES_SQL, ['2026-11-01', '2026-11-30']],
    ['refunds', SPENT_REFUNDS_SQL, ['2026-11-01', '2026-11-30']],
  ] as const)('the %s query uses an index on the entry date, not a table scan', async (_n, sql, params) => {
    const { db } = await setup();
    const p = await plan(db, sql, [...params]);
    expect(p).toMatch(/USING (COVERING )?INDEX/);
    expect(scans(p)).toHaveLength(0);
  });

  it('the review-queue query finds waiting entries by status, not a table scan', async () => {
    const { db } = await setup();
    const p = await plan(db, TO_CHECK_SQL, []);
    expect(p).toMatch(/USING (COVERING )?INDEX transaction_status/);
  });

  it('10,000 records: homeSummary stays well inside the 2 s budget (Node timing, logged for the record)', async () => {
    const { db, writer, spend, bank } = await setup();
    await writer.run(SaveBudget, overall(900_000_000), 'user');
    await spend('cat_food', 1_000, ist(11, 3));
    db.raw.exec('BEGIN');
    const tx = db.raw.prepare(
      `INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES (?, 'expense', 'confirmed', ?, ?, ?, 'Asia/Kolkata', ?, ?)`,
    );
    const post = db.raw.prepare(`INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'out', ?, 'normal')`);
    const split = db.raw.prepare(`INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, 'cat_food', ?)`);
    for (let i = 0; i < 10_000; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      tx.run(`bulk-${i}`, 1_000 + i, NOW - i * 1000, `2026-${i % 2 === 0 ? '11' : '10'}-${day}`, NOW, NOW);
      post.run(`bp-${i}`, `bulk-${i}`, bank, -(1_000 + i));
      split.run(`bs-${i}`, `bulk-${i}`, 1_000 + i);
    }
    db.raw.exec('COMMIT');
    await homeSummary(db, NOW); // warm
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await homeSummary(db, NOW);
      times.push(performance.now() - t0);
    }
    const worst = Math.max(...times);
    // eslint-disable-next-line no-console
    console.info(`homeSummary over 10,000 records: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
    expect(worst).toBeLessThan(2000);
  });
});
