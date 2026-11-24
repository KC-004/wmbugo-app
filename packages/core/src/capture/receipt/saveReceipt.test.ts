import { FakeClock } from '../../shared/clock';
import { createRedactingLogger } from '../../shared/logger';
import { createIdGenerator, seededRandom } from '../../shared/uuid';
import { NodeSqliteDatabase } from '../../testing/nodeSqlite';
import { SetUpProfile } from '../../usecases/setUpProfile';
import { findRegion } from '../../profile/regions';
import { LedgerWriter } from '../../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../../ledger/accountCommands';
import { RemoveEntry } from '../../ledger/entryCommands';
import { PurgeEntry } from '../../ledger/purge';
import { DeleteCategory, MergeCategory } from '../../ledger/categoryArchive';
import { UNCATEGORISED_ID } from '../../ledger/categories';
import { NOT_ITEMISED_MEMO } from '../../ledger/splits';
import { SubmitCapture } from '../submitCapture';
import { SaveReceipt, type SaveReceiptInput } from './saveReceipt';
import { mapReceiptItems, RECEIPT_ITEMS_SQL } from './readModel';
import type { ReceiptCharge, ReceiptDraft, ReceiptItem } from './types';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0); // 8 Nov 2026 15:30 in Kolkata

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(21)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 5_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  return { db, clock, writer, accountId: a.value.accountId };
}

const item = (name: string, amountMinor: number, discountMinor = 0, lineIndex = 0): ReceiptItem => ({ name, amountMinor, discountMinor, lineIndex, certainty: 'sure' });
const charge = (label: string, value: number): ReceiptCharge => ({ label, value, certainty: 'sure' });
const draft = (p: Partial<{ items: ReceiptItem[]; taxes: number[]; discounts: number[]; total: number | null; date: string | null; time: string | null; currency: string }>): ReceiptDraft => ({
  merchant: { value: 'Sagar Fresh Mart', certainty: 'sure' },
  date: p.date === null ? { value: null, certainty: 'missing' } : { value: p.date ?? '2026-11-05', certainty: 'sure' },
  time: p.time ? { value: p.time, certainty: 'sure' } : { value: null, certainty: 'missing' },
  currency: { value: p.currency ?? 'INR', certainty: 'sure' },
  subtotal: { value: null, certainty: 'missing' },
  taxes: (p.taxes ?? []).map((v) => charge('GST', v)),
  fees: [],
  discounts: (p.discounts ?? []).map((v) => charge('Discount', v)),
  total: p.total === null ? { value: null, certainty: 'missing' } : { value: p.total ?? 5400, certainty: 'sure' },
  items: p.items ?? [item('Rice', 4200), item('Soap', 1800, 0, 1)],
  unparsedLineCount: 0,
});

const base = (accountId: string, over: Partial<SaveReceiptInput> = {}): SaveReceiptInput => ({
  submissionId: 'receipt-1',
  draft: draft({ discounts: [600] }),
  itemCategories: ['cat_groceries', 'cat_shopping'],
  mainCategoryId: 'cat_groceries',
  accountId,
  ...over,
});

const DIGEST = 'a'.repeat(64);
/** The account's opening balance is one entry of its own. */
const OPENING_TXS = 1;

describe('SaveReceipt (Story 10.4)', () => {
  it('saves one confirmed expense with a split per category, the receipt items and the photo, in one commit with audit and events', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId, { attachment: { attachmentId: 'att-1', digest: DIGEST, sizeBytes: 1234 } }), 'user');
    expect(r).toMatchObject({ ok: true, value: { result: 'RECORDED' } });
    const id = r.ok ? r.value.transactionId : '';
    const t = (await db.query('SELECT status, capture_resolution, amount_minor, original_description, local_date FROM "transaction" WHERE id = ?', [id]))[0]!;
    expect(t.slice(0, 4)).toEqual(['confirmed', 'user_approved', 5400, 'Sagar Fresh Mart']);
    expect(t[4]).toBe('2026-11-05');
    const splits = await db.query('SELECT category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY category_id', [id]);
    expect(splits).toEqual([
      ['cat_groceries', 3780, null],
      ['cat_shopping', 1620, null],
    ]);
    const items = await db.query('SELECT name, amount_minor, discount_minor, allocated_minor, category_id, line_index FROM receipt_item WHERE transaction_id = ? ORDER BY line_index', [id]);
    expect(items).toEqual([
      ['Rice', 4200, 0, 3780, 'cat_groceries', 0],
      ['Soap', 1800, 0, 1620, 'cat_shopping', 1],
    ]);
    expect((await db.query('SELECT id, digest FROM attachment WHERE transaction_id = ?', [id]))[0]).toEqual(['att-1', DIGEST]);
    expect((await db.query("SELECT source_kind FROM source_record WHERE transaction_id = ?", [id]))[0]).toEqual(['receipt']);
    const events = (await db.query('SELECT event FROM outbox')).map((e) => String(e[0]));
    expect(events).toContain('TransactionsChanged');
    expect((await db.query("SELECT COUNT(*) FROM audit_event WHERE entity_id = ?", [id]))[0]![0]).toBeGreaterThan(0);
    // The account was charged the total.
    const bal = (await db.query("SELECT SUM(signed_amount_minor) FROM posting WHERE account_id = ?", [accountId]))[0]![0];
    expect(bal).toBe(5_000_000 - 5400);
  });

  it('writes one ReceiptItemCategorised event for each item the person gave a category, with the normalized name and no amount', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId, { itemCategories: [null, 'cat_shopping'] }), 'user');
    const id = r.ok ? r.value.transactionId : '';
    const rows = await db.query("SELECT payload_json FROM outbox WHERE event = 'ReceiptItemCategorised'");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(String(rows[0]![0]))).toEqual({ transactionId: id, itemKey: 'soap', categoryId: 'cat_shopping', actor: 'user' });
    // A name keeps its size and quantity words, and a blank one emits nothing.
    const two = await writer.run(SaveReceipt, base(accountId, { submissionId: 'r2', draft: draft({ items: [item('  Rice   5KG ', 4200), item('   ', 1800, 0, 1)], discounts: [600] }), itemCategories: ['cat_food', 'cat_food'] }), 'user');
    expect(two.ok).toBe(true);
    const keys = (await db.query("SELECT payload_json FROM outbox WHERE event = 'ReceiptItemCategorised'")).map((x) => JSON.parse(String(x[0])).itemKey);
    expect(keys).toEqual(['soap', 'rice 5kg']);
    expect(String(rows[0]![0])).not.toMatch(/1800|1620/);
  });

  it('spending by category uses the split amounts (Groceries 37.80 of a 54.00 receipt), and the saved lines read back in printed order', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId), 'user');
    const id = r.ok ? r.value.transactionId : '';
    const spent = await db.query("SELECT s.category_id, SUM(s.amount_minor) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id WHERE t.event_type = 'expense' AND t.status = 'confirmed' AND t.removed_at IS NULL GROUP BY s.category_id ORDER BY s.category_id");
    expect(spent).toEqual([
      ['cat_groceries', 3780],
      ['cat_shopping', 1620],
    ]);
    const lines = mapReceiptItems(await db.query(RECEIPT_ITEMS_SQL, [id]));
    expect(lines.map((l) => [l.name, l.allocatedMinor, l.categoryName])).toEqual([
      ['Rice', 3780, 'Groceries'],
      ['Soap', 1620, 'Shopping'],
    ]);
  });

  it('keeps what was not itemised as an Uncategorised split flagged not itemised', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId, { draft: draft({ items: [item('Rice', 4200)], total: 5000 }), itemCategories: ['cat_groceries'] }), 'user');
    const id = r.ok ? r.value.transactionId : '';
    const splits = await db.query('SELECT category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY amount_minor DESC', [id]);
    expect(splits).toEqual([
      ['cat_groceries', 4200, null],
      [UNCATEGORISED_ID, 800, NOT_ITEMISED_MEMO],
    ]);
  });

  it('with no items, saves the whole total as one split in the main category', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId, { draft: draft({ items: [], total: 2500 }), itemCategories: [] }), 'user');
    const id = r.ok ? r.value.transactionId : '';
    expect(await db.query('SELECT category_id, amount_minor FROM split WHERE transaction_id = ?', [id])).toEqual([['cat_groceries', 2500]]);
    expect((await db.query('SELECT COUNT(*) FROM receipt_item WHERE transaction_id = ?', [id]))[0]![0]).toBe(0);
  });

  it('refuses a missing total, a missing date, a receipt that does not add up and another currency, writing nothing', async () => {
    const { db, writer, accountId } = await setup();
    expect(await writer.run(SaveReceipt, base(accountId, { draft: draft({ total: null }) }), 'user')).toMatchObject({ ok: false, code: 'TOTAL_REQUIRED' });
    expect(await writer.run(SaveReceipt, base(accountId, { draft: draft({ date: null }) }), 'user')).toMatchObject({ ok: false, code: 'DATE_REQUIRED' });
    expect(await writer.run(SaveReceipt, base(accountId, { draft: draft({ items: [item('A', 9000)], total: 5400 }), itemCategories: ['cat_food'] }), 'user')).toMatchObject({ ok: false, code: 'RECEIPT_MISMATCH' });
    expect(await writer.run(SaveReceipt, base(accountId, { draft: draft({ currency: 'USD' }) }), 'user')).toMatchObject({ ok: false, code: 'CURRENCY_DIFFERS' });
    expect((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]).toBe(OPENING_TXS);
    expect((await db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(0);
  });

  it('is atomic: a bad photo digest rolls the entry, splits and items back', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId, { attachment: { attachmentId: 'att-x', digest: 'nope', sizeBytes: 10 } }), 'user');
    expect(r).toMatchObject({ ok: false, code: 'DIGEST_INVALID' });
    expect((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]).toBe(OPENING_TXS);
    expect((await db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(0);
    expect((await db.query('SELECT COUNT(*) FROM split'))[0]![0]).toBe(0);
  });

  it('a retry of the same save writes nothing more', async () => {
    const { db, writer, accountId } = await setup();
    const input = base(accountId);
    await writer.run(SaveReceipt, input, 'user');
    const again = await writer.run(SaveReceipt, input, 'user');
    expect(again).toMatchObject({ ok: true, value: { result: 'ALREADY_SUBMITTED' } });
    expect((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]).toBe(OPENING_TXS + 1);
    expect((await db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(2);
  });

  it('uses the printed time, 12:00 when none is printed, and the current moment when the date is today', async () => {
    const { db, writer, accountId } = await setup();
    const at = async (sub: string, d: Partial<Parameters<typeof draft>[0]>) => {
      const r = await writer.run(SaveReceipt, base(accountId, { submissionId: sub, draft: draft({ discounts: [600], ...d }) }), 'user');
      return Number((await db.query('SELECT occurred_at_utc FROM "transaction" WHERE id = ?', [r.ok ? r.value.transactionId : '']))[0]![0]);
    };
    expect(await at('t1', { date: '2026-11-05', time: '18:45' })).toBe(Date.UTC(2026, 10, 5, 13, 15));
    expect(await at('t2', { date: '2026-11-04' })).toBe(Date.UTC(2026, 10, 4, 6, 30));
    expect(Math.abs((await at('t3', { date: '2026-11-08', time: '09:00' })) - NOW)).toBeLessThan(5000);
  });

  it('holds a receipt that looks like an entry already recorded for review, never counting it', async () => {
    const { db, writer, accountId } = await setup();
    const first = await writer.run(SubmitCapture, { submissionId: 'manual-1', sourceKind: 'manual', entry: { kind: 'expense', amountMinor: 5400, categoryId: 'cat_groceries', accountId, merchant: 'Sagar Fresh Mart', occurredAtMs: Date.UTC(2026, 10, 5, 6, 30) } }, 'user');
    expect(first.ok).toBe(true);
    const r = await writer.run(SaveReceipt, base(accountId), 'user');
    expect(r).toMatchObject({ ok: true, value: { result: 'POSSIBLE_DUPLICATE' } });
    const id = r.ok ? r.value.transactionId : '';
    expect((await db.query('SELECT status FROM "transaction" WHERE id = ?', [id]))[0]).toEqual(['needs_review']);
    expect((await db.query("SELECT reason, status FROM review_candidate WHERE transaction_id = ?", [id]))[0]).toEqual(['duplicate', 'open']);
  });

  it('saved with no category it stays under Add a category', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId, { mainCategoryId: UNCATEGORISED_ID, itemCategories: [null, null] }), 'user');
    const id = r.ok ? r.value.transactionId : '';
    expect((await db.query('SELECT category_set_by FROM "transaction" WHERE id = ?', [id]))[0]).toEqual([null]);
  });

  it('creates a Cash account with its balance not set in the same save when asked, and only then', async () => {
    const { db, writer } = await setup();
    expect(await writer.run(SaveReceipt, base('', { accountId: null }), 'user')).toMatchObject({ ok: false, code: 'ACCOUNT_REQUIRED' });
    const r = await writer.run(SaveReceipt, base('', { accountId: null, createCash: true }), 'user');
    expect(r.ok).toBe(true);
    const cash = (await db.query("SELECT id, type FROM account WHERE name = 'Cash'"))[0]!;
    expect(cash[1]).toBe('cash');
    expect((await db.query('SELECT account_id FROM posting WHERE transaction_id = ?', [r.ok ? r.value.transactionId : '']))[0]).toEqual([cash[0]]);
  });

  it('a category only a receipt line still names cannot be deleted, and merging a category moves its receipt lines', async () => {
    const { db, writer, accountId } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId), 'user');
    const id = r.ok ? r.value.transactionId : '';
    // The split moves to Food, but the line keeps Shopping.
    await db.query("UPDATE split SET category_id = 'cat_food' WHERE transaction_id = ? AND category_id = 'cat_shopping'", [id]);
    expect(await writer.run(DeleteCategory, { categoryId: 'cat_shopping' }, 'user')).toMatchObject({ ok: false, code: 'IN_USE' });
    const merged = await writer.run(MergeCategory, { fromId: 'cat_shopping', intoId: 'cat_food' }, 'user');
    expect(merged.ok).toBe(true);
    expect((await db.query("SELECT category_id FROM receipt_item WHERE name = 'Soap'"))[0]).toEqual(['cat_food']);
  });

  it('refuses a day that does not exist, ignores a malformed printed time, and checks one category per item', async () => {
    const { db, writer, accountId } = await setup();
    expect(await writer.run(SaveReceipt, base(accountId, { draft: draft({ date: '2026-02-31', discounts: [600] }) }), 'user')).toMatchObject({ ok: false, code: 'DATE_INVALID' });
    expect(await writer.run(SaveReceipt, base(accountId, { itemCategories: ['cat_food'] }), 'user')).toMatchObject({ ok: false, code: 'SUBMISSION_INVALID' });
    const r = await writer.run(SaveReceipt, base(accountId, { draft: draft({ discounts: [600], time: '25:99' }) }), 'user');
    expect(r.ok).toBe(true);
    expect(Number((await db.query('SELECT occurred_at_utc FROM "transaction" WHERE id = ?', [r.ok ? r.value.transactionId : '']))[0]![0])).toBe(Date.UTC(2026, 10, 5, 6, 30));
  });

  it('a retry with no account does not create a second Cash account', async () => {
    const { db, writer } = await setup();
    const input = base('', { accountId: null, createCash: true });
    await writer.run(SaveReceipt, input, 'user');
    await writer.run(SaveReceipt, input, 'user');
    expect((await db.query("SELECT COUNT(*) FROM account WHERE name = 'Cash'"))[0]![0]).toBe(1);
  });

  it('removing the entry and purging it deletes its receipt items', async () => {
    const { db, writer, accountId, clock } = await setup();
    const r = await writer.run(SaveReceipt, base(accountId), 'user');
    const id = r.ok ? r.value.transactionId : '';
    clock.advance(1000);
    expect((await writer.run(RemoveEntry, { transactionId: id }, 'user')).ok).toBe(true);
    expect((await writer.run(PurgeEntry, { transactionId: id }, 'system')).ok).toBe(true);
    expect((await db.query('SELECT COUNT(*) FROM "transaction" WHERE id = ?', [id]))[0]![0]).toBe(0);
    expect((await db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(0);
  });
});
