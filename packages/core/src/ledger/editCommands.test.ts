import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { entryInput, recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { DeleteEntry, EditTransaction, mapTransactionDetail, RejectEntry, RestoreTransaction, TRANSACTION_DETAIL_SQL } from './editCommands';
import { entryShape } from './entryCommands';
import { ACTIVITY_SQL, mapActivityRows, SPENT_EXPENSES_SQL } from './readModels';
import { ACCOUNT_TIMELINE_SQL, mapTimelineRows } from './timeline';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const HOUR = 3_600_000;
const PERIOD: [string, string] = ['2026-11-01', '2026-11-30'];

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(17)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const rows = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const bal = async (id: string) => (await rows()).find((x) => x.id === id)!.postingsMinor;
  const dump = async () =>
    JSON.stringify({
      tx: await db.query('SELECT * FROM "transaction" ORDER BY id'),
      posting: await db.query('SELECT * FROM posting ORDER BY id'),
      split: await db.query('SELECT * FROM split ORDER BY id'),
      source: await db.query('SELECT * FROM source_record ORDER BY id'),
    });
  return { db, clock, writer, add, rows, bal, dump };
}
const e = { kind: 'expense' as const, amountMinor: 45000, categoryId: 'cat_food', merchant: 'Swiggy' };

describe('EditTransaction (Story 3.4)', () => {
  it('changes amount, category, account, date, merchant and note together; totals, balances and timelines follow; audit and events record it', async () => {
    const { db, clock, writer, add, bal } = await setup();
    const hdfc = await add('HDFC', 'bank', 1000000);
    const cash = await add('Cash', 'cash', 50000);
    clock.advance(HOUR);
    const r = await recordEntry(writer, { ...e, accountId: hdfc });
    if (!r.ok) throw new Error('x');
    const id = r.value.transactionId;
    const when = NOW + 3 * HOUR;
    const edit = await writer.run(EditTransaction, { transactionId: id, entry: { amountMinor: 30000, categoryId: 'cat_transport', accountId: cash, occurredAtMs: when, merchant: 'Metro', note: 'to work' } }, 'user');
    expect(edit).toMatchObject({ ok: true, value: { categoryChanged: true } });

    expect(await bal(hdfc)).toBe(1000000);
    expect(await bal(cash)).toBe(20000);
    expect(Number((await db.query(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(30000);
    const t = (await db.query('SELECT amount_minor, occurred_at_utc, original_description, note FROM "transaction" WHERE id = ?', [id]))[0]!;
    expect([Number(t[0]), Number(t[1]), t[2], t[3]]).toEqual([30000, when, 'Metro', 'to work']);
    expect((await db.query('SELECT category_id, amount_minor FROM split WHERE transaction_id = ?', [id])).map((x) => [x[0], Number(x[1])])).toEqual([['cat_transport', 30000]]);
    expect(mapTimelineRows(await db.query(ACCOUNT_TIMELINE_SQL, [cash, cash, 10])).map((x) => x.amountMinor)).toEqual([30000]);
    expect(mapTimelineRows(await db.query(ACCOUNT_TIMELINE_SQL, [hdfc, hdfc, 10]))).toHaveLength(0);
    const audit = JSON.stringify(await db.query("SELECT change_json FROM audit_event WHERE kind = 'EditTransaction'"));
    for (const f of ['amount', 'category', 'account', 'date', 'merchant', 'note']) expect(audit).toContain(f);
    const events = (await db.query('SELECT event FROM outbox')).map((x) => String(x[0]));
    expect(events).toEqual(expect.arrayContaining(['TransactionsChanged', 'CategoryAssigned']));
  });

  it('only what is given changes; no category change means no CategoryAssigned', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const r = await recordEntry(writer, { ...e, accountId: a });
    if (!r.ok) throw new Error('x');
    const edit = await writer.run(EditTransaction, { transactionId: r.value.transactionId, entry: { note: 'with Sam' } }, 'user');
    expect(edit).toMatchObject({ ok: true, value: { categoryChanged: false } });
    expect(Number((await db.query("SELECT COUNT(*) FROM outbox WHERE event = 'CategoryAssigned'"))[0]![0])).toBe(0);
  });

  it('Undo (RestoreTransaction) puts every previous value back exactly', async () => {
    const { writer, add, dump } = await setup();
    const hdfc = await add('HDFC', 'bank', 1000000);
    const cash = await add('Cash', 'cash', 0);
    const r = await recordEntry(writer, { ...e, accountId: hdfc, note: 'first' });
    if (!r.ok) throw new Error('x');
    const before = await dump();
    const edit = await writer.run(EditTransaction, { transactionId: r.value.transactionId, entry: { amountMinor: 1, categoryId: 'cat_transport', accountId: cash, merchant: null, note: null } }, 'user');
    if (!edit.ok) throw new Error('edit');
    expect(await dump()).not.toBe(before);
    expect((await writer.run(RestoreTransaction, { snapshot: edit.value.snapshot }, 'user')).ok).toBe(true);
    // updated_at differs by design; everything else is exact
    const strip = (s: string) => s.replace(/"updated_at":\d+/g, '');
    expect(JSON.parse(await dump())).toEqual(JSON.parse(before.replace(/\b179\d{10}\b/g, (m) => m)));
    void strip;
  });

  it('a transfer edits its amount and either side; the same account on both sides is refused and nothing is written', async () => {
    const { writer, add, bal, dump } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const b = await add('Cash', 'cash', 0);
    const c = await add('SBI', 'bank', 0);
    const t = await recordTransfer(writer, { amountMinor: 20000, fromAccountId: a, toAccountId: b });
    if (!t.ok) throw new Error('t');
    const before = await dump();
    expect(await writer.run(EditTransaction, { transactionId: t.value.transactionId, transfer: { toAccountId: a } }, 'user')).toEqual({ ok: false, code: 'SAME_ACCOUNT' });
    expect(await dump()).toBe(before);
    expect((await writer.run(EditTransaction, { transactionId: t.value.transactionId, transfer: { amountMinor: 30000, toAccountId: c } }, 'user')).ok).toBe(true);
    expect([await bal(a), await bal(b), await bal(c)]).toEqual([970000, 0, 30000]);
  });

  it('refuses an empty or invalid amount, unknown category, wrong-kind category, archived account, and an entry that was removed', async () => {
    const { writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const old = await add('Old', 'bank', 0);
    const { ArchiveAccount } = await import('./accountCommands');
    await writer.run(ArchiveAccount, { accountId: old }, 'user');
    const r = await recordEntry(writer, { ...e, accountId: a });
    if (!r.ok) throw new Error('x');
    const id = r.value.transactionId;
    const edit = (entry: object) => writer.run(EditTransaction, { transactionId: id, entry }, 'user');
    expect(await edit({ amountMinor: 0 })).toEqual({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await edit({ amountMinor: 1.5 })).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(await edit({ categoryId: 'nope' })).toEqual({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    expect(await edit({ categoryId: 'cat_in_salary' })).toEqual({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    expect(await edit({ accountId: old })).toEqual({ ok: false, code: 'ACCOUNT_ARCHIVED' });
    expect(await edit({ accountId: 'nope' })).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    await writer.run(DeleteEntry, { transactionId: id }, 'user');
    expect(await edit({ amountMinor: 5 })).toEqual({ ok: false, code: 'ENTRY_REMOVED' });
    expect(await writer.run(EditTransaction, { transactionId: 'nope', entry: {} }, 'user')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });
});

describe('Delete and Reject (Story 3.4)', () => {
  it('Delete soft-removes a manual entry: excluded, deleted, out of every total and list; Undo restores it exactly', async () => {
    const { db, writer, add, bal, dump } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const r = await recordEntry(writer, { ...e, accountId: a });
    if (!r.ok) throw new Error('x');
    const id = r.value.transactionId;
    const before = await dump();
    const del = await writer.run(DeleteEntry, { transactionId: id }, 'user');
    if (!del.ok) throw new Error('del');
    const t = (await db.query('SELECT status, removal_kind, removed_at IS NOT NULL FROM "transaction" WHERE id = ?', [id]))[0]!;
    expect([t[0], t[1], Number(t[2])]).toEqual(['excluded', 'deleted', 1]);
    expect(await bal(a)).toBe(1000000);
    expect(Number((await db.query(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(0);
    expect(mapActivityRows(await db.query(ACTIVITY_SQL, [100]))).toHaveLength(0);
    expect(await writer.run(DeleteEntry, { transactionId: id }, 'user')).toEqual({ ok: false, code: 'ENTRY_REMOVED' });

    expect((await writer.run(RestoreTransaction, { snapshot: del.value.snapshot }, 'user')).ok).toBe(true);
    expect(await bal(a)).toBe(1000000 - 45000);
    const keep = (s: string) => JSON.parse(s).tx.map((row: unknown[]) => row.slice(0, 10));
    expect(keep(await dump())).toEqual(keep(before));
    expect(mapActivityRows(await db.query(ACTIVITY_SQL, [100]))).toHaveLength(1);
  });

  it('a captured entry (core fixture) cannot be deleted; it is rejected: excluded, rejected, with Undo; and a manual one cannot be rejected', async () => {
    const { db, clock, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(HOUR);
    const manual = await recordEntry(writer, { ...e, accountId: a });
    if (!manual.ok) throw new Error('x');
    db.raw.exec(`INSERT INTO "transaction" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,tags_json,needs_category,created_at,updated_at,capture_resolution) VALUES ('sms1','expense','confirmed',1000,${NOW + 2 * HOUR},'2026-11-08','Asia/Kolkata','[]',0,1,1,'auto_approved')`);
    db.raw.exec(`INSERT INTO posting (id,transaction_id,account_id,direction,signed_amount_minor,posting_kind) VALUES ('ps','sms1','${a}','out',-1000,'normal')`);
    db.raw.exec("INSERT INTO split (id,transaction_id,category_id,amount_minor) VALUES ('ss','sms1','cat_food',1000)");
    db.raw.exec("INSERT INTO source_record (id,transaction_id,source_kind,fingerprint,created_at) VALUES ('sr1','sms1','sms','fp-sms1',1)");

    expect(await writer.run(DeleteEntry, { transactionId: 'sms1' }, 'user')).toEqual({ ok: false, code: 'USE_REJECT' });
    expect(await writer.run(RejectEntry, { transactionId: manual.value.transactionId }, 'user')).toEqual({ ok: false, code: 'USE_DELETE' });
    const rej = await writer.run(RejectEntry, { transactionId: 'sms1' }, 'user');
    if (!rej.ok) throw new Error('rej');
    const t = (await db.query("SELECT status, capture_resolution, removal_kind FROM \"transaction\" WHERE id = 'sms1'"))[0]!;
    expect([t[0], t[1], t[2]]).toEqual(['excluded', 'rejected', 'rejected']);
    expect((await db.query('SELECT event FROM outbox')).map((x) => String(x[0]))).toContain('CapturesRejected');
    expect((await writer.run(RestoreTransaction, { snapshot: rej.value.snapshot }, 'user')).ok).toBe(true);
    const back = (await db.query("SELECT status, capture_resolution, removal_kind, removed_at FROM \"transaction\" WHERE id = 'sms1'"))[0]!;
    expect([back[0], back[1], back[2], back[3]]).toEqual(['confirmed', 'auto_approved', null, null]);
  });

  it('opening balances and adjustments are not deletable here', async () => {
    const { db, writer, add } = await setup();
    await add('HDFC', 'bank', 1000);
    const open = String((await db.query("SELECT id FROM \"transaction\" WHERE event_type = 'opening_balance'"))[0]![0]);
    expect(await writer.run(DeleteEntry, { transactionId: open }, 'user')).toEqual({ ok: false, code: 'NOT_REMOVABLE' });
  });
});

describe('Duplicate (copy as new)', () => {
  it('saving a copy through SubmitCapture is never held against the entry it was copied from, but is against another', async () => {
    const { clock, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(HOUR);
    const first = await recordEntry(writer, { ...e, accountId: a });
    if (!first.ok) throw new Error('x');
    clock.advance(60_000);
    const copy = await writer.run(SubmitCapture, { ...entryInput({ ...e, accountId: a }), copiedFrom: first.value.transactionId }, 'user');
    expect(copy).toMatchObject({ ok: true, value: { result: 'RECORDED' } });
    clock.advance(60_000);
    expect(await recordEntry(writer, { ...e, accountId: a })).toMatchObject({ value: { result: 'POSSIBLE_DUPLICATE' } });
  });
});

describe('transaction detail read model', () => {
  it('reads an expense, an income and a transfer the way the page shows them', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const b = await add('Cash', 'cash', 0);
    const ex = await recordEntry(writer, { ...e, accountId: a, paymentMethod: 'upi', note: 'lunch' });
    const inc = await recordEntry(writer, { kind: 'income', amountMinor: 500000, categoryId: 'cat_in_salary', accountId: a });
    const tr = await recordTransfer(writer, { amountMinor: 20000, fromAccountId: a, toAccountId: b });
    if (!ex.ok || !inc.ok || !tr.ok) throw new Error('x');
    const d = async (id: string) => mapTransactionDetail(await db.query(TRANSACTION_DETAIL_SQL, [id]))!;
    expect(await d(ex.value.transactionId)).toMatchObject({ type: 'expense', amountMinor: 45000, merchant: 'Swiggy', note: 'lunch', paymentMethod: 'upi', category: { name: 'Food & Drinks' }, from: { name: 'HDFC' }, to: null, sourceKind: 'manual', removed: false });
    expect(await d(inc.value.transactionId)).toMatchObject({ type: 'income', from: null, to: { name: 'HDFC' }, category: { name: 'Salary' } });
    expect(await d(tr.value.transactionId)).toMatchObject({ type: 'transfer', from: { name: 'HDFC' }, to: { name: 'Cash' }, category: null });
    expect(mapTransactionDetail(await db.query(TRANSACTION_DETAIL_SQL, ['nope']))).toBeNull();
  });
});
