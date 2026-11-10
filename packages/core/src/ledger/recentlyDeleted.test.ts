import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { RestoreTransaction, DeleteEntry, RejectEntry } from './editCommands';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { entryShape } from './entryCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { SPENT_EXPENSES_SQL } from './readModels';
import { activityQuery, searchIndexer } from './activitySearch';
import { PurgeEntry } from './purge';
import { daysLeft, mapDeletedRows, mapPurgeFacts, PURGE_FACTS_SQL, RECENTLY_DELETED_SQL, recentlyDeletedSince, RestoreDeleted, RestoreRejected } from './recentlyDeleted';

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 10, 0, 0);
const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(START, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(67)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape], indexer: searchIndexer,
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 1_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 5_000_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('add');
  clock.advance(NOW - START - 1000);
  const cashId = a.value.accountId;
  const balance = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((x) => x.id === cashId)!.postingsMinor;
  const cashEntry = async (amountMinor: number, occurredAtMs: number, merchant = 'Landlord') => {
    const e = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: 'cat_food', accountId: cashId, merchant, occurredAtMs });
    if (!e.ok) throw new Error('entry');
    return e.value.transactionId;
  };
  const listed = async () => mapDeletedRows(await db.query(RECENTLY_DELETED_SQL, [recentlyDeletedSince(clock.nowMs())]), clock.nowMs());
  return { db, clock, writer, cashId, bankId: b.value.accountId, balance, cashEntry, listed };
}

describe('Recently deleted and Restore (Story 3.13)', () => {
  it('daysLeft counts a started day: deleted 7 days ago reads 23 days left', () => {
    expect(daysLeft(NOW - 7 * DAY, NOW)).toBe(23);
    expect(daysLeft(NOW, NOW)).toBe(30);
    expect(daysLeft(NOW - 30 * DAY, NOW)).toBe(0);
  });

  it('lists manual entries deleted in the last 30 days, most recent first, with merchant, amount, original date and days left', async () => {
    const { clock, writer, cashEntry, listed } = await setup();
    const old = await cashEntry(1_000, NOW - 40 * DAY, 'Ancient');
    await writer.run(DeleteEntry, { transactionId: old }, 'user');
    clock.advance(DAY);
    const first = await cashEntry(320_000, Date.UTC(2026, 9, 30, 10, 0, 0), 'Rent');
    await writer.run(DeleteEntry, { transactionId: first }, 'user');
    clock.advance(DAY);
    const second = await cashEntry(5_000, clock.nowMs(), 'Tea');
    await writer.run(DeleteEntry, { transactionId: second }, 'user');
    const rows = await listed();
    expect(rows.map((r) => r.id)).toEqual([second, first, old]);
    expect(rows[1]).toMatchObject({ merchant: 'Rent', amountMinor: 320_000, localDate: '2026-10-30', daysLeft: 29 });
    clock.advance(30 * DAY);
    expect((await listed()).map((r) => r.id)).toEqual([]);
  });

  it('Restore brings back a ₹3,200 cash entry dated 30 Oct with its date; the Cash balance and Spent update; Undo deletes it again', async () => {
    const { db, clock, writer, balance, cashEntry, listed } = await setup();
    const start = await balance();
    const id = await cashEntry(320_000, Date.UTC(2026, 9, 30, 10, 0, 0), 'Rent');
    await writer.run(DeleteEntry, { transactionId: id }, 'user');
    clock.advance(DAY);
    expect(await balance()).toBe(start);
    const r = await writer.run(RestoreDeleted, { transactionId: id }, 'user');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await balance()).toBe(start - 320_000);
    expect(String((await db.query('SELECT local_date FROM "transaction" WHERE id = ?', [id]))[0]![0])).toBe('2026-10-30');
    expect(Number((await db.query(SPENT_EXPENSES_SQL, ['2026-10-01', '2026-10-31']))[0]![0])).toBe(320_000);
    expect(await listed()).toEqual([]);
    expect(await writer.run(RestoreDeleted, { transactionId: id }, 'user')).toEqual({ ok: false, code: 'NOT_DELETED' });

    const u = await writer.run(RestoreTransaction, { snapshot: r.value.snapshot }, 'user');
    expect(u).toMatchObject({ ok: true });
    expect(await balance()).toBe(start);
    expect((await listed()).map((x) => x.id)).toEqual([id]);
  });

  it('refuses to restore past the keeping period, and an unknown id', async () => {
    const { db, clock, writer, cashEntry } = await setup();
    const id = await cashEntry(100, NOW);
    await writer.run(DeleteEntry, { transactionId: id }, 'user');
    clock.advance(31 * DAY);
    expect(await writer.run(RestoreDeleted, { transactionId: id }, 'user')).toEqual({ ok: false, code: 'PAST_RETENTION' });
    expect(await writer.run(RestoreDeleted, { transactionId: 'ghost' }, 'user')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
    void db;
  });

  it('a rejected capture shows under Show rejected for 90 days (deleted entries never do); Restore confirms it as user_approved with an exact Undo', async () => {
    const { db, clock, writer, cashId, cashEntry, balance } = await setup();
    const sms = await writer.run(SubmitCapture, { submissionId: 'sms-1', sourceKind: 'sms', entry: { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId: cashId, merchant: 'Swiggy', occurredAtMs: clock.nowMs() } }, 'auto');
    if (!sms.ok) throw new Error('sms');
    const gone = await cashEntry(700, clock.nowMs(), 'Deleted one');
    await writer.run(DeleteEntry, { transactionId: gone }, 'user');
    const start = await balance();
    await writer.run(RejectEntry, { transactionId: sms.value.transactionId }, 'user');
    const afterReject = await balance();
    expect(afterReject).toBe(start + 45_000);

    const q = activityQuery({ showRejected: true }, 50, { exponent: 2, nowMs: clock.nowMs() });
    const ids = (await db.query(q.sql, q.params)).map((r) => String(r[0]));
    expect(ids).toContain(sms.value.transactionId);
    expect(ids).not.toContain(gone);

    expect(await writer.run(RestoreDeleted, { transactionId: sms.value.transactionId }, 'user')).toEqual({ ok: false, code: 'NOT_DELETED' });
    const r = await writer.run(RestoreRejected, { transactionId: sms.value.transactionId }, 'user');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const t = (await db.query('SELECT status, capture_resolution, removed_at FROM "transaction" WHERE id = ?', [sms.value.transactionId]))[0]!;
    expect([String(t[0]), String(t[1]), t[2]]).toEqual(['confirmed', 'user_approved', null]);
    expect(await balance()).toBe(afterReject - 45_000);
    await writer.run(RestoreTransaction, { snapshot: r.value.snapshot }, 'user');
    expect(await balance()).toBe(afterReject);
  });

  it('Delete permanently purges just that entry and leaves a tombstone; the confirm sheet facts say transfer and refund', async () => {
    const { db, writer, cashId, bankId, cashEntry } = await setup();
    const tr = await recordTransfer(writer, { fromAccountId: cashId, toAccountId: bankId, amountMinor: 10_000 });
    if (!tr.ok) throw new Error('tr');
    const bought = await cashEntry(50_000, NOW, 'Shop');
    const rf = await writer.run(SubmitCapture, { submissionId: 'rf', sourceKind: 'manual', refund: { originalId: bought, amountMinor: 10_000 } }, 'user');
    expect(rf).toMatchObject({ ok: true });
    expect(mapPurgeFacts(await db.query(PURGE_FACTS_SQL, [tr.value.transactionId]))).toEqual({ isTransfer: true, hasRefund: false });
    expect(mapPurgeFacts(await db.query(PURGE_FACTS_SQL, [bought]))).toEqual({ isTransfer: false, hasRefund: true });
    await writer.run(DeleteEntry, { transactionId: bought }, 'user');
    expect(await writer.run(PurgeEntry, { transactionId: bought }, 'user')).toMatchObject({ ok: true });
    expect(Number((await db.query('SELECT COUNT(*) FROM tombstone'))[0]![0])).toBe(1);
    expect(String((await db.query('SELECT refund_of_transaction_id FROM "transaction" WHERE id = ?', [(rf as { value: { transactionId: string } }).value.transactionId]))[0]![0] ?? '')).toBe('');
  });
});
