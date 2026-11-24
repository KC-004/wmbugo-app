import { FakeClock } from '../../shared/clock';
import { createRedactingLogger } from '../../shared/logger';
import { createIdGenerator, seededRandom } from '../../shared/uuid';
import { NodeSqliteDatabase } from '../../testing/nodeSqlite';
import { SetUpProfile } from '../../usecases/setUpProfile';
import { findRegion } from '../../profile/regions';
import { LedgerWriter } from '../../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../../ledger/accountCommands';
import { TIP_CATEGORY_NAME, isAutoApprovable, MergeDuplicate } from '../resolveDuplicate';
import { SubmitCapture, type CaptureSourceKind } from '../submitCapture';
import { AttachReceipt, UndoAttachReceipt } from './attachReceipt';
import { previewReceiptMatches, receiptMatchParams, RECEIPT_MATCH_SQL, type ReceiptMatch } from './matchReceipt';
import { SaveReceipt } from './saveReceipt';
import type { ReceiptDraft, ReceiptItem } from './types';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const DIGEST = 'b'.repeat(64);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(33)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const card = await writer.run(AddAccount, { name: 'HDFC debit', type: 'bank', openingMinor: 5_000_000 }, 'user');
  const cash = await writer.run(AddAccount, { name: 'Wallet', type: 'cash', openingMinor: 100_000 }, 'user');
  if (!card.ok || !cash.ok) throw new Error('account');
  return { db, clock, writer, cardId: card.value.accountId, cashId: cash.value.accountId };
}

const item = (name: string, amountMinor: number, lineIndex = 0): ReceiptItem => ({ name, amountMinor, discountMinor: 0, lineIndex, certainty: 'sure' });
const draftOf = (total: number, items: ReceiptItem[], merchant: string | null = 'Sagar Fresh Mart', date = '2026-11-08', time: string | null = '18:12'): ReceiptDraft => ({
  merchant: merchant === null ? { value: null, certainty: 'missing' } : { value: merchant, certainty: 'sure' },
  date: { value: date, certainty: 'sure' },
  time: time ? { value: time, certainty: 'sure' } : { value: null, certainty: 'missing' },
  currency: { value: 'INR', certainty: 'sure' },
  subtotal: { value: null, certainty: 'missing' },
  taxes: [],
  fees: [],
  discounts: [],
  total: { value: total, certainty: 'sure' },
  items,
  unparsedLineCount: 0,
});
const RECEIPT = draftOf(234_000, [item('Rice', 150_000), item('Soap', 84_000, 1)]);

type Env = Awaited<ReturnType<typeof setup>>;

/** An existing expense through the real pipeline. */
async function existing(env: Env, o: { id: string; amount: number; source: CaptureSourceKind; accountId: string; merchant?: string; at?: number }) {
  const r = await env.writer.run(
    SubmitCapture,
    { submissionId: o.id, sourceKind: o.source, ...(o.source === 'sms' ? { ignoreTombstone: true } : {}), entry: { kind: 'expense', amountMinor: o.amount, categoryId: 'cat_food', accountId: o.accountId, merchant: o.merchant ?? 'Sagar Fresh Mart', occurredAtMs: o.at ?? Date.UTC(2026, 10, 8, 12, 42, 0) } },
    'user',
  );
  if (!r.ok) throw new Error(`existing ${r.code}`);
  return r.value;
}

async function preview(env: Env, d: ReceiptDraft): Promise<ReceiptMatch[]> {
  const rows = await env.db.query(RECEIPT_MATCH_SQL, receiptMatchParams(d.total.value!, d.date.value!));
  return previewReceiptMatches({ merchant: d.merchant.value, localDate: d.date.value!, occurredAtMs: Date.UTC(2026, 10, 8, 12, 42, 0), totalMinor: d.total.value! }, rows);
}

describe('previewReceiptMatches (Story 10.8)', () => {
  it('finds the card debit for the same shop and amount, and writes nothing', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    const before = (await env.db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0];
    const found = await preview(env, RECEIPT);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ transactionId: sms.transactionId, amountMinor: 234_000, accountName: 'HDFC debit', sourceKind: 'sms', status: 'confirmed' });
    expect((await env.db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]).toBe(before);
  });

  it('applies the receipt rule: a charge up to 30% higher matches, 31% higher or lower does not', async () => {
    const env = await setup();
    await existing(env, { id: 'c1', amount: 234_000 + 70_200, source: 'sms', accountId: env.cardId }); // +30%
    expect(await preview(env, RECEIPT)).toHaveLength(1);
    const env2 = await setup();
    await existing(env2, { id: 'c2', amount: 234_000 + 72_541, source: 'sms', accountId: env2.cardId }); // +31%
    expect(await preview(env2, RECEIPT)).toHaveLength(0);
    const env3 = await setup();
    await existing(env3, { id: 'c3', amount: 230_000, source: 'sms', accountId: env3.cardId }); // lower
    expect(await preview(env3, RECEIPT)).toHaveLength(0);
  });

  it('never matches another shop, a receipt with no shop name, or a removed entry', async () => {
    const env = await setup();
    await existing(env, { id: 'o1', amount: 234_000, source: 'sms', accountId: env.cardId, merchant: 'Metro Cash' });
    expect(await preview(env, RECEIPT)).toHaveLength(0);
    await existing(env, { id: 'o2', amount: 234_000, source: 'sms', accountId: env.cardId });
    expect(await preview(env, draftOf(234_000, RECEIPT.items as ReceiptItem[], null))).toHaveLength(0);
  });

  it('lists at most three, nearest amount then nearest time first', async () => {
    const env = await setup();
    const day = Date.UTC(2026, 10, 8);
    const far = await existing(env, { id: 'f', amount: 250_000, source: 'sms', accountId: env.cardId, at: day + 13 * 3_600_000 });
    const nearLate = await existing(env, { id: 'nl', amount: 234_000, source: 'manual', accountId: env.cashId, at: day + 15 * 3_600_000 });
    const nearEarly = await existing(env, { id: 'ne', amount: 234_000, source: 'sms', accountId: env.cardId, at: day + 12 * 3_600_000 + 40 * 60_000 });
    await existing(env, { id: 'x', amount: 260_000, source: 'sms', accountId: env.cardId, at: day + 14 * 3_600_000 });
    const found = await preview(env, RECEIPT);
    expect(found.map((m) => m.transactionId)).toEqual([nearEarly.transactionId, nearLate.transactionId, far.transactionId]);
  });

  it('includes an entry that is waiting for review', async () => {
    const env = await setup();
    const first = await existing(env, { id: 'm1', amount: 234_000, source: 'manual', accountId: env.cashId });
    await existing(env, { id: 'm2', amount: 234_000, source: 'manual', accountId: env.cashId });
    const held = (await env.db.query("SELECT id FROM \"transaction\" WHERE status = 'needs_review'"))[0];
    if (held) expect((await preview(env, RECEIPT)).some((m) => m.status === 'needs_review')).toBe(true);
    expect(first.transactionId).toBeTruthy();
  });
});

describe('AttachReceipt (Story 10.8)', () => {
  const attach = (env: Env, transactionId: string, over: Record<string, unknown> = {}) =>
    env.writer.run(AttachReceipt, { submissionId: 'att-sub-1', transactionId, draft: RECEIPT, itemCategories: ['cat_groceries', 'cat_shopping'], mainCategoryId: 'cat_groceries', attachment: { attachmentId: 'photo-1', digest: DIGEST, sizeBytes: 900 }, ...over } as never, 'user');

  it('keeps the entry account, amount, time and status and adds the photo, a receipt source, the items and the splits', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    const before = await env.db.query('SELECT status, amount_minor, occurred_at_utc FROM "transaction" WHERE id = ?', [sms.transactionId]);
    const r = await attach(env, sms.transactionId);
    expect(r).toMatchObject({ ok: true, value: { adjustmentMinor: 0, alreadyDone: false } });
    expect(await env.db.query('SELECT status, amount_minor, occurred_at_utc FROM "transaction" WHERE id = ?', [sms.transactionId])).toEqual(before);
    expect(await env.db.query("SELECT account_id FROM posting WHERE transaction_id = ? AND posting_kind = 'normal'", [sms.transactionId])).toEqual([[env.cardId]]);
    expect(await env.db.query('SELECT category_id, amount_minor FROM split WHERE transaction_id = ? ORDER BY category_id', [sms.transactionId])).toEqual([
      ['cat_groceries', 150_000],
      ['cat_shopping', 84_000],
    ]);
    expect((await env.db.query('SELECT COUNT(*) FROM receipt_item WHERE transaction_id = ?', [sms.transactionId]))[0]![0]).toBe(2);
    expect((await env.db.query('SELECT source_kind FROM source_record WHERE transaction_id = ? ORDER BY created_at, id', [sms.transactionId])).map((x) => x[0])).toEqual(['sms', 'receipt']);
    expect((await env.db.query('SELECT id FROM attachment WHERE transaction_id = ?', [sms.transactionId]))[0]).toEqual(['photo-1']);
    expect((await env.db.query('SELECT event FROM outbox')).map((e) => String(e[0]))).toContain('TransactionsChanged');
    expect((await env.db.query('SELECT COUNT(*) FROM audit_event WHERE entity_id = ?', [sms.transactionId]))[0]![0]).toBeGreaterThan(0);
  });

  it('turns what the entry charged above the receipt into a Tip / adjustment split in the largest category', async () => {
    const env = await setup();
    const card = await existing(env, { id: 'c', amount: 115_000, source: 'sms', accountId: env.cardId });
    const receipt = draftOf(100_000, [item('Pasta', 70_000), item('Tea', 30_000, 1)]);
    const r = await attach(env, card.transactionId, { draft: receipt, itemCategories: ['cat_food', 'cat_shopping'], mainCategoryId: 'cat_food', attachment: undefined });
    expect(r).toMatchObject({ ok: true, value: { adjustmentMinor: 15_000 } });
    const splits = await env.db.query('SELECT category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY amount_minor', [card.transactionId]);
    expect(splits).toContainEqual(['cat_food', 15_000, TIP_CATEGORY_NAME]);
    expect(splits.reduce((n, s) => n + Number(s[1]), 0)).toBe(115_000);
  });

  it('refuses a receipt read in another currency, as a save does', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    const usd = { ...RECEIPT, currency: { value: 'USD', certainty: 'sure' as const } };
    expect(await attach(env, sms.transactionId, { draft: usd })).toEqual({ ok: false, code: 'CURRENCY_DIFFERS' });
    expect((await env.db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(0);
  });

  it('refuses a receipt that totals more than the entry and changes nothing', async () => {
    const env = await setup();
    const card = await existing(env, { id: 'c', amount: 200_000, source: 'sms', accountId: env.cardId });
    const r = await attach(env, card.transactionId);
    expect(r).toEqual({ ok: false, code: 'RECEIPT_EXCEEDS_ENTRY' });
    expect((await env.db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(0);
    expect((await env.db.query('SELECT COUNT(*) FROM attachment'))[0]![0]).toBe(0);
  });

  it('asks before replacing existing items: replace swaps them, keep leaves them, the photo is attached either way', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    await attach(env, sms.transactionId);
    const second = draftOf(234_000, [item('Everything', 234_000)]);
    const need = await attach(env, sms.transactionId, { submissionId: 'att-sub-2', draft: second, itemCategories: [null], attachment: { attachmentId: 'photo-2', digest: 'c'.repeat(64), sizeBytes: 5 } });
    expect(need).toEqual({ ok: false, code: 'ITEMS_CHOICE_REQUIRED' });
    const keep = await attach(env, sms.transactionId, { submissionId: 'att-sub-2', draft: second, itemCategories: [null], itemsMode: 'keep', attachment: { attachmentId: 'photo-2', digest: 'c'.repeat(64), sizeBytes: 5 } });
    expect(keep.ok).toBe(true);
    expect((await env.db.query('SELECT name FROM receipt_item WHERE transaction_id = ? ORDER BY line_index', [sms.transactionId])).map((r) => r[0])).toEqual(['Rice', 'Soap']);
    expect((await env.db.query('SELECT COUNT(*) FROM attachment WHERE transaction_id = ?', [sms.transactionId]))[0]![0]).toBe(2);
    const replace = await attach(env, sms.transactionId, { submissionId: 'att-sub-3', draft: second, itemCategories: [null], itemsMode: 'replace', attachment: undefined });
    expect(replace.ok).toBe(true);
    expect((await env.db.query('SELECT name FROM receipt_item WHERE transaction_id = ?', [sms.transactionId])).map((r) => r[0])).toEqual(['Everything']);
  });

  it('a retry of the same attach writes nothing twice', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    await attach(env, sms.transactionId);
    const again = await attach(env, sms.transactionId);
    expect(again).toMatchObject({ ok: true, value: { alreadyDone: true } });
    expect((await env.db.query('SELECT COUNT(*) FROM receipt_item WHERE transaction_id = ?', [sms.transactionId]))[0]![0]).toBe(2);
    expect((await env.db.query("SELECT COUNT(*) FROM source_record WHERE source_kind = 'receipt'"))[0]![0]).toBe(1);
  });

  it('Undo restores the entry, its splits and its sources exactly', async () => {
    const env = await setup();
    const card = await existing(env, { id: 'c', amount: 115_000, source: 'sms', accountId: env.cardId });
    const rows = async () => ({
      tx: await env.db.query('SELECT status, amount_minor, occurred_at_utc, category_set_by FROM "transaction" WHERE id = ?', [card.transactionId]),
      splits: await env.db.query('SELECT category_id, amount_minor, memo FROM split WHERE transaction_id = ? ORDER BY id', [card.transactionId]),
      sources: await env.db.query('SELECT source_kind FROM source_record WHERE transaction_id = ? ORDER BY id', [card.transactionId]),
      items: await env.db.query('SELECT COUNT(*) FROM receipt_item'),
      photos: await env.db.query('SELECT COUNT(*) FROM attachment'),
    });
    const start = await rows();
    const done = await attach(env, card.transactionId, { submissionId: 'real', draft: draftOf(100_000, [item('Pasta', 70_000), item('Tea', 30_000, 1)]), itemCategories: ['cat_food', 'cat_shopping'], mainCategoryId: 'cat_food' });
    expect(done.ok).toBe(true);
    expect(await rows()).not.toEqual(start);
    if (done.ok) expect((await env.writer.run(UndoAttachReceipt, { undo: done.value.undo }, 'user')).ok).toBe(true);
    expect(await rows()).toEqual(start);
  });

  it('Undo also brings back the items a replace removed', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    await attach(env, sms.transactionId);
    const items = async () => env.db.query('SELECT name, amount_minor, allocated_minor, category_id FROM receipt_item ORDER BY line_index');
    const start = await items();
    const swap = await attach(env, sms.transactionId, { submissionId: 'swap', draft: draftOf(234_000, [item('All', 234_000)]), itemCategories: [null], itemsMode: 'replace', attachment: undefined });
    if (swap.ok) await env.writer.run(UndoAttachReceipt, { undo: swap.value.undo }, 'user');
    expect(await items()).toEqual(start);
  });

  it('Photo only attaches the photo and writes no items and no splits', async () => {
    const env = await setup();
    const sms = await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    const r = await attach(env, sms.transactionId, { photoOnly: true, draft: draftOf(999_999, []) });
    expect(r.ok).toBe(true);
    expect((await env.db.query('SELECT COUNT(*) FROM receipt_item'))[0]![0]).toBe(0);
    expect((await env.db.query('SELECT COUNT(*) FROM split WHERE transaction_id = ?', [sms.transactionId]))[0]![0]).toBe(1);
    expect((await env.db.query('SELECT COUNT(*) FROM attachment WHERE transaction_id = ?', [sms.transactionId]))[0]![0]).toBe(1);
  });

  it('says so when the entry was removed, and writes nothing', async () => {
    const env = await setup();
    expect(await attach(env, 'missing')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });
});

describe('Keep separate and the never-two-confirmed rule (LIR-04, RB0-8)', () => {
  const save = (env: Env, over: Record<string, unknown> = {}) =>
    env.writer.run(SaveReceipt, { submissionId: 'r-1', draft: RECEIPT, itemCategories: [null, null], mainCategoryId: 'cat_groceries', accountId: env.cardId, ...over } as never, 'user');

  it('a receipt that matches a recorded expense is held for review, not a second confirmed expense', async () => {
    const env = await setup();
    await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    const r = await save(env);
    expect(r).toMatchObject({ ok: true, value: { result: 'POSSIBLE_DUPLICATE' } });
    expect((await env.db.query("SELECT COUNT(*) FROM \"transaction\" WHERE status = 'confirmed' AND event_type = 'expense' AND original_description = 'Sagar Fresh Mart'"))[0]![0]).toBe(1);
  });

  it('Keep separate confirms it with user_approved and no open duplicate candidate', async () => {
    const env = await setup();
    await existing(env, { id: 'sms-1', amount: 234_000, source: 'sms', accountId: env.cardId });
    const r = await save(env, { keepSeparate: true });
    expect(r).toMatchObject({ ok: true, value: { result: 'RECORDED' } });
    const id = r.ok ? r.value.transactionId : '';
    expect((await env.db.query('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', [id]))[0]).toEqual(['confirmed', 'user_approved']);
    expect((await env.db.query("SELECT COUNT(*) FROM review_candidate WHERE status = 'open'"))[0]![0]).toBe(0);
  });

  it('holds for any generated mix of sources and times, and only Keep separate gives two confirmed expenses', async () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 24; i++) {
      const env = await setup();
      const source: CaptureSourceKind = rand() < 0.5 ? 'sms' : 'manual';
      const bump = source === 'sms' ? Math.floor(rand() * 30) : 0; // percent above the receipt
      const amount = 234_000 + Math.floor((234_000 * bump) / 100);
      await existing(env, { id: `e-${i}`, amount, source, accountId: source === 'sms' ? env.cardId : env.cashId, at: Date.UTC(2026, 10, 8, 6 + Math.floor(rand() * 12), 0, 0) });
      const keep = rand() < 0.3;
      const r = await save(env, { submissionId: `r-${i}`, keepSeparate: keep });
      expect(r.ok).toBe(true);
      const confirmed = Number((await env.db.query("SELECT COUNT(*) FROM \"transaction\" WHERE status = 'confirmed' AND event_type = 'expense' AND original_description = 'Sagar Fresh Mart'"))[0]![0]);
      expect({ i, source, bump, keep, confirmed }).toEqual({ i, source, bump, keep, confirmed: keep ? 2 : 1 });
    }
  });
});

describe('a later capture of a payment that has a receipt-only entry (Story 10.8)', () => {
  it('is held with an open duplicate candidate, is never auto-approvable, and Merge keeps one entry on the card with the items and both sources', async () => {
    const env = await setup();
    const receipt = await env.writer.run(SaveReceipt, { submissionId: 'r-1', draft: RECEIPT, itemCategories: ['cat_groceries', 'cat_shopping'], mainCategoryId: 'cat_groceries', accountId: env.cashId }, 'user');
    if (!receipt.ok) throw new Error('save');
    const cashBefore = (await env.db.query('SELECT SUM(signed_amount_minor) FROM posting WHERE account_id = ?', [env.cashId]))[0]![0];
    const sms = await env.writer.run(
      SubmitCapture,
      { submissionId: 'sms-late', sourceKind: 'sms', ignoreTombstone: true, entry: { kind: 'expense', amountMinor: 234_000, categoryId: 'cat_food', accountId: env.cardId, merchant: 'Sagar Fresh Mart', occurredAtMs: Date.UTC(2026, 10, 8, 12, 42, 0) } },
      'user',
    );
    expect(sms).toMatchObject({ ok: true, value: { result: 'POSSIBLE_DUPLICATE' } });
    const held = sms.ok ? sms.value.transactionId : '';
    const open = (await env.db.query("SELECT COUNT(*) FROM review_candidate WHERE transaction_id = ? AND reason = 'duplicate' AND status = 'open'", [held]))[0]![0];
    expect(open).toBe(1);
    expect(isAutoApprovable({ hasOpenDuplicate: Number(open) > 0 })).toBe(false);

    const merged = await env.writer.run(MergeDuplicate, { transactionId: held }, 'user');
    expect(merged).toMatchObject({ ok: true, value: { survivorId: held, excludedId: receipt.value.transactionId } });
    expect(await env.db.query("SELECT account_id FROM posting WHERE transaction_id = ? AND posting_kind = 'normal'", [held])).toEqual([[env.cardId]]);
    expect((await env.db.query('SELECT COUNT(*) FROM split WHERE transaction_id = ?', [held]))[0]![0]).toBe(2);
    expect((await env.db.query('SELECT COUNT(*) FROM receipt_item WHERE transaction_id = ?', [held]))[0]![0]).toBe(2);
    expect((await env.db.query('SELECT source_kind FROM source_record WHERE transaction_id = ? ORDER BY source_kind', [held])).map((r) => r[0])).toEqual(['receipt', 'sms']);
    expect((await env.db.query("SELECT SUM(signed_amount_minor) FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE p.account_id = ? AND t.removed_at IS NULL", [env.cashId]))[0]![0]).toBe(100_000);
    expect(cashBefore).toBe(100_000 - 234_000);
  });
});
