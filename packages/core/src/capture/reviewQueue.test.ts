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
import { BulkRecategorise } from '../ledger/bulk';
import { REVIEW_COUNT_SQL } from '../ledger/readModels';
import { ApproveCapture, ConfirmForeignAmount, mapReviewItems, mapReviewSides, NEEDS_CATEGORY_SQL, REVIEW_SIDE_SQL, sourceWords, TO_CHECK_SQL, UndoReviewDecision, type ReviewSide } from './reviewQueue';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 9, 1, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(53)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok) throw new Error('add');
  clock.advance(NOW - Date.UTC(2026, 9, 1, 10, 0, 1));
  const accountId = a.value.accountId;

  /** TEST ONLY fixture until capture sources ship: a pending capture waiting for the user. */
  const pending = async (id: string, over: { foreign?: boolean; atMs?: number; source?: string; reason?: string; matched?: string } = {}) => {
    const at = over.atMs ?? NOW;
    const foreignCols = over.foreign ? 'foreign_amount_minor, foreign_currency, foreign_currency_exponent, ' : '';
    const foreignVals = over.foreign ? "1299, 'USD', 2, " : '';
    await db.query(
      `INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, tags_json, needs_category, ${foreignCols}created_at, updated_at) VALUES (?, 'expense', 'needs_review', ?, ?, '2026-11-08', 'Asia/Kolkata', 'SWIGGY*BLR 8821', '[]', 0, ${foreignVals}?, ?)`,
      [id, over.foreign ? 0 : 45_000, at, NOW, NOW],
    );
    await db.query('INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, ?)', ['s-' + id, id, 'cat_food', over.foreign ? 0 : 45_000]);
    if (!over.foreign) await db.query("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'out', -45000, 'normal')", ['p-' + id, id, accountId]);
    await db.query('INSERT INTO source_record (id, transaction_id, source_kind, fingerprint, created_at) VALUES (?, ?, ?, ?, ?)', ['sr-' + id, id, over.source ?? 'sms', 'fp-' + id, NOW]);
    await db.query("INSERT INTO review_candidate (id, transaction_id, matched_transaction_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)", ['rc-' + id, id, over.matched ?? null, over.reason ?? (over.foreign ? 'foreign_currency' : 'pending'), NOW]);
  };
  const queue = async () => {
    const rows = await db.query(TO_CHECK_SQL);
    const matched = new Map<string, ReviewSide>();
    for (const r of rows) {
      if (r[10] === null) continue;
      for (const s of mapReviewSides(await db.query(REVIEW_SIDE_SQL, [String(r[10])]))) matched.set(s.id, s);
    }
    return mapReviewItems(rows, matched);
  };
  const count = async () => Number((await db.query(REVIEW_COUNT_SQL))[0]![0]);
  return { db, writer, accountId, pending, queue, count };
}

describe('review queue (Story 3.10)', () => {
  it('toCheck lists exactly the needs_review set, newest first, and matches the tab dot count', async () => {
    const { writer, accountId, pending, queue, count } = await setup();
    await pending('p-old', { atMs: NOW - 86_400_000 });
    await pending('p-new', { atMs: NOW });
    const ok = await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId, merchant: 'Tea', occurredAtMs: NOW });
    expect(ok.ok).toBe(true);
    const items = await queue();
    expect(items.map((i) => i.id)).toEqual(['p-new', 'p-old']);
    expect(await count()).toBe(items.length);
    expect(items[0]).toMatchObject({ reason: 'pending', sourceKind: 'sms', merchant: 'SWIGGY*BLR 8821', category: 'Food & Drinks', account: 'HDFC' });
    expect(sourceWords('sms')).toBe('bankSms');
    expect(sourceWords('manual')).toBe('addedByYou');
  });

  it('a possible duplicate carries the entry it may duplicate for the side-by-side card', async () => {
    const { writer, accountId, pending, queue } = await setup();
    const orig = await recordEntry(writer, { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, merchant: 'Swiggy', occurredAtMs: NOW });
    if (!orig.ok) throw new Error('orig');
    await pending('dup', { reason: 'duplicate', matched: orig.value.transactionId });
    const [item] = await queue();
    expect(item).toMatchObject({ id: 'dup', reason: 'duplicate' });
    expect(item!.alreadyRecorded).toMatchObject({ id: orig.value.transactionId, merchant: 'Swiggy', sourceKind: 'manual', amountMinor: 45_000 });
  });

  it('ApproveCapture confirms with user_approved, updates the count, and Undo puts it back waiting', async () => {
    const { db, writer, pending, count } = await setup();
    await pending('p1');
    expect(await count()).toBe(1);
    const r = await writer.run(ApproveCapture, { transactionId: 'p1' }, 'user');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const row = (await db.query('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', ['p1']))[0]!;
    expect([String(row[0]), String(row[1])]).toEqual(['confirmed', 'user_approved']);
    expect(await count()).toBe(0);
    expect(Number((await db.query("SELECT COUNT(*) FROM review_candidate WHERE transaction_id = 'p1' AND status = 'open'"))[0]![0])).toBe(0);

    const u = await writer.run(UndoReviewDecision, { snapshot: r.value.snapshot }, 'user');
    expect(u).toMatchObject({ ok: true });
    expect(await count()).toBe(1);
    expect(Number((await db.query("SELECT COUNT(*) FROM review_candidate WHERE transaction_id = 'p1' AND status = 'open'"))[0]![0])).toBe(1);
  });

  it('Approve refuses a duplicate (use Keep both / Merge), a foreign capture, and an entry that is not waiting', async () => {
    const { writer, accountId, pending } = await setup();
    const orig = await recordEntry(writer, { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, occurredAtMs: NOW });
    if (!orig.ok) throw new Error('orig');
    await pending('dup', { reason: 'duplicate', matched: orig.value.transactionId });
    await pending('fx', { foreign: true });
    expect(await writer.run(ApproveCapture, { transactionId: 'dup' }, 'user')).toEqual({ ok: false, code: 'USE_KEEP_OR_MERGE' });
    expect(await writer.run(ApproveCapture, { transactionId: 'fx' }, 'user')).toEqual({ ok: false, code: 'AMOUNT_NEEDED' });
    expect(await writer.run(ApproveCapture, { transactionId: orig.value.transactionId }, 'user')).toEqual({ ok: false, code: 'NOT_PENDING' });
    expect(await writer.run(ApproveCapture, { transactionId: 'ghost' }, 'user')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });

  it('a foreign-currency capture has no posting until the user enters the ₹ amount; the foreign amount stays as metadata', async () => {
    const { db, writer, accountId, pending, queue } = await setup();
    await pending('fx', { foreign: true });
    const [item] = await queue();
    expect(item!.foreign).toEqual({ amountMinor: 1299, currency: 'USD', exponent: 2 });
    expect(Number((await db.query("SELECT COUNT(*) FROM posting WHERE transaction_id = 'fx'"))[0]![0])).toBe(0);
    expect(await writer.run(ConfirmForeignAmount, { transactionId: 'fx', amountMinor: 0, accountId }, 'user')).toEqual({ ok: false, code: 'AMOUNT_REQUIRED' });
    const r = await writer.run(ConfirmForeignAmount, { transactionId: 'fx', amountMinor: 108_000, accountId }, 'user');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const t = (await db.query("SELECT status, amount_minor, foreign_amount_minor, foreign_currency FROM \"transaction\" WHERE id = 'fx'"))[0]!;
    expect([String(t[0]), Number(t[1]), Number(t[2]), String(t[3])]).toEqual(['confirmed', 108_000, 1299, 'USD']);
    expect(Number((await db.query("SELECT signed_amount_minor FROM posting WHERE transaction_id = 'fx'"))[0]![0])).toBe(-108_000);
    const u = await writer.run(UndoReviewDecision, { snapshot: r.value.snapshot }, 'user');
    expect(u).toMatchObject({ ok: true });
    expect(Number((await db.query("SELECT COUNT(*) FROM posting WHERE transaction_id = 'fx'"))[0]![0])).toBe(0);
    expect(String((await db.query("SELECT status FROM \"transaction\" WHERE id = 'fx'"))[0]![0])).toBe('needs_review');
  });

  it('confirmed entries needing a category are a separate list, never in the to-check count, and a category clears the flag', async () => {
    const { db, writer, accountId, count } = await setup();
    const e = await recordEntry(writer, { kind: 'expense', amountMinor: 900, categoryId: 'cat_uncategorised', accountId, occurredAtMs: NOW });
    if (!e.ok) throw new Error('e');
    await db.query('UPDATE "transaction" SET needs_category = 1 WHERE id = ?', [e.value.transactionId]);
    expect(await count()).toBe(0);
    expect((await db.query(NEEDS_CATEGORY_SQL)).map((r) => String(r[0]))).toEqual([e.value.transactionId]);
    const r = await writer.run(BulkRecategorise, { transactionIds: [e.value.transactionId], categoryId: 'cat_food' }, 'user');
    expect(r).toMatchObject({ ok: true, value: { movedIds: [e.value.transactionId] } });
    expect((await db.query(NEEDS_CATEGORY_SQL)).length).toBe(0);
  });
});
