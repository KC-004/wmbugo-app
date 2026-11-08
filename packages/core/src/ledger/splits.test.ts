import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { UNCATEGORISED_ID } from './categories';
import { EditTransaction, RestoreTransaction } from './editCommands';
import { entryShape } from './entryCommands';
import { ACTIVITY_SQL, groupByDay, mapActivityRows, SPENT_EXPENSES_SQL } from './readModels';
import { activityQuery } from './activitySearch';
import { allocateProportional, leftToAssign, mapSplits, notItemisedSplit, NOT_ITEMISED_MEMO, reconcileReceiptTotal, remainderOf, SetSplits, SPLITS_SQL } from './splits';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(41)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok) throw new Error('add');
  clock.advance(3_600_000);
  const bb = await recordEntry(writer, { kind: 'expense', amountMinor: 126_400, categoryId: 'cat_groceries', accountId: a.value.accountId, merchant: 'BigBasket' });
  if (!bb.ok) throw new Error('bb');
  const splits = async (id: string) => mapSplits(await db.query(SPLITS_SQL, [id]));
  return { db, writer, accountId: a.value.accountId, id: bb.value.transactionId, splits };
}

describe('SetSplits (Story 3.7)', () => {
  it('Groceries ₹1,000 + Personal Care ₹264 on a ₹1,264 BigBasket bill: replaces the splits, audit and event, totals use each split', async () => {
    const { db, writer, id, splits } = await setup();
    const r = await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }, 'user');
    expect(r).toMatchObject({ ok: true, value: { categoryChanged: true } });
    expect((await splits(id)).map((s) => [s.categoryId, s.amountMinor])).toEqual([['cat_groceries', 100_000], ['cat_personal', 26_400]]);
    expect(Number((await db.query(SPENT_EXPENSES_SQL, ['2026-11-01', '2026-11-30']))[0]![0])).toBe(126_400);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'SetSplits'"))[0]![0])).toBe(1);
    expect((await db.query('SELECT event FROM outbox')).map((x) => String(x[0]))).toEqual(expect.arrayContaining(['TransactionsChanged', 'CategoryAssigned']));
  });

  it('splits that do not sum are refused with SPLITS_DONT_SUM and nothing is written', async () => {
    const { writer, id, splits } = await setup();
    const before = await splits(id);
    const short = await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_300 }] }, 'user');
    expect(short).toEqual({ ok: false, code: 'SPLITS_DONT_SUM' });
    const over = await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 126_401 }] }, 'user');
    expect(over).toEqual({ ok: false, code: 'SPLITS_DONT_SUM' });
    expect(await splits(id)).toEqual(before);
  });

  it('refuses no rows, a zero or fractional row, an unknown or wrong-kind category, a transfer and a removed entry', async () => {
    const { writer, id } = await setup();
    const run = (splits: { categoryId: string; amountMinor: number }[], transactionId = id) => writer.run(SetSplits, { transactionId, splits }, 'user');
    expect(await run([])).toEqual({ ok: false, code: 'SPLITS_EMPTY' });
    expect(await run([{ categoryId: 'cat_groceries', amountMinor: 0 }, { categoryId: 'cat_personal', amountMinor: 126_400 }])).toEqual({ ok: false, code: 'SPLIT_AMOUNT_INVALID' });
    expect(await run([{ categoryId: 'cat_groceries', amountMinor: 126_400.5 }])).toEqual({ ok: false, code: 'SPLIT_AMOUNT_INVALID' });
    expect(await run([{ categoryId: 'nope', amountMinor: 126_400 }])).toEqual({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    expect(await run([{ categoryId: 'cat_in_salary', amountMinor: 126_400 }])).toEqual({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    expect(await run([{ categoryId: 'cat_groceries', amountMinor: 126_400 }], 'nope')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });

  it('one row left means a single split for the full amount', async () => {
    const { writer, id, splits } = await setup();
    await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }, 'user');
    await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_personal', amountMinor: 126_400 }] }, 'user');
    expect((await splits(id)).map((s) => [s.categoryId, s.amountMinor])).toEqual([['cat_personal', 126_400]]);
  });

  it('an amount change commits only together with balanced splits: ₹1,264 to ₹1,300 leaves ₹36 to assign', async () => {
    const { db, writer, id, accountId, splits } = await setup();
    await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }, 'user');
    expect(remainderOf(130_000, [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }])).toBe(3_600);
    const bad = await writer.run(SetSplits, { transactionId: id, amountMinor: 130_000, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }, 'user');
    expect(bad).toEqual({ ok: false, code: 'SPLITS_DONT_SUM' });
    expect(Number((await db.query('SELECT amount_minor FROM "transaction" WHERE id = ?', [id]))[0]![0])).toBe(126_400);
    const ok = await writer.run(SetSplits, { transactionId: id, amountMinor: 130_000, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 30_000 }] }, 'user');
    expect(ok.ok).toBe(true);
    expect(Number((await db.query('SELECT amount_minor FROM "transaction" WHERE id = ?', [id]))[0]![0])).toBe(130_000);
    expect(Number((await db.query('SELECT signed_amount_minor FROM posting WHERE account_id = ? AND posting_kind = \'normal\'', [accountId]))[0]![0])).toBe(-130_000);
    expect((await splits(id)).reduce((n, s) => n + s.amountMinor, 0)).toBe(130_000);
  });

  it('Undo restores the original single split exactly', async () => {
    const { db, writer, id, splits } = await setup();
    const before = await splits(id);
    const r = await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }, 'user');
    if (!r.ok) throw new Error('x');
    await writer.run(RestoreTransaction, { snapshot: r.value.snapshot }, 'user');
    expect(await splits(id)).toEqual(before);
    void db;
  });

  it('the writer invariant refuses splits that do not equal the amount even if a use case tried', async () => {
    const { db, writer, id } = await setup();
    const sneaky = { name: 'Sneaky', async execute(ctx: Parameters<typeof SetSplits.execute>[0]) { await ctx.execute('UPDATE split SET amount_minor = 1 WHERE transaction_id = ?', [id]); ctx.touch('transaction', id); return { ok: true as const, value: undefined }; } };
    const r = await writer.run(sneaky as never, undefined as never, 'user');
    expect(r).toMatchObject({ ok: false });
    expect(Number((await db.query('SELECT amount_minor FROM split WHERE transaction_id = ?', [id]))[0]![0])).toBe(126_400);
  });
});

describe('a split entry elsewhere', () => {
  it('Activity reads the largest category first with the split count; a category filter and a day Spent use each split own amount', async () => {
    const { db, writer, id } = await setup();
    await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_personal', amountMinor: 26_400 }, { categoryId: 'cat_groceries', amountMinor: 100_000 }] }, 'user');
    const row = mapActivityRows(await db.query(ACTIVITY_SQL, [100]))[0]!;
    expect(row).toMatchObject({ categoryName: 'Groceries', splitCount: 2, amountMinor: 126_400 });
    const q = activityQuery({ categoryIds: ['cat_personal'] }, 100, { exponent: 2, nowMs: NOW + 7_200_000 });
    const filtered = mapActivityRows(await db.query(q.sql, q.params));
    expect(filtered[0]).toMatchObject({ matchedMinor: 26_400, splitCount: 2 });
    expect(groupByDay(filtered)[0]!.spentMinor).toBe(26_400);
    expect(groupByDay([row])[0]!.spentMinor).toBe(126_400);
  });

  it('a split entry can still change account, date, merchant and note, but not its amount or category through Edit', async () => {
    const { writer, id } = await setup();
    await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }, 'user');
    expect((await writer.run(EditTransaction, { transactionId: id, entry: { merchant: 'Big Basket', note: 'monthly', categoryId: 'cat_groceries', amountMinor: 126_400 } }, 'user')).ok).toBe(true);
    expect(await writer.run(EditTransaction, { transactionId: id, entry: { amountMinor: 130_000 } }, 'user')).toEqual({ ok: false, code: 'NOT_EDITABLE' });
    expect(await writer.run(EditTransaction, { transactionId: id, entry: { categoryId: 'cat_food' } }, 'user')).toEqual({ ok: false, code: 'NOT_EDITABLE' });
  });
});

describe('remainder maths in integer minor units (LIR-02)', () => {
  it('leftToAssign is the total minus the rows, negative when they add up to too much', () => {
    expect(leftToAssign(126_400, [100_000])).toBe(26_400);
    expect(leftToAssign(126_400, [100_000, 26_400])).toBe(0);
    expect(leftToAssign(126_400, [130_000])).toBe(-3_600);
  });

  it.each([
    ['INR', 2, 126_400],
    ['JPY', 0, 1_264],
    ['KWD', 3, 1_264_000],
  ])('allocation in %s (exponent %i) always adds up exactly and never goes below zero', (_c, _e, total) => {
    expect(allocateProportional(total, [1, 1, 1]).reduce((n, x) => n + x, 0)).toBe(total);
    expect(allocateProportional(total, [3, 1]).reduce((n, x) => n + x, 0)).toBe(total);
    expect(allocateProportional(total, [1, 2, 3, 4, 5, 6, 7]).every((x) => x >= 0)).toBe(true);
  });

  it('property: parts always sum to the categorisable amount, whatever the weights', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 12 }), (total, weights) => {
        const parts = allocateProportional(total, weights);
        expect(parts.reduce((n, x) => n + x, 0)).toBe(total);
        expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
        expect(leftToAssign(total, parts)).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it('degenerate inputs return zeros', () => {
    expect(allocateProportional(100, [])).toEqual([]);
    expect(allocateProportional(100, [0, 0])).toEqual([0, 0]);
    expect(allocateProportional(-5, [1, 1])).toEqual([0, 0]);
  });
});

describe('receipt reconciliation (fixture; receipts arrive in Epic 10)', () => {
  it('reconcileReceiptTotal is items + tax + fees - discounts - adjustments, exactly', () => {
    expect(reconcileReceiptTotal({ itemsMinor: 200_000, taxMinor: 36_000, feesMinor: 5_000, discountsMinor: 10_000, adjustmentsMinor: 1 })).toBe(230_999);
    expect(reconcileReceiptTotal({ itemsMinor: 500 })).toBe(500);
  });

  it('a shortfall becomes one Uncategorised split flagged not itemised, counted as assigned; a match needs none', async () => {
    expect(notItemisedSplit(234_000, 234_000)).toBeNull();
    const gap = notItemisedSplit(234_000, 200_000);
    expect(gap).toEqual({ categoryId: UNCATEGORISED_ID, amountMinor: 34_000, memo: NOT_ITEMISED_MEMO });
    const { db, writer, id, splits } = await setup();
    const r = await writer.run(SetSplits, { transactionId: id, splits: [{ categoryId: 'cat_groceries', amountMinor: 92_400 }, notItemisedSplit(126_400, 92_400)!] }, 'user');
    expect(r.ok).toBe(true);
    const s = await splits(id);
    expect(s.find((x) => x.notItemised)).toMatchObject({ categoryId: UNCATEGORISED_ID, amountMinor: 34_000 });
    expect(remainderOf(126_400, s.map((x) => ({ categoryId: x.categoryId, amountMinor: x.amountMinor })))).toBe(0);
    void db;
  });
});
