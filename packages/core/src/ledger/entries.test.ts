import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { CATEGORY_LIST_SQL, CATEGORY_USE_SQL, mapCategoryRows, rankCategories, rankIsStale, SEED_CATEGORIES } from './categories';
import { entryShape, instantFromLocal, LAST_ACCOUNT_FOR_CATEGORY_SQL, LAST_ACCOUNT_SQL, pickDefaultAccount, RemoveEntry } from './entryCommands';
import { applyKey, keypadKeyFromHardware } from './keypad';
import { recordEntry } from '../testing/capture';

// 2026-11-08T10:00:00Z, which is 2026-11-08 18:00 in Singapore.
const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(3)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  const p = await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'last_day' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
  if (!p.ok) throw new Error('setup');
  const q = (sql: string, params: (string | number)[] = []) => db.query(sql, params);
  const accounts = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  return { db, clock, writer, q, accounts };
}

describe('seeded categories (migration 5)', () => {
  it('matches the seed list exactly, with colours and need/want types', async () => {
    const { q } = await setup();
    const rows = mapCategoryRows(await q(CATEGORY_LIST_SQL));
    expect(rows.map((r) => [r.id, r.name, r.kind, r.budgetType, r.icon, r.colorToken])).toEqual(
      SEED_CATEGORIES.map((c) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color]),
    );
    expect(rows.filter((r) => r.kind === 'expense').map((r) => r.name)).toEqual([
      'Food & Drinks', 'Groceries', 'Transport', 'Housing', 'Bills & Utilities', 'Shopping', 'Healthcare',
      'Entertainment', 'Education', 'Travel', 'Personal Care', 'Family', 'Other', 'Uncategorised',
    ]);
    expect(rows.filter((r) => r.kind === 'income').map((r) => r.name)).toEqual(['Salary', 'Freelance', 'From people', 'Gifts', 'Interest', 'Refunds']);
    expect(rows.every((r) => r.colorToken.startsWith('cat-'))).toBe(true);
  });
});

describe('RecordManualEntry', () => {
  it('with no account creates Cash (balance not set) and one confirmed expense, one negative posting, one split, audit and event', async () => {
    const { writer, q, accounts } = await setup();
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: 1250, categoryId: 'cat_food', accountId: null });
    expect(r.ok).toBe(true);
    const acc = await accounts();
    expect(acc).toHaveLength(1);
    expect(acc[0]).toMatchObject({ name: 'Cash', type: 'cash', balanceNotSet: true, postingsMinor: -1250 });

    const t = (await q('SELECT event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, removed_at FROM "transaction"'))[0]!;
    expect(t).toEqual(['expense', 'confirmed', 1250, NOW, '2026-11-08', 'Asia/Singapore', null]);
    expect(await q('SELECT direction, signed_amount_minor, posting_kind FROM posting')).toEqual([['out', -1250, 'normal']]);
    expect(await q('SELECT category_id, amount_minor FROM split')).toEqual([['cat_food', 1250]]);
    expect(Number((await q("SELECT COUNT(*) FROM audit_event WHERE entity_kind = 'transaction'"))[0]![0])).toBe(1);
    const events = (await q('SELECT event FROM outbox')).map((x) => x[0]);
    expect(events).toContain('TransactionsChanged');
    expect(events).toContain('AccountsChanged');
  });

  it('income writes one positive posting', async () => {
    const { writer, q } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 100000 }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    const r = await recordEntry(writer, { kind: 'income', amountMinor: 500000, categoryId: 'cat_in_salary', accountId: id });
    expect(r.ok).toBe(true);
    expect(await q("SELECT direction, signed_amount_minor FROM posting WHERE posting_kind = 'normal'")).toEqual([['in', 500000]]);
  });

  it('stores merchant, note, payment method and a chosen date in the capture timezone', async () => {
    const { writer, q } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: null }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    const at = instantFromLocal('2026-11-07', '23:30', 'Asia/Singapore')!;
    await recordEntry(writer, { kind: 'expense', amountMinor: 500, categoryId: 'cat_transport', accountId: id, merchant: ' Grab ', note: 'late', paymentMethod: 'upi', occurredAtMs: at });
    expect((await q('SELECT original_description, note, payment_method, local_date, occurred_at_utc FROM "transaction"'))[0]).toEqual(['Grab', 'late', 'upi', '2026-11-07', at]);
  });

  it('rejects bad input and writes nothing', async () => {
    const { writer, q } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: null }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    const run = (over: object) => recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: id, ...over } as never);
    expect(await run({ amountMinor: 0 })).toEqual({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await run({ amountMinor: 1.5 })).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(await run({ amountMinor: Number.MAX_SAFE_INTEGER + 1 })).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(await run({ categoryId: 'nope' })).toEqual({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    expect(await run({ categoryId: 'cat_in_salary' })).toEqual({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    expect(await run({ accountId: 'missing' })).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await run({ accountId: null })).toEqual({ ok: false, code: 'ACCOUNT_REQUIRED' });
    expect(await run({ paymentMethod: 'cheque' })).toEqual({ ok: false, code: 'PAYMENT_METHOD_INVALID' });
    expect(await run({ occurredAtMs: -5 })).toEqual({ ok: false, code: 'INSTANT_INVALID' });
    expect(Number((await q('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(0);
    expect(Number((await q('SELECT COUNT(*) FROM split'))[0]![0])).toBe(0);
  });

  it('rejects an archived account', async () => {
    const { writer, q } = await setup();
    await writer.run(AddAccount, { name: 'Old', type: 'bank', openingMinor: null }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    await q("UPDATE account SET status = 'archived'");
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: id });
    expect(r).toEqual({ ok: false, code: 'ACCOUNT_ARCHIVED' });
  });
});

describe('RemoveEntry (Undo)', () => {
  it('marks the entry deleted, drops it from balances, audits it, and cannot be repeated', async () => {
    const { writer, q, accounts } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 100000 }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: 2500, categoryId: 'cat_food', accountId: id });
    if (!r.ok) throw new Error('record');
    expect((await accounts())[0]!.postingsMinor).toBe(97500);

    expect((await writer.run(RemoveEntry, { transactionId: r.value.transactionId }, 'user')).ok).toBe(true);
    expect((await accounts())[0]!.postingsMinor).toBe(100000);
    expect((await q('SELECT removal_kind, removed_at FROM "transaction" WHERE id = ?', [r.value.transactionId]))[0]).toEqual(['deleted', NOW]);
    expect(Number((await q("SELECT COUNT(*) FROM audit_event WHERE entity_id = ?", [r.value.transactionId]))[0]![0])).toBe(2);
    expect(await writer.run(RemoveEntry, { transactionId: r.value.transactionId }, 'user')).toEqual({ ok: false, code: 'ALREADY_REMOVED' });
    expect(await writer.run(RemoveEntry, { transactionId: 'x' }, 'user')).toEqual({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });

  it('removed entries do not count toward category use', async () => {
    const { writer, q } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: null }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    const a = await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: id });
    await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_transport', accountId: id });
    if (!a.ok) throw new Error('x');
    await writer.run(RemoveEntry, { transactionId: a.value.transactionId }, 'user');
    expect(await q(CATEGORY_USE_SQL)).toEqual([['cat_transport', 1]]);
  });
});

describe('entryShape invariant', () => {
  it('stops an expense whose split does not match the amount', async () => {
    const { writer, q } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: null }, 'user');
    const id = (await q('SELECT id FROM account'))[0]![0] as string;
    const bad = {
      name: 'Bad',
      async execute(ctx: import('../writer/ledgerWriter').WriterContext) {
        await ctx.execute("INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('t1','expense','confirmed',500,1,'2026-01-01','UTC',1,1)");
        await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor) VALUES ('p1','t1',?, 'out', -500)", [id]);
        await ctx.execute("INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES ('s1','t1','cat_food',400)");
        ctx.touch('transaction', 't1');
        return { ok: true as const, value: undefined };
      },
    };
    const r = await writer.run(bad, undefined, 'user');
    expect(r.ok).toBe(false);
    expect(Number((await q('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(0);
  });
});

describe('default account', () => {
  it('prefers the last account used with the category, then the last used, then the first', async () => {
    const { writer, q, clock } = await setup();
    await writer.run(AddAccount, { name: 'A', type: 'bank', openingMinor: null }, 'user');
    await writer.run(AddAccount, { name: 'B', type: 'cash', openingMinor: null }, 'user');
    const ids = (await q('SELECT id FROM account ORDER BY sort_order')).map((r) => r[0] as string);
    const last = async (cat: string) => ((await q(LAST_ACCOUNT_FOR_CATEGORY_SQL, [cat]))[0]?.[0] as string | undefined) ?? null;
    const any = async () => ((await q(LAST_ACCOUNT_SQL))[0]?.[0] as string | undefined) ?? null;

    expect(pickDefaultAccount(ids, await last('cat_food'), await any())).toBe(ids[0]);

    await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: ids[0]! });
    clock.advance(1000);
    await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_transport', accountId: ids[1]! });
    expect(pickDefaultAccount(ids, await last('cat_food'), await any())).toBe(ids[0]);
    expect(pickDefaultAccount(ids, await last('cat_groceries'), await any())).toBe(ids[1]);
    expect(pickDefaultAccount(ids.slice(0, 1), null, ids[1]!)).toBe(ids[0]);
    expect(pickDefaultAccount([], null, null)).toBeNull();
  });
});

describe('quick-category ranking', () => {
  const cats = mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === 'expense').map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i]));

  it('keeps seed order for a new profile and never offers Uncategorised', () => {
    const r = rankCategories(cats, new Map());
    expect(r.map((c) => c.name).slice(0, 3)).toEqual(['Food & Drinks', 'Groceries', 'Transport']);
    expect(r.some((c) => c.id === 'cat_uncategorised')).toBe(false);
  });

  it('orders by use count with seed order breaking ties', () => {
    const r = rankCategories(cats, new Map([['cat_transport', 5], ['cat_travel', 5], ['cat_food', 1]]));
    expect(r.slice(0, 3).map((c) => c.id)).toEqual(['cat_transport', 'cat_travel', 'cat_food']);
  });

  it('is recalculated at most once a day', () => {
    expect(rankIsStale(null, NOW)).toBe(true);
    expect(rankIsStale(NOW, NOW + 86_399_999)).toBe(false);
    expect(rankIsStale(NOW, NOW + 86_400_000)).toBe(true);
    expect(rankIsStale(NOW, NOW - 1)).toBe(true);
  });
});

describe('keypad', () => {
  const type = (keys: string[], exp = 2) => keys.reduce((t, k) => applyKey(t, (k === '.' ? 'decimal' : k) as never, exp), '');

  it('types 12.50 and blocks a third decimal without rounding', () => {
    expect(type(['1', '2', '.', '5', '0'])).toBe('12.50');
    expect(type(['1', '2', '.', '5', '0', '9'])).toBe('12.50');
  });
  it('starts a decimal with a leading zero, allows one decimal point, collapses leading zeros', () => {
    expect(type(['.'])).toBe('0.');
    expect(type(['1', '.', '.', '5'])).toBe('1.5');
    expect(type(['0', '0', '7'])).toBe('7');
    expect(type(['0', '0'])).toBe('0');
  });
  it('has no decimal for 0-exponent currencies and three decimals for exponent 3', () => {
    expect(type(['1', '.', '5'], 0)).toBe('15');
    expect(type(['1', '.', '2', '3', '4', '5'], 3)).toBe('1.234');
  });
  it('deletes one character, clears all, caps the integer digits', () => {
    expect(applyKey('12.5', 'delete', 2)).toBe('12.');
    expect(applyKey('', 'delete', 2)).toBe('');
    expect(applyKey('12.5', 'clear', 2)).toBe('');
    expect(applyKey('9'.repeat(12), '9', 2)).toBe('9'.repeat(12));
  });
  it('maps hardware keys', () => {
    expect(keypadKeyFromHardware('7')).toBe('7');
    expect(keypadKeyFromHardware('Backspace')).toBe('delete');
    expect(keypadKeyFromHardware('.')).toBe('decimal');
    expect(keypadKeyFromHardware('a')).toBeNull();
  });
});

describe('instantFromLocal', () => {
  it('converts wall-clock time in the profile timezone to a UTC instant', () => {
    expect(instantFromLocal('2026-11-08', '18:00', 'Asia/Singapore')).toBe(NOW);
    expect(instantFromLocal('2026-11-08', '15:30', 'Asia/Kolkata')).toBe(NOW);
    expect(instantFromLocal('2026-11-08', '05:00', 'America/New_York')).toBe(NOW);
  });
  it('rejects impossible dates and times', () => {
    expect(instantFromLocal('2026-02-31', '10:00', 'UTC')).toBeNull();
    expect(instantFromLocal('2026-11-08', '24:00', 'UTC')).toBeNull();
    expect(instantFromLocal('11/08/2026', '10:00', 'UTC')).toBeNull();
    expect(instantFromLocal('2026-11-08', '10:00', 'Not/AZone')).toBeNull();
  });
});
