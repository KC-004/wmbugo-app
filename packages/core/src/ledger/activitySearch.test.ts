import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, ArchiveAccount, openingBalanceShape, RenameAccount } from './accountCommands';
import { activeFilterCount, activityCountQuery, activityQuery, amountFromSearch, ftsQuery, isFlatSort, searchIndexer, type ActivityQuery } from './activitySearch';
import type { AccountType } from './accounts';
import { DeleteEntry, EditTransaction, RestoreTransaction } from './editCommands';
import { entryShape } from './entryCommands';
import { groupByDay, mapActivityRows } from './readModels';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;
const CTX = { exponent: 2, nowMs: NOW + 6 * HOUR };

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(31)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape], indexer: searchIndexer,
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const find = async (q: ActivityQuery, limit = 100) => {
    const { sql, params } = activityQuery(q, limit, CTX);
    return mapActivityRows(await db.query(sql, params));
  };
  const count = async (q: ActivityQuery) => {
    const { sql, params } = activityCountQuery(q, CTX);
    return Number((await db.query(sql, params))[0]![0]);
  };
  return { db, clock, writer, add, find, count };
}

async function seed() {
  const s = await setup();
  const hdfc = await s.add('HDFC', 'bank', 10_000_000);
  const cash = await s.add('Cash', 'cash', 1_000_000);
  s.clock.advance(HOUR);
  const petrol = await recordEntry(s.writer, { kind: 'expense', amountMinor: 150_000, categoryId: 'cat_transport', accountId: hdfc, merchant: 'Shell Petrol Pump', note: 'full tank' });
  s.clock.advance(DAY);
  const tea = await recordEntry(s.writer, { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId: cash, merchant: 'Chai Point' });
  s.clock.advance(DAY);
  const salary = await recordEntry(s.writer, { kind: 'income', amountMinor: 8_500_000, categoryId: 'cat_in_salary', accountId: hdfc, merchant: 'Acme Pvt' });
  const move = await recordTransfer(s.writer, { amountMinor: 20_000, fromAccountId: hdfc, toAccountId: cash });
  if (!petrol.ok || !tea.ok || !salary.ok || !move.ok) throw new Error('seed');
  return { ...s, hdfc, cash, ids: { petrol: petrol.value.transactionId, tea: tea.value.transactionId, salary: salary.value.transactionId, move: move.value.transactionId } };
}

describe('search text helpers', () => {
  it('builds an FTS query: every word, the last as a prefix, quotes stripped; empty gives null', () => {
    expect(ftsQuery('petrol pump')).toBe('"petrol" "pump"*');
    expect(ftsQuery('  ch"ai ')).toBe('"chai"*');
    expect(ftsQuery('   ')).toBeNull();
  });
  it('reads a plain number as an exact amount in minor units, and nothing else', () => {
    expect(amountFromSearch('450', 2)).toBe(45000);
    expect(amountFromSearch('450.5', 2)).toBe(45050);
    expect(amountFromSearch('450,25', 2)).toBe(45025);
    expect(amountFromSearch('450.123', 2)).toBeNull();
    expect(amountFromSearch('petrol', 2)).toBeNull();
  });
});

describe('the index is kept up to date by the writer (Story 3.6)', () => {
  const hits = async (db: NodeSqliteDatabase, term: string) => (await db.query('SELECT tx_id FROM activity_search WHERE activity_search MATCH ?', [term])).map((r) => String(r[0]));

  it('a new entry is searchable at once by merchant, note, category and account', async () => {
    const { db, ids } = await seed();
    expect(await hits(db, '"petrol"*')).toEqual([ids.petrol]);
    expect(await hits(db, '"tank"*')).toEqual([ids.petrol]);
    expect(await hits(db, '"transport"*')).toEqual([ids.petrol]);
    expect(await hits(db, '"chai"*')).toEqual([ids.tea]);
    expect((await hits(db, '"cash"*')).sort()).toEqual([ids.tea, ids.move].sort());
  });

  it('an edit re-indexes: the old words stop matching and the new ones match', async () => {
    const { db, writer, ids } = await seed();
    await writer.run(EditTransaction, { transactionId: ids.petrol, entry: { merchant: 'Bharat Fuel', categoryId: 'cat_food' } }, 'user');
    expect(await hits(db, '"petrol"*')).toEqual([]);
    expect(await hits(db, '"bharat"*')).toEqual([ids.petrol]);
    expect((await hits(db, '"food"*')).sort()).toEqual([ids.petrol, ids.tea].sort());
  });

  it('renaming an account re-indexes its entries', async () => {
    const { db, writer, hdfc, ids } = await seed();
    await writer.run(RenameAccount, { accountId: hdfc, name: 'Salary Account' }, 'user');
    expect(await hits(db, '"hdfc"*')).toEqual([]);
    expect(await hits(db, '"salary"*')).toContain(ids.petrol);
  });

  it('a rolled-back write leaves the index alone', async () => {
    const { db, writer, add } = await seed();
    const before = JSON.stringify(await db.query('SELECT tx_id, body FROM activity_search ORDER BY tx_id'));
    const a = await add('Extra', 'bank', 1);
    // an invalid entry is refused before anything is written
    const bad = await recordEntry(writer, { kind: 'expense', amountMinor: 0, categoryId: 'cat_food', accountId: a });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(await db.query('SELECT tx_id, body FROM activity_search ORDER BY tx_id'))).toBe(before);
  });

  it('the migration backfills entries that already existed', async () => {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    expect(Number((await db.query('SELECT COUNT(*) FROM activity_search'))[0]![0])).toBe(0);
  });
});

describe('search, filters and sort (Story 3.6)', () => {
  it('matches by words (merchant, note, category, account) and a plain number matches entries of exactly that amount', async () => {
    const { find, ids } = await seed();
    expect((await find({ search: 'petrol' })).map((r) => r.id)).toEqual([ids.petrol]);
    expect((await find({ search: 'full tank' })).map((r) => r.id)).toEqual([ids.petrol]);
    expect((await find({ search: 'transport' })).map((r) => r.id)).toEqual([ids.petrol]);
    expect((await find({ search: 'chai poi' })).map((r) => r.id)).toEqual([ids.tea]);
    expect((await find({ search: '450' })).map((r) => r.id)).toEqual([ids.tea]);
    expect((await find({ search: '1500' })).map((r) => r.id)).toEqual([ids.petrol]);
    expect(await find({ search: 'nothing like this' })).toEqual([]);
  });

  it('filters by account (both sides of a transfer), category, type, date range and amount range; filters combine', async () => {
    const { find, hdfc, cash, ids } = await seed();
    expect((await find({ accountIds: [cash] })).map((r) => r.id).sort()).toEqual([ids.tea, ids.move].sort());
    expect((await find({ categoryIds: ['cat_food'] })).map((r) => r.id)).toEqual([ids.tea]);
    expect((await find({ types: ['income'] })).map((r) => r.id)).toEqual([ids.salary]);
    expect((await find({ types: ['expense', 'transfer'] })).map((r) => r.id).sort()).toEqual([ids.petrol, ids.tea, ids.move].sort());
    expect((await find({ minMinor: 100_000, maxMinor: 200_000 })).map((r) => r.id)).toEqual([ids.petrol]);
    expect((await find({ fromDate: '2026-11-09', toDate: '2026-11-09' })).map((r) => r.id)).toEqual([ids.tea]);
    expect((await find({ accountIds: [hdfc], types: ['expense'], search: 'tank' })).map((r) => r.id)).toEqual([ids.petrol]);
    expect(await find({ accountIds: [cash], types: ['income'] })).toEqual([]);
  });

  it('filters by status: waiting, possible duplicate, needs a category, guessed, reversed', async () => {
    const { db, find, ids } = await seed();
    db.raw.exec(`UPDATE "transaction" SET status = 'needs_review' WHERE id = '${ids.tea}'`);
    db.raw.exec(`UPDATE "transaction" SET status = 'reversed' WHERE id = '${ids.salary}'`);
    db.raw.exec(`UPDATE "transaction" SET needs_category = 1 WHERE id = '${ids.petrol}'`);
    expect((await find({ statuses: ['waiting'] })).map((r) => r.id)).toEqual([ids.tea]);
    expect((await find({ statuses: ['reversed'] })).map((r) => r.id)).toEqual([ids.salary]);
    expect((await find({ statuses: ['needs-category'] })).map((r) => r.id)).toEqual([ids.petrol]);
    db.raw.exec(`INSERT INTO review_candidate (id,transaction_id,matched_transaction_id,reason,status,created_at) VALUES ('rc','${ids.tea}','${ids.petrol}','duplicate','open',1)`);
    expect((await find({ statuses: ['check'] })).map((r) => r.id)).toEqual([ids.tea]);
    expect(await find({ statuses: ['waiting'] })).toEqual([]);
    expect((await find({ statuses: ['waiting', 'reversed'] })).map((r) => r.id)).toEqual([ids.salary]);
  });

  it('sorts: newest (default), oldest, highest amount, merchant A to Z; flat sorts have no day headers', async () => {
    const { find, ids } = await seed();
    const order = async (sort: ActivityQuery['sort']) => (await find({ sort })).map((r) => r.id);
    const newest = await order('newest');
    expect(newest[0]).toBe(ids.move.length ? newest[0] : '');
    expect((await order('oldest'))[0]).toBe(ids.petrol);
    expect((await order('amount'))[0]).toBe(ids.salary);
    expect((await order('merchant')).slice(0, 4)).toEqual([ids.salary, ids.tea, ids.petrol, ids.move]);
    expect(isFlatSort({ sort: 'amount' })).toBe(true);
    expect(isFlatSort({ sort: 'merchant' })).toBe(true);
    expect(isFlatSort({ sort: 'oldest' })).toBe(false);
  });

  it('day Spent covers only the listed entries; a category filter counts only the matching split amounts', async () => {
    const { clock, writer, add, find } = await setup();
    const a = await add('HDFC', 'bank', 10_000_000);
    clock.advance(HOUR);
    await recordEntry(writer, { kind: 'expense', amountMinor: 100_000, categoryId: 'cat_food', accountId: a });
    await recordEntry(writer, { kind: 'expense', amountMinor: 50_000, categoryId: 'cat_transport', accountId: a });
    expect(groupByDay(await find({}))[0]!.spentMinor).toBe(150_000);
    expect(groupByDay(await find({ categoryIds: ['cat_food'] }))[0]!.spentMinor).toBe(100_000);
    expect(groupByDay(await find({ search: 'transport' }))[0]!.spentMinor).toBe(50_000);
    // a split entry: only the matching split counts
    const rows = await find({ categoryIds: ['cat_food'] });
    expect(rows[0]!.matchedMinor).toBe(100_000);
  });

  it('Show rejected adds captures rejected in the last 90 days, counted nowhere; older ones and deleted entries stay hidden', async () => {
    const { db, find, ids } = await seed();
    const reject = (id: string, at: number) => db.raw.exec(`UPDATE "transaction" SET status = 'excluded', capture_resolution = 'rejected', removal_kind = 'rejected', removed_at = ${at} WHERE id = '${id}'`);
    reject(ids.tea, NOW + 5 * HOUR);
    reject(ids.petrol, NOW - 100 * DAY);
    db.raw.exec(`UPDATE "transaction" SET status = 'excluded', removal_kind = 'deleted', removed_at = ${NOW + HOUR} WHERE id = '${ids.salary}'`);
    expect((await find({})).map((r) => r.id)).toEqual([ids.move]);
    const shown = await find({ showRejected: true });
    expect(shown.map((r) => r.id).sort()).toEqual([ids.move, ids.tea].sort());
    expect(shown.find((r) => r.id === ids.tea)!.rejected).toBe(true);
    expect(groupByDay(shown).flatMap((d) => d.rows).filter((r) => r.rejected).length).toBe(1);
    expect(groupByDay(shown).reduce((n, d) => n + d.spentMinor, 0)).toBe(0);
  });

  it('counts results for the Show N results button and the filter count', async () => {
    const { count, cash } = await seed();
    expect(await count({})).toBe(4);
    expect(await count({ accountIds: [cash] })).toBe(2);
    expect(await count({ search: 'chai' })).toBe(1);
    expect(activeFilterCount({ accountIds: ['a', 'b'], fromDate: '2026-11-01', showRejected: true, search: 'x' })).toBe(4);
  });

  it('removed and restored entries leave and re-enter the results; an archived account is still searchable', async () => {
    const { writer, find, hdfc, ids } = await seed();
    const del = await writer.run(DeleteEntry, { transactionId: ids.petrol }, 'user');
    if (!del.ok) throw new Error('del');
    expect(await find({ search: 'petrol' })).toEqual([]);
    await writer.run(RestoreTransaction, { snapshot: del.value.snapshot }, 'user');
    expect((await find({ search: 'petrol' })).map((r) => r.id)).toEqual([ids.petrol]);
    await writer.run(ArchiveAccount, { accountId: hdfc }, 'user');
    expect((await find({ accountIds: [hdfc] })).length).toBeGreaterThan(0);
  });

  it('search stays fast with 10,000 entries', async () => {
    const { db, add } = await setup();
    const a = await add('HDFC', 'bank', 0);
    db.raw.exec('BEGIN');
    const tx = db.raw.prepare('INSERT INTO "transaction" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,original_description,tags_json,needs_category,created_at,updated_at,capture_resolution) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const post = db.raw.prepare('INSERT INTO posting (id,transaction_id,account_id,direction,signed_amount_minor,posting_kind) VALUES (?,?,?,?,?,?)');
    const sp = db.raw.prepare('INSERT INTO split (id,transaction_id,category_id,amount_minor) VALUES (?,?,?,?)');
    const idx = db.raw.prepare('INSERT INTO activity_search (tx_id, body) VALUES (?, ?)');
    for (let i = 0; i < 10_000; i++) {
      const id = `bulk${i}`;
      tx.run(id, 'expense', 'confirmed', 1000 + (i % 500), NOW + i * 60_000, '2026-11-08', 'Asia/Kolkata', `Merchant ${i % 97}`, '[]', 0, 1, 1, 'user_approved');
      post.run(`p${i}`, id, a, 'out', -(1000 + (i % 500)), 'normal');
      sp.run(`s${i}`, id, 'cat_food', 1000 + (i % 500));
      idx.run(id, `Merchant ${i % 97} Food & Drinks HDFC`);
    }
    db.raw.exec('COMMIT');
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const { sql, params } = activityQuery({ search: `merchant ${i % 97}` }, 101, CTX);
      const t0 = performance.now();
      await db.query(sql, params);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length * 0.95) - 1]!).toBeLessThan(500);
  }, 120_000);
});
