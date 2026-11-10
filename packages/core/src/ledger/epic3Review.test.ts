import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAttachment, ATTACHMENTS_SQL, mapAttachments } from '../capture/attachments';
import { MergeDuplicate, UndoDuplicateResolution } from '../capture/resolveDuplicate';
import { ApproveCapture } from '../capture/reviewQueue';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { SetStartingBalance } from './accountBalanceCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { BulkRecategorise, UndoBulkRecategorise } from './bulk';
import { DeleteEntry, EditTransaction, RejectEntry } from './editCommands';
import { entryShape } from './entryCommands';
import { PurgeEntry } from './purge';
import { RestoreRejected } from './recentlyDeleted';
import { ReverseTransaction } from './refunds';
import { searchIndexer } from './activitySearch';
import { SetSplits } from './splits';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup(opening: number | null = 1_000_000) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 9, 1, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(71)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape], indexer: searchIndexer,
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: opening }, 'user');
  if (!a.ok) throw new Error('add');
  clock.advance(NOW - Date.UTC(2026, 9, 1, 10, 0, 1));
  const accountId = a.value.accountId;
  const entry = async (amountMinor = 50_000, merchant = 'Shop') => {
    const e = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: 'cat_food', accountId, merchant, occurredAtMs: NOW });
    if (!e.ok) throw new Error('entry');
    return e.value;
  };
  const balance = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((x) => x.id === accountId)!.postingsMinor;
  return { db, clock, writer, accountId, entry, balance };
}

describe('Epic 3 review fixes', () => {
  it('a reversed purchase cannot be deleted, rejected, edited or split, and cannot be reversed while a refund is linked to it', async () => {
    const { writer, entry, balance } = await setup();
    const start = await balance();
    const e = await entry(50_000);
    const rev = await writer.run(ReverseTransaction, { transactionId: e.transactionId }, 'user');
    expect(rev).toMatchObject({ ok: true });
    expect(await balance()).toBe(start);
    expect(await writer.run(DeleteEntry, { transactionId: e.transactionId }, 'user')).toEqual({ ok: false, code: 'NOT_REMOVABLE' });
    expect(await writer.run(RejectEntry, { transactionId: e.transactionId }, 'user')).toEqual({ ok: false, code: 'NOT_REMOVABLE' });
    expect(await writer.run(EditTransaction, { transactionId: e.transactionId, entry: { amountMinor: 70_000 } }, 'user')).toEqual({ ok: false, code: 'NOT_EDITABLE' });
    expect(await writer.run(SetSplits, { transactionId: e.transactionId, splits: [{ categoryId: 'cat_food', amountMinor: 50_000 }] }, 'user')).toEqual({ ok: false, code: 'NOT_SPLITTABLE' });
    expect(await balance()).toBe(start);

    const other = await entry(30_000, 'Other');
    await writer.run(SubmitCapture, { submissionId: 'rf', sourceKind: 'manual', refund: { originalId: other.transactionId, amountMinor: 10_000 } }, 'user');
    expect(await writer.run(ReverseTransaction, { transactionId: other.transactionId }, 'user')).toEqual({ ok: false, code: 'HAS_REFUNDS' });
  });

  it('a purchase cannot be edited or re-split below what was refunded', async () => {
    const { writer, entry } = await setup();
    const e = await entry(100_000);
    await writer.run(SubmitCapture, { submissionId: 'rf', sourceKind: 'manual', refund: { originalId: e.transactionId, amountMinor: 100_000 } }, 'user');
    expect(await writer.run(EditTransaction, { transactionId: e.transactionId, entry: { amountMinor: 60_000 } }, 'user')).toEqual({ ok: false, code: 'BELOW_REFUNDS' });
    expect(await writer.run(SetSplits, { transactionId: e.transactionId, amountMinor: 60_000, splits: [{ categoryId: 'cat_food', amountMinor: 60_000 }] }, 'user')).toEqual({ ok: false, code: 'BELOW_REFUNDS' });
    expect(await writer.run(EditTransaction, { transactionId: e.transactionId, entry: { amountMinor: 120_000 } }, 'user')).toMatchObject({ ok: true });
  });

  it('Set starting balance counts a reversed purchase and its reversal', async () => {
    const { writer, accountId, entry, balance } = await setup(null);
    const e = await entry(50_000);
    await writer.run(ReverseTransaction, { transactionId: e.transactionId }, 'user');
    const r = await writer.run(SetStartingBalance, { accountId, amountMinor: 1_000_000 }, 'user');
    expect(r).toMatchObject({ ok: true });
    expect(await balance()).toBe(1_000_000);
  });

  it('a held duplicate whose match was purged can be approved; one whose match was deleted cannot be merged', async () => {
    const { writer, entry } = await setup();
    const a = await entry(45_000, 'Swiggy');
    const b = await entry(45_000, 'Swiggy');
    expect(b.result).toBe('POSSIBLE_DUPLICATE');
    await writer.run(DeleteEntry, { transactionId: a.transactionId }, 'user');
    expect(await writer.run(MergeDuplicate, { transactionId: b.transactionId }, 'user')).toEqual({ ok: false, code: 'MATCH_REMOVED' });
    expect(await writer.run(ApproveCapture, { transactionId: b.transactionId }, 'user')).toMatchObject({ ok: true });

    const c = await entry(46_000, 'Tea');
    const d = await entry(46_000, 'Tea');
    await writer.run(DeleteEntry, { transactionId: c.transactionId }, 'user');
    expect(await writer.run(PurgeEntry, { transactionId: c.transactionId }, 'user')).toMatchObject({ ok: true });
    expect(await writer.run(ApproveCapture, { transactionId: d.transactionId }, 'user')).toMatchObject({ ok: true });
  });

  it('choosing a category by edit clears the needs-category flag; a bulk move and its Undo restore it exactly', async () => {
    const { db, writer, entry } = await setup();
    const e = await entry(900, 'Corner');
    const flag = async (id: string) => Number((await db.query('SELECT needs_category FROM "transaction" WHERE id = ?', [id]))[0]![0]);
    await db.query('UPDATE "transaction" SET needs_category = 1 WHERE id = ?', [e.transactionId]);
    await writer.run(EditTransaction, { transactionId: e.transactionId, entry: { categoryId: 'cat_transport' } }, 'user');
    expect(await flag(e.transactionId)).toBe(0);

    const f = await entry(901, 'Corner two');
    await db.query('UPDATE "transaction" SET needs_category = 1 WHERE id = ?', [f.transactionId]);
    const r = await writer.run(BulkRecategorise, { transactionIds: [f.transactionId], categoryId: 'cat_transport' }, 'user');
    if (!r.ok) throw new Error('bulk');
    expect(await flag(f.transactionId)).toBe(0);
    await writer.run(UndoBulkRecategorise, { previous: r.value.previous }, 'user');
    expect(await flag(f.transactionId)).toBe(1);
  });

  it('Undo of a merge brings back a photo the merge dropped because the survivor had the same image', async () => {
    const { db, writer, entry } = await setup();
    const o = await entry(45_000, 'Swiggy');
    const d = await entry(45_000, 'Swiggy');
    const digest = 'd'.repeat(64);
    await writer.run(AddAttachment, { transactionId: o.transactionId, attachmentId: 'att-o', digest, sizeBytes: 5 }, 'user');
    await writer.run(AddAttachment, { transactionId: d.transactionId, attachmentId: 'att-d', digest, sizeBytes: 5 }, 'user');
    await writer.run(MergeDuplicate, { transactionId: d.transactionId }, 'user');
    expect((mapAttachments(await db.query(ATTACHMENTS_SQL, [o.transactionId]))).map((x) => x.id)).toEqual(['att-o']);
    await writer.run(UndoDuplicateResolution, { transactionId: d.transactionId }, 'user');
    expect((mapAttachments(await db.query(ATTACHMENTS_SQL, [d.transactionId]))).map((x) => x.id)).toEqual(['att-d']);
  });

  it('restoring a rejected capture that still has no posting puts it back waiting, not confirmed', async () => {
    const { db, writer } = await setup();
    await db.query(`INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, tags_json, needs_category, foreign_amount_minor, foreign_currency, foreign_currency_exponent, removed_at, removal_kind, capture_resolution, created_at, updated_at) VALUES ('fx','expense','excluded',0,${NOW},'2026-11-08','Asia/Kolkata','X','[]',0,1299,'USD',2,${NOW},'rejected','rejected',${NOW},${NOW})`);
    await db.query("INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES ('s','fx','cat_food',0)");
    const r = await writer.run(RestoreRejected, { transactionId: 'fx' }, 'user');
    expect(r).toMatchObject({ ok: true });
    expect(String((await db.query("SELECT status FROM \"transaction\" WHERE id = 'fx'"))[0]![0])).toBe('needs_review');
  });
});
