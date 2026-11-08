import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ChangeTrackingDate, SetStartingBalance } from './accountBalanceCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { entryShape, RecordManualEntry } from './entryCommands';
import { ACTIVITY_SQL, homeAccounts, INCOME_SQL, mapActivityRows, SPENT_EXPENSES_SQL } from './readModels';

const NOW = Date.UTC(2026, 10, 7, 10, 0, 0); // 7 Nov 15:30 in Kolkata
const DAY = 86_400_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(8)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const account = async (id: string) => mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((x) => x.id === id)!;
  const spend = (accountId: string, amountMinor: number, occurredAtMs?: number) =>
    writer.run(RecordManualEntry, { kind: 'expense', amountMinor, categoryId: 'cat_food', accountId, ...(occurredAtMs ? { occurredAtMs } : {}) }, 'user');
  return { db, clock, writer, add, account, spend };
}

describe('SetStartingBalance (Story 2.4)', () => {
  it('Cash with no balance and 450 of later expenses: entering 1,550 writes an opening of 2,000 and the balance reads 1,550', async () => {
    const { db, clock, writer, add, account, spend } = await setup();
    const cash = await add('Cash', 'cash', null);
    clock.advance(1000);
    await spend(cash, 45000);

    const r = await writer.run(SetStartingBalance, { accountId: cash, amountMinor: 155000 }, 'user');
    expect(r.ok).toBe(true);
    const row = await account(cash);
    expect(row).toMatchObject({ balanceNotSet: false, postingsMinor: 155000 });
    const open = await db.query(
      "SELECT t.event_type, p.posting_kind, p.signed_amount_minor, t.occurred_at_utc FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE p.account_id = ? AND p.posting_kind = 'opening_balance'",
      [cash],
    );
    expect(open).toHaveLength(1);
    expect([open[0]![0], open[0]![1], Number(open[0]![2])]).toEqual(['opening_balance', 'opening_balance', 200000]);
    // effective at the account's opening instant (when it was created), not now
    expect(Number(open[0]![3])).toBe(NOW);
    expect(Number((await db.query('SELECT opening_minor FROM account WHERE id = ?', [cash]))[0]![0])).toBe(200000);
    expect(Number((await db.query('SELECT COUNT(*) FROM audit_event WHERE entity_id = ?', [cash]))[0]![0])).toBeGreaterThanOrEqual(2);
    const events = (await db.query('SELECT event FROM outbox ORDER BY created_at DESC, rowid DESC LIMIT 2')).map((x) => String(x[0])).sort();
    expect(events).toEqual(['AccountsChanged', 'TransactionsChanged']);
    expect(homeAccounts([row])).toMatchObject({ inAccountsMinor: 155000, notSetCount: 0 });
  });

  it('entries dated before the account was opened do not count: the balance still reads what was entered', async () => {
    const { clock, writer, add, account, spend } = await setup();
    const cash = await add('Cash', 'cash', null);
    clock.advance(1000);
    await spend(cash, 30000, NOW - 2 * DAY);
    await spend(cash, 10000);
    await writer.run(SetStartingBalance, { accountId: cash, amountMinor: 50000 }, 'user');
    expect((await account(cash)).postingsMinor).toBe(50000);
  });

  it('a card takes the amount owed: opening is negative per AD-5 and Card dues includes it', async () => {
    const { writer, add, account } = await setup();
    const card = await add('HDFC Card', 'card', null);
    await writer.run(SetStartingBalance, { accountId: card, amountMinor: 410000 }, 'user');
    const row = await account(card);
    expect(row.postingsMinor).toBe(-410000);
    expect(homeAccounts([row]).cardDuesMinor).toBe(410000);
  });

  it('zero is a valid balance and clears "not set"; no opening transaction is needed', async () => {
    const { db, writer, add, account } = await setup();
    const cash = await add('Cash', 'cash', null);
    const r = await writer.run(SetStartingBalance, { accountId: cash, amountMinor: 0 }, 'user');
    expect(r).toEqual({ ok: true, value: { transactionId: null } });
    expect(await account(cash)).toMatchObject({ balanceNotSet: false, postingsMinor: 0 });
    expect(Number((await db.query('SELECT COUNT(*) FROM posting WHERE account_id = ?', [cash]))[0]![0])).toBe(0);
  });

  it('refuses an account that already has a balance, an unknown account and a bad amount; nothing changes', async () => {
    const { db, writer, add } = await setup();
    const bank = await add('HDFC', 'bank', 3000000);
    const cash = await add('Cash', 'cash', null);
    const before = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    expect(await writer.run(SetStartingBalance, { accountId: bank, amountMinor: 1 }, 'user')).toEqual({ ok: false, code: 'ALREADY_SET' });
    expect(await writer.run(SetStartingBalance, { accountId: 'nope', amountMinor: 1 }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await writer.run(SetStartingBalance, { accountId: cash, amountMinor: -5 }, 'user')).toEqual({ ok: false, code: 'AMOUNT_NEGATIVE' });
    expect(await writer.run(SetStartingBalance, { accountId: cash, amountMinor: 1.5 }, 'user')).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(before);
  });

  it('opening balances never count as income, spending or an Activity row (LIR-08)', async () => {
    const { db, writer, add } = await setup();
    const cash = await add('Cash', 'cash', null);
    await writer.run(SetStartingBalance, { accountId: cash, amountMinor: 200000 }, 'user');
    await add('HDFC', 'bank', 3000000);
    const range: [string, string] = ['2026-11-01', '2026-11-30'];
    expect(Number((await db.query(SPENT_EXPENSES_SQL, range))[0]![0])).toBe(0);
    expect(Number((await db.query(INCOME_SQL, range))[0]![0])).toBe(0);
    expect(mapActivityRows(await db.query(ACTIVITY_SQL, [100]))).toHaveLength(0);
  });
});

describe('ChangeTrackingDate (Story 2.4)', () => {
  it('moves the opening instant to the start of that day: earlier entries count again and lose the mark; the opening amount is unchanged', async () => {
    const { db, clock, writer, add, account, spend } = await setup();
    const cash = await add('Cash', 'cash', 200000);
    clock.advance(1000);
    await spend(cash, 30000, NOW - 4 * DAY); // 3 Nov, before tracking
    expect((await account(cash)).postingsMinor).toBe(200000);

    const r = await writer.run(ChangeTrackingDate, { accountId: cash, localDate: '2026-11-01' }, 'user');
    expect(r).toEqual({ ok: true, value: undefined });
    expect((await account(cash)).postingsMinor).toBe(170000);
    expect(Number((await db.query('SELECT opening_minor FROM account WHERE id = ?', [cash]))[0]![0])).toBe(200000);
    // 1 Nov 00:00 in Kolkata is 31 Oct 18:30 UTC
    expect(Number((await db.query('SELECT opening_effective_at FROM account WHERE id = ?', [cash]))[0]![0])).toBe(Date.UTC(2026, 9, 31, 18, 30));
    expect(mapActivityRows(await db.query(ACTIVITY_SQL, [100]))[0]!.beforeTracking).toBe(false);
    const audit = JSON.stringify(await db.query('SELECT * FROM audit_event WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1', [cash]));
    expect(audit).toContain('trackingFrom');
    expect(audit).toContain('trackingTo');
  });

  it('rejects a date in the future, an invalid date, an unknown account and a not-set account', async () => {
    const { writer, add } = await setup();
    const cash = await add('Cash', 'cash', 100);
    const bare = await add('Wallet', 'wallet', null);
    expect(await writer.run(ChangeTrackingDate, { accountId: cash, localDate: '2026-11-08' }, 'user')).toEqual({ ok: false, code: 'DATE_IN_FUTURE' });
    expect(await writer.run(ChangeTrackingDate, { accountId: cash, localDate: '2026-02-31' }, 'user')).toEqual({ ok: false, code: 'DATE_INVALID' });
    expect(await writer.run(ChangeTrackingDate, { accountId: 'nope', localDate: '2026-11-01' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await writer.run(ChangeTrackingDate, { accountId: bare, localDate: '2026-11-01' }, 'user')).toEqual({ ok: false, code: 'BALANCE_NOT_SET' });
    expect(await writer.run(ChangeTrackingDate, { accountId: cash, localDate: '2026-11-07' }, 'user')).toMatchObject({ ok: true });
  });
});

describe('only a user action moves an opening instant', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });

  it('no code outside the two named use cases writes opening_effective_at on an existing account', () => {
    const hits: string[] = [];
    for (const f of walk(join(__dirname, '..'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/UPDATE account SET[^;'"`]*opening_effective_at/g)) hits.push(`${f.split(/[\\/]/).slice(-1)[0]}: ${m[0].slice(0, 40)}`);
    }
    // SetStartingBalance (first balance) and ChangeTrackingDate (user's choice) are the only writers.
    expect(hits.map((h) => h.split(':')[0])).toEqual(['accountBalanceCommands.ts', 'accountBalanceCommands.ts']);
  });
});
