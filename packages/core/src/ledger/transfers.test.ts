import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { entryShape } from './entryCommands';
import { ACTIVITY_SQL, groupByDay, mapActivityRows, SPENT_EXPENSES_SQL } from './readModels';
import { OTHER_CATEGORY_ID, SETTING_BLOCK_TRANSFERS } from './transferCommands';
import { recordEntry, recordTransfer } from '../testing/capture';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(8)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'none' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
  await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 100000 }, 'user');
  await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 5000 }, 'user');
  const ids = (await db.query('SELECT id FROM account ORDER BY sort_order')).map((r) => r[0] as string);
  const balances = async () => Object.fromEntries(mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).map((a) => [a.name, a.postingsMinor]));
  const spent = async () => Number((await db.query(SPENT_EXPENSES_SQL, ['2026-11-01', '2026-11-30']))[0]![0]);
  const count = async (sql: string) => Number((await db.query(sql))[0]![0]);
  return { db, writer, ids, balances, spent, count, from: ids[0]!, to: ids[1]! };
}

describe('RecordTransfer', () => {
  it('writes one transfer with -20000 on From and +20000 on To, neither income nor expense', async () => {
    const { writer, from, to, balances, spent, db } = await setup();
    const r = await recordTransfer(writer, { amountMinor: 20000, fromAccountId: from, toAccountId: to });
    expect(r.ok).toBe(true);
    expect(await balances()).toEqual({ DBS: 80000, Cash: 25000 });
    expect(await db.query("SELECT event_type, status, amount_minor, local_date FROM \"transaction\" WHERE event_type = 'transfer'")).toEqual([['transfer', 'confirmed', 20000, '2026-11-08']]);
    expect(await db.query("SELECT signed_amount_minor FROM posting WHERE posting_kind = 'normal' ORDER BY signed_amount_minor")).toEqual([[-20000], [20000]]);
    expect(await spent()).toBe(0);
    expect(Number((await db.query("SELECT COUNT(*) FROM split"))[0]![0])).toBe(0);
    expect((await db.query('SELECT event FROM outbox')).map((x) => x[0])).toContain('TransactionsChanged');
  });

  it('a fee is a separate confirmed expense from From (default Other) in the same commit; only the fee is spending', async () => {
    const { writer, from, to, balances, spent, db } = await setup();
    const r = await recordTransfer(writer, { amountMinor: 20000, fromAccountId: from, toAccountId: to, fee: { amountMinor: 200, categoryId: OTHER_CATEGORY_ID } });
    expect(r.ok && r.value.feeTransactionId).toBeTruthy();
    expect(await balances()).toEqual({ DBS: 79800, Cash: 25000 });
    expect(await spent()).toBe(200);
    expect(await db.query("SELECT category_id, amount_minor FROM split")).toEqual([[OTHER_CATEGORY_ID, 200]]);
  });

  it('refuses the same account and writes nothing', async () => {
    const { writer, from, count } = await setup();
    const before = await count('SELECT COUNT(*) FROM "transaction"');
    expect(await recordTransfer(writer, { amountMinor: 100, fromAccountId: from, toAccountId: from })).toEqual({ ok: false, code: 'SAME_ACCOUNT' });
    expect(await count('SELECT COUNT(*) FROM "transaction"')).toBe(before);
  });

  it('validates the amount, accounts, archived accounts, fee and category', async () => {
    const { writer, from, to, db } = await setup();
    const run = (over: object) => recordTransfer(writer, { amountMinor: 100, fromAccountId: from, toAccountId: to, ...over } as never);
    expect(await run({ amountMinor: 0 })).toEqual({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await run({ amountMinor: 1.5 })).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(await run({ toAccountId: 'nope' })).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await run({ fee: { amountMinor: 0, categoryId: 'cat_other' } })).toEqual({ ok: false, code: 'FEE_INVALID' });
    expect(await run({ fee: { amountMinor: 5, categoryId: 'cat_in_salary' } })).toEqual({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    await db.query("UPDATE account SET status = 'archived' WHERE id = ?", [to]);
    expect(await run({})).toEqual({ ok: false, code: 'ACCOUNT_ARCHIVED' });
  });

  it('allows an amount above the balance by default (the screen warns)', async () => {
    const { writer, from, to, balances } = await setup();
    expect((await recordTransfer(writer, { amountMinor: 500000, fromAccountId: from, toAccountId: to })).ok).toBe(true);
    expect((await balances()).DBS).toBe(-400000);
  });

  it('with Block transfers above the balance on, refuses with INSUFFICIENT_FUNDS and keeps allowing amounts within the balance', async () => {
    const { writer, from, to, db, balances } = await setup();
    await db.query("INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, 'true', 1, 1)", [SETTING_BLOCK_TRANSFERS]);
    expect(await recordTransfer(writer, { amountMinor: 100001, fromAccountId: from, toAccountId: to })).toEqual({ ok: false, code: 'INSUFFICIENT_FUNDS' });
    expect((await balances()).DBS).toBe(100000);
    expect((await recordTransfer(writer, { amountMinor: 100000, fromAccountId: from, toAccountId: to })).ok).toBe(true);
  });

  it('never treats an unknown balance as zero when blocking', async () => {
    const { writer, db, to } = await setup();
    await writer.run(AddAccount, { name: 'Unknown', type: 'bank', openingMinor: null }, 'user');
    const unknown = (await db.query("SELECT id FROM account WHERE name = 'Unknown'"))[0]![0] as string;
    await db.query("INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, 'true', 1, 1)", [SETTING_BLOCK_TRANSFERS]);
    expect((await recordTransfer(writer, { amountMinor: 999, fromAccountId: unknown, toAccountId: to })).ok).toBe(true);
  });

  it('the invariant rejects a transfer that does not sum to zero', async () => {
    const { writer, from, to, db } = await setup();
    const bad = {
      name: 'BadTransfer',
      async execute(ctx: import('../writer/ledgerWriter').WriterContext) {
        await ctx.execute("INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('t9','transfer','confirmed',500,1,'2026-01-01','UTC',1,1)");
        await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor) VALUES ('p1','t9',?, 'out', -500)", [from]);
        await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor) VALUES ('p2','t9',?, 'in', 400)", [to]);
        ctx.touch('transaction', 't9');
        return { ok: true as const, value: undefined };
      },
    };
    expect((await writer.run(bad, undefined, 'user')).ok).toBe(false);
    expect(Number((await db.query("SELECT COUNT(*) FROM \"transaction\" WHERE id = 't9'"))[0]![0])).toBe(0);
  });
});

describe('Activity with transfers and income', () => {
  it('shows one transfer row "From → To", unsigned and excluded from the day Spent, and income excluded too', async () => {
    const { writer, from, to, db } = await setup();
    await recordEntry(writer, { kind: 'income', amountMinor: 420000, categoryId: 'cat_in_salary', accountId: from, note: 'Nov' });
    await recordTransfer(writer, { amountMinor: 20000, fromAccountId: from, toAccountId: to });
    const rows = mapActivityRows(await db.query(ACTIVITY_SQL, [100]));
    expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(1);
    expect(rows.find((r) => r.kind === 'transfer')!.accountName).toBe('DBS → Cash');
    expect(groupByDay(rows)[0]!.spentMinor).toBe(0);
  });
});
