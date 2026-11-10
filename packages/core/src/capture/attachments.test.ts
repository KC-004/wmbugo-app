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
import { EditTransaction } from '../ledger/editCommands';
import { SetSplits } from '../ledger/splits';
import { AddAttachment, attachmentFileName, ATTACHMENTS_SQL, mapAttachments, mapSources, orphanFiles, RemoveAttachment, SOURCES_SQL } from './attachments';
import { MergeDuplicate, UndoDuplicateResolution } from './resolveDuplicate';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const D1 = 'a'.repeat(64);
const D2 = 'b'.repeat(64);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 9, 1, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(59)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok) throw new Error('add');
  clock.advance(NOW - Date.UTC(2026, 9, 1, 10, 0, 1));
  const accountId = a.value.accountId;
  const entry = async (merchant = 'Swiggy') => {
    const e = await recordEntry(writer, { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, merchant, occurredAtMs: NOW });
    if (!e.ok) throw new Error('entry');
    return e.value;
  };
  const attach = (transactionId: string, attachmentId: string, digest = D1) => writer.run(AddAttachment, { transactionId, attachmentId, digest, sizeBytes: 1234 }, 'user');
  const list = async (id: string) => mapAttachments(await db.query(ATTACHMENTS_SQL, [id]));
  return { db, writer, accountId, entry, attach, list };
}

describe('receipt attachments (Story 3.11)', () => {
  it('attaches a photo with its digest; the same digest on the same entry is ALREADY_ATTACHED and writes nothing', async () => {
    const { writer, entry, attach, list } = await setup();
    const e = await entry();
    expect(await attach(e.transactionId, 'att-1')).toMatchObject({ ok: true });
    expect(await attach(e.transactionId, 'att-2')).toEqual({ ok: false, code: 'ALREADY_ATTACHED' });
    expect(await attach(e.transactionId, 'att-3', D2)).toMatchObject({ ok: true });
    expect((await list(e.transactionId)).map((a) => [a.id, a.digest])).toEqual([['att-1', D1], ['att-3', D2]]);
    expect(await writer.run(AddAttachment, { transactionId: e.transactionId, attachmentId: 'x', digest: 'nope', sizeBytes: 1 }, 'user')).toEqual({ ok: false, code: 'DIGEST_INVALID' });
    expect(await attach('ghost', 'att-9')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });

  it('Remove photo deletes only the row and tells the caller which file to delete; the entry is otherwise unchanged', async () => {
    const { db, writer, entry, attach, list } = await setup();
    const e = await entry();
    await attach(e.transactionId, 'att-1');
    const before = (await db.query('SELECT amount_minor, status, local_date FROM "transaction" WHERE id = ?', [e.transactionId]))[0]!.map(String);
    const r = await writer.run(RemoveAttachment, { attachmentId: 'att-1' }, 'user');
    expect(r).toEqual({ ok: true, value: { transactionId: e.transactionId, fileName: attachmentFileName('att-1') } });
    expect(await list(e.transactionId)).toEqual([]);
    expect((await db.query('SELECT amount_minor, status, local_date FROM "transaction" WHERE id = ?', [e.transactionId]))[0]!.map(String)).toEqual(before);
    expect(await writer.run(RemoveAttachment, { attachmentId: 'att-1' }, 'user')).toEqual({ ok: false, code: 'ATTACHMENT_NOT_FOUND' });
  });

  it('photos and sources stay linked through edits of amount, category, date and splits', async () => {
    const { db, writer, entry, attach, list } = await setup();
    const e = await entry();
    await attach(e.transactionId, 'att-1');
    await writer.run(EditTransaction, { transactionId: e.transactionId, entry: { amountMinor: 50_000, categoryId: 'cat_transport', occurredAtMs: NOW - 86_400_000 } }, 'user');
    await writer.run(SetSplits, { transactionId: e.transactionId, splits: [{ categoryId: 'cat_food', amountMinor: 20_000 }, { categoryId: 'cat_transport', amountMinor: 30_000 }] }, 'user');
    expect((await list(e.transactionId)).map((a) => a.id)).toEqual(['att-1']);
    expect(mapSources(await db.query(SOURCES_SQL, [e.transactionId])).map((s) => s.kind)).toEqual(['manual']);
  });

  it('a merge carries every photo and source to the survivor, deduplicated by digest, and Undo puts them back', async () => {
    const { db, writer, entry, attach, list } = await setup();
    const original = await entry();
    const dup = await entry();
    expect(dup.result).toBe('POSSIBLE_DUPLICATE');
    await attach(original.transactionId, 'att-o', D1);
    await attach(dup.transactionId, 'att-d1', D1);
    await attach(dup.transactionId, 'att-d2', D2);
    const m = await writer.run(MergeDuplicate, { transactionId: dup.transactionId }, 'user');
    expect(m).toMatchObject({ ok: true });
    const kept = await list(original.transactionId);
    expect(kept.map((a) => a.digest).sort()).toEqual([D1, D2]);
    expect(kept.find((a) => a.digest === D1)!.id).toBe('att-o');
    expect(mapSources(await db.query(SOURCES_SQL, [original.transactionId])).length).toBe(2);
    const u = await writer.run(UndoDuplicateResolution, { transactionId: dup.transactionId }, 'user');
    expect(u).toMatchObject({ ok: true });
    expect((await list(dup.transactionId)).map((a) => a.id)).toEqual(['att-d2']);
    expect((await list(original.transactionId)).map((a) => a.id)).toEqual(['att-o']);
  });

  it('the orphan sweep keeps referenced files and deletes unreferenced ones', () => {
    expect(orphanFiles(['a.enc', 'b.enc', 'notes.txt', 'c.enc'], new Set(['a', 'c']))).toEqual(['b.enc']);
    expect(orphanFiles([], new Set())).toEqual([]);
  });
});
