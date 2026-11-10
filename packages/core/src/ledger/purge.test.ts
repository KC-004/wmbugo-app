import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAttachment } from '../capture/attachments';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { DeleteEntry, RejectEntry } from './editCommands';
import { entryShape } from './entryCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { searchIndexer } from './activitySearch';
import { duplicateFingerprint, PurgeEntry, PurgeExpired, RunDailyPurge, tombstoneHash } from './purge';

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 10, 0, 0);
const T0 = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(START, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(61)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape], indexer: searchIndexer,
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 100_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('add');
  clock.advance(T0 - START - 1000);
  const accountId = a.value.accountId;
  const entry = async (merchant = 'Swiggy', amountMinor = 45_000) => {
    const e = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: 'cat_food', accountId, merchant, occurredAtMs: clock.nowMs() });
    if (!e.ok) throw new Error('entry');
    return e.value.transactionId;
  };
  const exists = async (id: string) => (await db.query('SELECT 1 FROM "transaction" WHERE id = ?', [id])).length > 0;
  const balance = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((x) => x.id === accountId)!.postingsMinor;
  const count = async (table: string) => Number((await db.query(`SELECT COUNT(*) FROM ${table}`))[0]![0]);
  return { db, clock, writer, accountId, cashId: b.value.accountId, entry, exists, balance, count };
}

describe('PurgeExpired (Story 3.12)', () => {
  it('keeps a deleted entry at 29 days and purges it at 30; keeps a rejected one at 89 days and purges it at 90', async () => {
    const { db, clock, writer, entry, exists } = await setup();
    const deleted = await entry('Chai');
    await writer.run(DeleteEntry, { transactionId: deleted }, 'user');
    const rejected = await entry('Spam');
    await db.query("INSERT INTO source_record (id, transaction_id, source_kind, fingerprint, created_at) VALUES ('sr-x', ?, 'sms', 'fp-x', 0)", [rejected]);
    await writer.run(RejectEntry, { transactionId: rejected }, 'user');

    clock.advance(29 * DAY);
    expect(await writer.run(PurgeExpired, {}, 'system')).toMatchObject({ ok: true, value: { purgedIds: [] } });
    expect(await exists(deleted)).toBe(true);
    clock.advance(DAY);
    const r = await writer.run(PurgeExpired, {}, 'system');
    expect(r).toMatchObject({ ok: true, value: { purgedIds: [deleted] } });
    expect(await exists(deleted)).toBe(false);
    expect(await exists(rejected)).toBe(true);

    clock.advance(59 * DAY);
    await writer.run(PurgeExpired, {}, 'system');
    expect(await exists(rejected)).toBe(true);
    clock.advance(DAY);
    await writer.run(PurgeExpired, {}, 'system');
    expect(await exists(rejected)).toBe(false);
  });

  it('removes postings, splits, sources, candidates and attachments with the entry, returns the files to delete, and leaves a tombstone with no personal data', async () => {
    const { db, clock, writer, entry, count } = await setup();
    const id = await entry('Swiggy');
    await writer.run(AddAttachment, { transactionId: id, attachmentId: 'att-1', digest: 'c'.repeat(64), sizeBytes: 10 }, 'user');
    await writer.run(DeleteEntry, { transactionId: id }, 'user');
    clock.advance(31 * DAY);
    const r = await writer.run(PurgeExpired, {}, 'system');
    expect(r).toMatchObject({ ok: true, value: { fileNames: ['att-1.enc'] } });
    for (const t of ['attachment', 'source_record', 'review_candidate']) expect(await count(t)).toBe(0);
    expect(Number((await db.query('SELECT COUNT(*) FROM split'))[0]![0])).toBe(0);
    expect(Number((await db.query("SELECT COUNT(*) FROM posting WHERE posting_kind = 'normal'"))[0]![0])).toBe(0);
    const t = await db.query('SELECT * FROM tombstone');
    expect(t).toHaveLength(1);
    const dump = JSON.stringify(t);
    expect(dump).toMatch(/deleted/);
    expect(dump).not.toMatch(/Swiggy|45000|450/);
    expect(String(t[0]![1])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the salt is generated once per install and stored in settings; the hash depends on it', async () => {
    const { db, clock, writer, entry } = await setup();
    await writer.run(DeleteEntry, { transactionId: await entry('A') }, 'user');
    await writer.run(DeleteEntry, { transactionId: await entry('B', 99_900) }, 'user');
    clock.advance(31 * DAY);
    await writer.run(PurgeExpired, {}, 'system');
    const salts = await db.query("SELECT value_json FROM settings WHERE key = 'tombstone_salt'");
    expect(salts).toHaveLength(1);
    const salt = JSON.parse(String(salts[0]![0])) as string;
    expect(tombstoneHash(salt, 'x')).not.toBe(tombstoneHash('other', 'x'));
  });

  it('the fingerprint is (reference, direction, type) with a reference, else (direction, amount, date, normalized merchant)', () => {
    const base = { direction: 'debit' as const, eventType: 'expense', amountMinor: 45_000, localDate: '2026-11-08' };
    expect(duplicateFingerprint({ ...base, reference: 'UTR123', merchant: 'A' })).toBe(duplicateFingerprint({ ...base, reference: 'utr123', amountMinor: 1, merchant: 'B' }));
    expect(duplicateFingerprint({ ...base, merchant: 'Swiggy' })).toBe(duplicateFingerprint({ ...base, merchant: 'SWIGGY ' }));
    expect(duplicateFingerprint({ ...base, merchant: 'Swiggy' })).not.toBe(duplicateFingerprint({ ...base, amountMinor: 45_001, merchant: 'Swiggy' }));
  });

  it('a purged purchase with a linked refund leaves the refund unlinked in its category; balances stay consistent', async () => {
    const { db, clock, writer, accountId, entry, balance } = await setup();
    const id = await entry('Shop', 100_000);
    const rf = await writer.run(SubmitCapture, { submissionId: 'rf-1', sourceKind: 'manual', refund: { originalId: id, amountMinor: 40_000 } }, 'user');
    if (!rf.ok) throw new Error('refund');
    // Deleting the purchase would normally be allowed only if nothing depends on it; the purge handles the link.
    await db.query('UPDATE "transaction" SET removed_at = ?, removal_kind = ?, status = ? WHERE id = ?', [clock.nowMs(), 'deleted', 'excluded', id]);
    const before = await balance();
    clock.advance(31 * DAY);
    await writer.run(PurgeExpired, {}, 'system');
    expect(String((await db.query('SELECT refund_of_transaction_id FROM "transaction" WHERE id = ?', [rf.value.transactionId]))[0]![0] ?? '')).toBe('');
    expect(String((await db.query('SELECT category_id FROM split WHERE transaction_id = ?', [rf.value.transactionId]))[0]![0])).toBe('cat_food');
    expect(await balance()).toBe(before);
    void accountId;
  });

  it('a transfer purges as one transaction with both legs', async () => {
    const { db, clock, writer, accountId, cashId } = await setup();
    const tr = await recordTransfer(writer, { fromAccountId: accountId, toAccountId: cashId, amountMinor: 5_000 });
    if (!tr.ok) throw new Error('tr');
    await db.query('UPDATE "transaction" SET removed_at = ?, removal_kind = ?, status = ? WHERE id = ?', [clock.nowMs(), 'deleted', 'excluded', tr.value.transactionId]);
    const r = await writer.run(PurgeEntry, { transactionId: tr.value.transactionId }, 'user');
    expect(r).toMatchObject({ ok: true, value: { purgedIds: [tr.value.transactionId] } });
    expect(Number((await db.query('SELECT COUNT(*) FROM posting WHERE transaction_id = ?', [tr.value.transactionId]))[0]![0])).toBe(0);
  });

  it('PurgeEntry removes just one removed entry now, and refuses a live one', async () => {
    const { writer, entry, exists } = await setup();
    const keep = await entry('Keep');
    const gone = await entry('Gone', 123);
    await writer.run(DeleteEntry, { transactionId: gone }, 'user');
    expect(await writer.run(PurgeEntry, { transactionId: keep }, 'user')).toEqual({ ok: false, code: 'NOT_REMOVED' });
    expect(await writer.run(PurgeEntry, { transactionId: 'ghost' }, 'user')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
    expect(await writer.run(PurgeEntry, { transactionId: gone }, 'user')).toMatchObject({ ok: true });
    expect(await exists(gone)).toBe(false);
    expect(await exists(keep)).toBe(true);
  });

  it('RunDailyPurge runs at most once per local day', async () => {
    const { clock, writer, entry } = await setup();
    const id = await entry('Old');
    await writer.run(DeleteEntry, { transactionId: id }, 'user');
    clock.advance(31 * DAY);
    expect(await writer.run(RunDailyPurge, {}, 'system')).toMatchObject({ ok: true, value: { ran: true, purgedIds: [id] } });
    expect(await writer.run(RunDailyPurge, {}, 'system')).toMatchObject({ ok: true, value: { ran: false } });
    clock.advance(DAY);
    expect(await writer.run(RunDailyPurge, {}, 'system')).toMatchObject({ ok: true, value: { ran: true } });
  });
});

describe('tombstones suppress non-manual submissions (Story 3.12)', () => {
  const sms = (extra: Record<string, unknown> = {}) => ({ sourceKind: 'sms' as const, ...extra });

  it('a rejected then purged payment is skipped when it comes in again by SMS; Import anyway writes it; a manual entry is never skipped', async () => {
    const { db, clock, writer, accountId, entry } = await setup();
    const at = clock.nowMs();
    const first = await writer.run(SubmitCapture, { submissionId: 's1', ...sms(), entry: { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, merchant: 'Swiggy', occurredAtMs: at } }, 'auto');
    if (!first.ok) throw new Error('first');
    await writer.run(RejectEntry, { transactionId: first.value.transactionId }, 'user');
    clock.advance(91 * DAY);
    await writer.run(PurgeExpired, {}, 'system');

    const before = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    const again = await writer.run(SubmitCapture, { submissionId: 's2', ...sms(), entry: { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, merchant: 'swiggy', occurredAtMs: at } }, 'auto');
    expect(again).toMatchObject({ ok: true, value: { result: 'SKIPPED_PREVIOUSLY_REJECTED' } });
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(before);

    const forced = await writer.run(SubmitCapture, { submissionId: 's3', ...sms({ ignoreTombstone: true }), entry: { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, merchant: 'Swiggy', occurredAtMs: at } }, 'auto');
    expect(forced).toMatchObject({ ok: true, value: { result: 'RECORDED' } });

    // A manual entry with the same fields is never suppressed.
    const manual = await entry('Swiggy');
    expect(manual).toBeTruthy();
  });

  it('a deleted (manual) then purged payment is skipped as SKIPPED_PREVIOUSLY_DELETED when the same payment arrives by SMS', async () => {
    const { clock, writer, accountId } = await setup();
    const at = clock.nowMs();
    const mine = await recordEntry(writer, { kind: 'expense', amountMinor: 70_000, categoryId: 'cat_food', accountId, merchant: 'Amazon', occurredAtMs: at });
    if (!mine.ok) throw new Error('mine');
    expect(await writer.run(DeleteEntry, { transactionId: mine.value.transactionId }, 'user')).toMatchObject({ ok: true });
    clock.advance(31 * DAY);
    await writer.run(PurgeExpired, {}, 'system');
    const again = await writer.run(SubmitCapture, { submissionId: 'd2', sourceKind: 'sms', entry: { kind: 'expense', amountMinor: 70_000, categoryId: 'cat_food', accountId, merchant: 'AMAZON', occurredAtMs: at } }, 'auto');
    expect(again).toMatchObject({ ok: true, value: { result: 'SKIPPED_PREVIOUSLY_DELETED', transactionId: '' } });
  });
});
