import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from '../ledger/accounts';
import { entryShape } from '../ledger/entryCommands';
import { ACTIVITY_SQL, homeAccounts, mapActivityRows, SPENT_EXPENSES_SQL } from '../ledger/readModels';
import { DUPLICATE_INFO_SQL, isAutoApprovable, KeepBoth, mapDuplicateInfo, MergeDuplicate, TIP_CATEGORY_NAME, UndoDuplicateResolution } from './resolveDuplicate';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const MIN = 60_000;
const PERIOD: [string, string] = ['2026-11-01', '2026-11-30'];

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(13)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
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
  const q = (sql: string, p: (string | number)[] = []) => db.query(sql, p);
  /** A transaction written the way a later source would (receipt, card SMS), through the same tables. */
  let n = 0;
  const insertTx = (o: { id: string; status: 'confirmed' | 'needs_review'; amount: number; accountId: string; source: string; splits: [string, number][]; at?: number }) => {
    const at = o.at ?? NOW + 3_600_000;
    db.raw.exec(`INSERT INTO "transaction" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,tags_json,needs_category,created_at,updated_at,capture_resolution) VALUES ('${o.id}','expense','${o.status}',${o.amount},${at},'2026-11-08','Asia/Kolkata','[]',0,${at},${at},${o.status === 'confirmed' ? "'user_approved'" : 'NULL'})`);
    db.raw.exec(`INSERT INTO posting (id,transaction_id,account_id,direction,signed_amount_minor,posting_kind) VALUES ('p-${o.id}','${o.id}','${o.accountId}','out',${-o.amount},'normal')`);
    o.splits.forEach(([cat, amt], i) => db.raw.exec(`INSERT INTO split (id,transaction_id,category_id,amount_minor) VALUES ('s-${o.id}-${i}','${o.id}','${cat}',${amt})`));
    db.raw.exec(`INSERT INTO source_record (id,transaction_id,source_kind,fingerprint,created_at) VALUES ('sr-${o.id}','${o.id}','${o.source}','fp-${o.id}-${++n}',${at})`);
  };
  const flag = (heldId: string, matchedId: string) => db.raw.exec(`INSERT INTO review_candidate (id,transaction_id,matched_transaction_id,reason,status,created_at) VALUES ('rc-${heldId}','${heldId}','${matchedId}','duplicate','open',${NOW})`);
  return { db, clock, writer, add, rows, q, insertTx, flag };
}

const dup = { kind: 'expense' as const, amountMinor: 45000, merchant: 'Swiggy' };

describe('isAutoApprovable', () => {
  it('is false for any entry with an open duplicate candidate', () => {
    expect(isAutoApprovable({ hasOpenDuplicate: true })).toBe(false);
    expect(isAutoApprovable({ hasOpenDuplicate: false })).toBe(true);
    expect(isAutoApprovable({ hasOpenDuplicate: false, needsCategory: true })).toBe(false);
  });
});

describe('Keep both (Story 3.3)', () => {
  it('confirms the held entry as user_approved, resolves the candidate, and both entries count', async () => {
    const { db, clock, writer, add, rows, q } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(1000);
    await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    clock.advance(5 * MIN);
    const second = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    if (!second.ok) throw new Error('second');
    expect(Number((await q(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(45000);

    const r = await writer.run(KeepBoth, { transactionId: second.value.transactionId }, 'user');
    expect(r.ok).toBe(true);
    const t = (await q('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', [second.value.transactionId]))[0]!;
    expect([t[0], t[1]]).toEqual(['confirmed', 'user_approved']);
    expect(String((await q('SELECT status FROM review_candidate WHERE transaction_id = ?', [second.value.transactionId]))[0]![0])).toBe('resolved');
    expect(Number((await q(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(90000);
    expect((await rows())[0]!.postingsMinor).toBe(1000000 - 90000);
    expect(Number((await q("SELECT COUNT(*) FROM audit_event WHERE kind = 'KeepBoth'"))[0]![0])).toBeGreaterThanOrEqual(1);
    expect(await writer.run(KeepBoth, { transactionId: second.value.transactionId }, 'user')).toEqual({ ok: false, code: 'ALREADY_RESOLVED' });
    void db;
  });

  it('refuses an entry that is not a possible duplicate', async () => {
    const { writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000);
    const r = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    if (!r.ok) throw new Error('x');
    expect(await writer.run(KeepBoth, { transactionId: r.value.transactionId }, 'user')).toEqual({ ok: false, code: 'NOT_A_DUPLICATE' });
  });
});

describe('Merge two manual entries (Story 3.3)', () => {
  it('the confirmed entry survives with its category; the held one is excluded and hidden; sources and the candidate follow', async () => {
    const { db, clock, writer, add, q } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(1000);
    const first = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    clock.advance(5 * MIN);
    const second = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    if (!first.ok || !second.ok) throw new Error('x');

    const r = await writer.run(MergeDuplicate, { transactionId: second.value.transactionId }, 'user');
    expect(r).toEqual({ ok: true, value: { survivorId: first.value.transactionId, excludedId: second.value.transactionId } });
    const ex = (await q('SELECT status, removal_kind, removed_at IS NOT NULL FROM "transaction" WHERE id = ?', [second.value.transactionId]))[0]!;
    expect([ex[0], ex[1], Number(ex[2])]).toEqual(['excluded', 'excluded', 1]);
    expect((await q('SELECT transaction_id FROM source_record ORDER BY created_at')).map((x) => String(x[0]))).toEqual([first.value.transactionId, first.value.transactionId]);
    expect(Number((await q(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(45000);
    expect(mapActivityRows(await q(ACTIVITY_SQL, [100]))).toHaveLength(1);
    void db;
  });

  it('different categories need the user to choose; the chosen one is applied to the survivor', async () => {
    const { clock, writer, add, q } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(1000);
    const first = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    clock.advance(5 * MIN);
    const second = await recordEntry(writer, { ...dup, categoryId: 'cat_transport', accountId: a });
    if (!first.ok || !second.ok) throw new Error('x');
    const info = mapDuplicateInfo(await q(DUPLICATE_INFO_SQL, [second.value.transactionId]))!;
    expect(info).toMatchObject({ matchedTransactionId: first.value.transactionId, categoriesDiffer: true, heldCategory: { id: 'cat_transport' }, confirmedCategory: { id: 'cat_food' } });
    expect(await writer.run(MergeDuplicate, { transactionId: second.value.transactionId }, 'user')).toEqual({ ok: false, code: 'CATEGORY_REQUIRED' });
    expect(await writer.run(MergeDuplicate, { transactionId: second.value.transactionId, categoryId: 'nope' }, 'user')).toEqual({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    await writer.run(MergeDuplicate, { transactionId: second.value.transactionId, categoryId: 'cat_transport' }, 'user');
    expect(String((await q('SELECT category_id FROM split WHERE transaction_id = ?', [first.value.transactionId]))[0]![0])).toBe('cat_transport');
  });
});

describe('Merge by source authority (FIN-027 fixtures)', () => {
  it('a Rs 2,340 receipt paid with Cash, 14 item splits, merged with a Rs 2,340 card SMS: one transaction on the card with the 14 splits; Cash is not debited; both sources kept', async () => {
    const { db, writer, add, rows, q, insertTx, flag } = await setup();
    const cash = await add('Cash', 'cash', 1000000);
    const card = await add('HDFC Card', 'card', 0);
    const items = Array.from({ length: 14 }, (_, i) => ['cat_food', i < 13 ? 16_000 : 234_000 - 13 * 16_000] as [string, number]);
    expect(items.reduce((s, [, a]) => s + a, 0)).toBe(234_000);
    insertTx({ id: 'receipt', status: 'confirmed', amount: 234_000, accountId: cash, source: 'receipt', splits: items });
    insertTx({ id: 'sms', status: 'needs_review', amount: 234_000, accountId: card, source: 'sms', splits: [['cat_other', 234_000]] });
    flag('sms', 'receipt');
    expect((await rows()).find((r) => r.id === cash)!.postingsMinor).toBe(1000000 - 234_000);

    const r = await writer.run(MergeDuplicate, { transactionId: 'sms' }, 'user');
    expect(r).toEqual({ ok: true, value: { survivorId: 'sms', excludedId: 'receipt' } });
    expect((await q('SELECT COUNT(*) FROM split WHERE transaction_id = ?', ['sms']))[0]![0]).toBe(14);
    expect(Number((await q('SELECT SUM(amount_minor) FROM split WHERE transaction_id = ?', ['sms']))[0]![0])).toBe(234_000);
    const all = await rows();
    expect(all.find((x) => x.id === cash)!.postingsMinor).toBe(1000000); // Cash is not debited by the merged purchase
    expect(homeAccounts(all).cardDuesMinor).toBe(234_000);
    expect((await q('SELECT source_kind FROM source_record WHERE transaction_id = ? ORDER BY source_kind', ['sms'])).map((x) => String(x[0]))).toEqual(['receipt', 'sms']);
    expect(Number((await q("SELECT COUNT(*) FROM \"transaction\" WHERE status = 'confirmed' AND event_type = 'expense'"))[0]![0])).toBe(1);
    void db;
  });

  it('a Rs 1,000 restaurant receipt merged with a Rs 1,150 card charge gives 1,150 with a Rs 150 Tip / adjustment split in the receipt main category', async () => {
    const { writer, add, q, insertTx, flag } = await setup();
    const card = await add('HDFC Card', 'card', 0);
    const cash = await add('Cash', 'cash', 100000);
    insertTx({ id: 'receipt', status: 'confirmed', amount: 100_000, accountId: cash, source: 'receipt', splits: [['cat_food', 70_000], ['cat_shopping', 30_000]] });
    insertTx({ id: 'charge', status: 'needs_review', amount: 115_000, accountId: card, source: 'sms', splits: [['cat_other', 115_000]] });
    flag('charge', 'receipt');
    const merged = await writer.run(MergeDuplicate, { transactionId: 'charge' }, 'user');
    expect(merged).toMatchObject({ ok: true });
    const splits = (await q('SELECT category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY amount_minor DESC', ['charge'])).map((r) => [String(r[0]), Number(r[1]), r[2] === null ? null : String(r[2])]);
    expect(splits).toEqual([['cat_food', 70_000, null], ['cat_shopping', 30_000, null], ['cat_food', 15_000, TIP_CATEGORY_NAME]].sort((a, b) => (b[1] as number) - (a[1] as number)));
    expect(Number((await q('SELECT amount_minor FROM "transaction" WHERE id = ?', ['charge']))[0]![0])).toBe(115_000);
    expect(Number((await q('SELECT SUM(amount_minor) FROM split WHERE transaction_id = ?', ['charge']))[0]![0])).toBe(115_000);
  });
});

describe('Undo returns every row exactly (round trip)', () => {
  const dump = async (db: NodeSqliteDatabase) =>
    JSON.stringify({
      tx: await db.query('SELECT id, status, capture_resolution, removed_at, removal_kind, amount_minor, occurred_at_utc, local_date FROM "transaction" ORDER BY id'),
      posting: await db.query('SELECT id, transaction_id, account_id, direction, signed_amount_minor, posting_kind FROM posting ORDER BY id'),
      split: await db.query('SELECT id, transaction_id, category_id, amount_minor, memo FROM split ORDER BY id'),
      source: await db.query('SELECT id, transaction_id, source_kind FROM source_record ORDER BY id'),
      rc: await db.query('SELECT id, transaction_id, matched_transaction_id, status, resolved_at FROM review_candidate ORDER BY id'),
    });

  it('Keep both and Merge, undone, leave the database exactly as it was', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('cat_food', 'cat_transport'), fc.constantFrom('cat_food', 'cat_transport'), fc.constantFrom('keep', 'merge'), async (c1, c2, action) => {
        const { db, clock, writer, add } = await setup();
        const a = await add('HDFC', 'bank', 1000000);
        clock.advance(1000);
        await recordEntry(writer, { ...dup, categoryId: c1, accountId: a });
        clock.advance(5 * MIN);
        const held = await recordEntry(writer, { ...dup, categoryId: c2, accountId: a });
        if (!held.ok) throw new Error('held');
        const before = await dump(db);
        const done =
          action === 'keep'
            ? await writer.run(KeepBoth, { transactionId: held.value.transactionId }, 'user')
            : await writer.run(MergeDuplicate, { transactionId: held.value.transactionId, categoryId: c2 }, 'user');
        expect(done.ok).toBe(true);
        expect(await dump(db)).not.toBe(before);
        expect((await writer.run(UndoDuplicateResolution, { transactionId: held.value.transactionId }, 'user')).ok).toBe(true);
        expect(await dump(db)).toBe(before);
        expect(await writer.run(UndoDuplicateResolution, { transactionId: held.value.transactionId }, 'user')).toEqual({ ok: false, code: 'NOTHING_TO_UNDO' });
      }),
      { numRuns: 12 },
    );
  }, 120_000);

  it('the receipt and card fixtures undo exactly too', async () => {
    const { db, writer, add, insertTx, flag } = await setup();
    const card = await add('HDFC Card', 'card', 0);
    const cash = await add('Cash', 'cash', 100000);
    insertTx({ id: 'receipt', status: 'confirmed', amount: 100_000, accountId: cash, source: 'receipt', splits: [['cat_food', 70_000], ['cat_shopping', 30_000]] });
    insertTx({ id: 'charge', status: 'needs_review', amount: 115_000, accountId: card, source: 'sms', splits: [['cat_other', 115_000]] });
    flag('charge', 'receipt');
    const before = await dump(db);
    await writer.run(MergeDuplicate, { transactionId: 'charge' }, 'user');
    expect(await dump(db)).not.toBe(before);
    await writer.run(UndoDuplicateResolution, { transactionId: 'charge' }, 'user');
    expect(await dump(db)).toBe(before);
  });
});

describe('a held entry in Activity (durable path)', () => {
  it('shows with held = true so it can be resolved, is not in the day Spent, and leaves Activity once resolved by Merge', async () => {
    const { clock, writer, add, q } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(1000);
    const first = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    clock.advance(5 * MIN);
    const second = await recordEntry(writer, { ...dup, categoryId: 'cat_food', accountId: a });
    if (!first.ok || !second.ok) throw new Error('x');
    const { groupByDay } = await import('../ledger/readModels');
    const rows = mapActivityRows(await q(ACTIVITY_SQL, [100]));
    expect(rows.map((r) => [r.id === second.value.transactionId, r.held === true]).sort()).toEqual([[false, false], [true, true]]);
    expect(groupByDay(rows)[0]!.spentMinor).toBe(45000);
    await writer.run(MergeDuplicate, { transactionId: second.value.transactionId }, 'user');
    expect(mapActivityRows(await q(ACTIVITY_SQL, [100])).map((r) => r.held)).toEqual([undefined]);
  });
});
