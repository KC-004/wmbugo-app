import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { entryShape } from './entryCommands';
import { activityIdsQuery, searchIndexer } from './activitySearch';
import { classifyBulk, BulkRecategorise, UndoBulkRecategorise, type BulkRow } from './bulk';
import { SetSplits } from './splits';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 9, 1, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(47)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape], indexer: searchIndexer,
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 100_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('add');
  clock.advance(NOW - Date.UTC(2026, 9, 1, 10, 0, 2));
  const accountId = a.value.accountId;
  const petrol = async (n: number, cat = 'cat_other') => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const e = await recordEntry(writer, { kind: 'expense', amountMinor: 50_000 + i, categoryId: cat, accountId, merchant: 'HP Petrol', occurredAtMs: NOW - i * 3_600_000 });
      if (!e.ok) throw new Error('e ' + e.code);
      ids.push(e.value.transactionId);
    }
    return ids;
  };
  const snap = async () => (await db.query('SELECT t.id, t.amount_minor, t.local_date, p.account_id, p.signed_amount_minor FROM "transaction" t JOIN posting p ON p.transaction_id = t.id ORDER BY t.id, p.id')).map((r) => r.map(String).join('~'));
  const cat = async (id: string) => String((await db.query('SELECT category_id FROM split WHERE transaction_id = ?', [id]))[0]![0]);
  return { db, writer, accountId, cashId: b.value.accountId, petrol, snap, cat };
}

describe('BulkRecategorise (Story 3.9)', () => {
  it('moves 14 HP Petrol entries from Other to Transport in one transaction: audit per entry, one CategoryAssigned, amounts and postings unchanged', async () => {
    const { db, writer, petrol, snap, cat } = await setup();
    const ids = await petrol(14);
    const before = await snap();
    await db.query('DELETE FROM outbox');
    const auditBefore = Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'BulkRecategorise'"))[0]![0]);
    const r = await writer.run(BulkRecategorise, { transactionIds: ids, categoryId: 'cat_transport' }, 'user');
    expect(r).toMatchObject({ ok: true, value: { skipped: 0 } });
    if (!r.ok) return;
    expect(r.value.movedIds).toHaveLength(14);
    for (const id of ids) expect(await cat(id)).toBe('cat_transport');
    expect(await snap()).toEqual(before);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'BulkRecategorise'"))[0]![0]) - auditBefore).toBe(14);
    const events = (await db.query('SELECT event FROM outbox')).map((x) => String(x[0]));
    expect(events.filter((e) => e === 'CategoryAssigned')).toHaveLength(1);

    const u = await writer.run(UndoBulkRecategorise, { previous: r.value.previous }, 'user');
    expect(u).toMatchObject({ ok: true, value: { restored: 14 } });
    for (const id of ids) expect(await cat(id)).toBe('cat_other');
    expect(await snap()).toEqual(before);
  });

  it('skips transfers, splits, waiting entries and unknown ids, and counts them; a wrong-kind category moves nothing', async () => {
    const { db, writer, petrol, accountId, cashId, cat } = await setup();
    const [a, b] = await petrol(2);
    const tr = await recordTransfer(writer, { fromAccountId: accountId, toAccountId: cashId, amountMinor: 1000 });
    if (!tr.ok) throw new Error('tr');
    await writer.run(SetSplits, { transactionId: b!, splits: [{ categoryId: 'cat_other', amountMinor: 20_000 }, { categoryId: 'cat_groceries', amountMinor: 30_001 }] }, 'user');
    await db.query(`INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('w1','expense','needs_review',500,${NOW},'2026-11-08','UTC',${NOW},${NOW})`);
    await db.query("INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES ('ws','w1','cat_other',500)");
    const r = await writer.run(BulkRecategorise, { transactionIds: [a!, b!, tr.value.transactionId, 'w1', 'ghost'], categoryId: 'cat_transport' }, 'user');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.value.movedIds).toEqual([a]);
    expect(r.value.skipped).toBe(4);
    expect(await cat(a!)).toBe('cat_transport');
    expect(await cat('w1')).toBe('cat_other');
    const wrong = await writer.run(BulkRecategorise, { transactionIds: [a!], categoryId: 'cat_in_salary' }, 'user');
    expect(wrong).toMatchObject({ ok: true, value: { movedIds: [], skipped: 1 } });
  });

  it('refuses an empty selection and an unknown category', async () => {
    const { writer, petrol } = await setup();
    const [a] = await petrol(1);
    expect(await writer.run(BulkRecategorise, { transactionIds: [], categoryId: 'cat_transport' }, 'user')).toEqual({ ok: false, code: 'NOTHING_SELECTED' });
    expect(await writer.run(BulkRecategorise, { transactionIds: [a!], categoryId: 'nope' }, 'user')).toEqual({ ok: false, code: 'CATEGORY_NOT_FOUND' });
  });

  it('Select all returns the whole filtered set, not only a page', async () => {
    const { db, petrol } = await setup();
    const ids = await petrol(14);
    const { sql, params } = activityIdsQuery({ search: 'HP Petrol' }, { exponent: 2, nowMs: NOW });
    const found = (await db.query(sql, params)).map((r) => String(r[0]));
    expect([...found].sort()).toEqual([...ids].sort());
  });

  it('classifyBulk reports a single source category or mixed sources', () => {
    const row = (id: string, categoryId: string): BulkRow => ({ id, eventType: 'expense', status: 'confirmed', removed: false, splitCount: 1, categoryId });
    expect(classifyBulk([row('a', 'cat_other'), row('b', 'cat_other')], { id: 'cat_transport', kind: 'expense' })).toMatchObject({ fromCategoryId: 'cat_other', mixedSources: false, wontChange: 0 });
    expect(classifyBulk([row('a', 'cat_other'), row('b', 'cat_food')], { id: 'cat_transport', kind: 'expense' })).toMatchObject({ fromCategoryId: null, mixedSources: true });
    expect(classifyBulk([row('a', 'cat_transport')], { id: 'cat_transport', kind: 'expense' })).toMatchObject({ movableIds: [], wontChange: 1 });
  });

  it('property: any selection leaves every amount and posting unchanged, and Undo restores every category', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (picks) => {
        const { writer, petrol, snap, cat } = await setup();
        const ids = await petrol(picks.length);
        const before = await snap();
        const chosen = ids.filter((_, i) => picks[i]);
        const r = await writer.run(BulkRecategorise, { transactionIds: chosen, categoryId: 'cat_transport' }, 'user');
        if (chosen.length === 0) {
          expect(r).toEqual({ ok: false, code: 'NOTHING_SELECTED' });
          return;
        }
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(await snap()).toEqual(before);
        await writer.run(UndoBulkRecategorise, { previous: r.value.previous }, 'user');
        for (const id of ids) expect(await cat(id)).toBe('cat_other');
      }),
      { numRuns: 15 },
    );
  });
});
