import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { ok } from '../shared/result';
import { createIdGenerator, seededRandom, UUID_V7_PATTERN } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter, type UseCase } from '../writer/ledgerWriter';
import { AddAccount, ArchiveAccount, MoveAccount, openingBalanceShape, RenameAccount, RestoreAccount } from './accountCommands';
import { ACCOUNT_DEFAULTS, ACCOUNT_LIST_SQL, ACCOUNT_TYPES, assetTotal, balanceOf, cardDues, mapAccountRows, openingPostingMinor, validateAccountName, type AccountType } from './accounts';

// 2026-11-08T10:00:00Z, which is 2026-11-08 18:00 in Singapore.
const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup(withProfile = true) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(9)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape],
  });
  if (withProfile) {
    const r = await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'last_day' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
    if (!r.ok) throw new Error('setup');
  }
  const rows = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const count = async (table: string) => Number((await db.query(`SELECT count(*) FROM "${table}"`))[0]![0]);
  return { db, clock, writer, rows, count };
}

const add = (w: LedgerWriter, name: string, type: AccountType = 'bank', openingMinor: number | null = null) =>
  w.run(AddAccount, { name, type, openingMinor }, 'user');

describe('account rules', () => {
  it('has a default icon and cat colour for every type (UX-DR8)', () => {
    expect(ACCOUNT_DEFAULTS.cash.color).toBe('cat-lime');
    expect(ACCOUNT_DEFAULTS.bank.color).toBe('cat-indigo');
    expect(ACCOUNT_DEFAULTS.wallet.color).toBe('cat-sky');
    expect(ACCOUNT_DEFAULTS.savings_pot.color).toBe('cat-emerald');
    expect(ACCOUNT_DEFAULTS.card.color).toBe('cat-fuchsia');
    expect(ACCOUNT_TYPES).toHaveLength(5);
  });

  it('validates names', () => {
    expect(validateAccountName('  DBS  ')).toEqual({ ok: true, value: 'DBS' });
    expect(validateAccountName('')).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect(validateAccountName('   ')).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect(validateAccountName('x'.repeat(61))).toEqual({ ok: false, code: 'NAME_TOO_LONG' });
    expect(validateAccountName('x'.repeat(60)).ok).toBe(true);
  });

  it('a card stores what is owed as negative, assets stay positive, zero stays zero', () => {
    expect(openingPostingMinor('card', 45000)).toBe(-45000);
    expect(openingPostingMinor('bank', 320000)).toBe(320000);
    expect(openingPostingMinor('card', 0)).toBe(0);
  });
});

describe('AddAccount (real SQLite, real migrations)', () => {
  it('writes the account and an opening_balance transaction with one +posting in one transaction', async () => {
    const { db, writer, rows, count } = await setup();
    const r = await add(writer, 'DBS', 'bank', 320000);
    expect(r.ok).toBe(true);

    const [a] = await db.query('SELECT id, name, type, icon, color_token, opening_minor, opening_effective_at, balance_not_set, sort_order, status, created_at FROM account');
    expect(a![0]).toMatch(UUID_V7_PATTERN);
    expect(a!.slice(1)).toEqual(['DBS', 'bank', 'Bank', 'cat-indigo', 320000, NOW, 0, 0, 'active', NOW]);

    const [t] = await db.query('SELECT id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at FROM "transaction"');
    expect(t![0]).toMatch(UUID_V7_PATTERN);
    expect(t!.slice(1)).toEqual(['opening_balance', 'confirmed', 320000, NOW, '2026-11-08', 'Asia/Singapore', NOW, NOW]);

    const p = await db.query('SELECT id, transaction_id, account_id, direction, signed_amount_minor, posting_kind FROM posting');
    expect(p).toHaveLength(1);
    expect(p[0]!.slice(1)).toEqual([t![0], a![0], 'in', 320000, 'opening_balance']);

    expect((await rows())[0]).toMatchObject({ name: 'DBS', balanceNotSet: false, postingsMinor: 320000 });
    expect(balanceOf((await rows())[0]!)).toEqual({ kind: 'known', minor: 320000 });
    expect(await count('transaction')).toBe(1);
  });

  it('the local date is the profile-timezone date, not the UTC date (late evening in Singapore)', async () => {
    const { db, clock, writer } = await setup();
    clock.set(Date.UTC(2026, 10, 8, 20, 0, 0)); // 04:00 on the 9th in Singapore
    await add(writer, 'Late', 'cash', 100);
    expect((await db.query('SELECT local_date FROM "transaction"'))[0]![0]).toBe('2026-11-09');
  });

  it('a card owed S$450 stores -45000, shows 45000 as dues and is not added to asset totals', async () => {
    const { db, writer, rows } = await setup();
    await add(writer, 'DBS', 'bank', 320000);
    await add(writer, 'Visa', 'card', 45000);
    const posting = await db.query("SELECT direction, signed_amount_minor FROM posting WHERE account_id = (SELECT id FROM account WHERE name = 'Visa')");
    expect(posting).toEqual([['out', -45000]]);
    const all = await rows();
    const card = all.find((r) => r.name === 'Visa')!;
    expect(balanceOf(card)).toEqual({ kind: 'known', minor: -45000 });
    expect(cardDues(card)).toEqual({ kind: 'known', minor: 45000 });
    expect(assetTotal(all)).toEqual({ minor: 320000, accountsCounted: 1, accountsNotSet: 0 });
  });

  it('no balance: the account is stored not set with no opening posting, and is never read as zero', async () => {
    const { db, writer, rows, count } = await setup();
    await add(writer, 'Wallet', 'wallet', null);
    expect(await count('transaction')).toBe(0);
    expect(await count('posting')).toBe(0);
    expect((await db.query('SELECT balance_not_set, opening_minor, opening_effective_at FROM account'))[0]).toEqual([1, null, null]);
    const [row] = await rows();
    expect(balanceOf(row!)).toEqual({ kind: 'not-set' });
    expect(assetTotal([row!])).toEqual({ minor: 0, accountsCounted: 0, accountsNotSet: 1 });
  });

  it('a typed zero is a known zero with no posting', async () => {
    const { writer, rows, count } = await setup();
    await add(writer, 'Cash', 'cash', 0);
    expect(await count('posting')).toBe(0);
    expect(balanceOf((await rows())[0]!)).toEqual({ kind: 'known', minor: 0 });
  });

  it.each(ACCOUNT_TYPES)('stores the type defaults for %s', async (type) => {
    const { db, writer } = await setup();
    await add(writer, 'x', type, 100);
    expect((await db.query('SELECT icon, color_token FROM account'))[0]).toEqual([ACCOUNT_DEFAULTS[type].icon, ACCOUNT_DEFAULTS[type].color]);
  });

  it('an empty name writes nothing and reports NAME_REQUIRED', async () => {
    const { writer, count } = await setup();
    const before = [await count('account'), await count('transaction'), await count('audit_event'), await count('outbox')];
    expect(await add(writer, '   ', 'bank', 100)).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect([await count('account'), await count('transaction'), await count('audit_event'), await count('outbox')]).toEqual(before);
  });

  it('rejects negative, fractional and unknown-type input, and a missing profile', async () => {
    const { writer } = await setup();
    expect(await add(writer, 'x', 'bank', -5)).toEqual({ ok: false, code: 'AMOUNT_NEGATIVE' });
    expect(await add(writer, 'x', 'bank', 1.5)).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(await writer.run(AddAccount, { name: 'x', type: 'crypto' as never, openingMinor: null }, 'user')).toEqual({ ok: false, code: 'TYPE_INVALID' });
    const none = await setup(false);
    expect(await add(none.writer, 'x')).toEqual({ ok: false, code: 'NO_PROFILE' });
  });

  it('emits AccountsChanged and TransactionsChanged, and audits without amounts', async () => {
    const { db, writer } = await setup();
    await add(writer, 'DBS', 'bank', 320000);
    const events = (await db.query('SELECT event FROM outbox ORDER BY created_at, rowid')).map((r) => r[0]);
    expect(events).toEqual(expect.arrayContaining(['AccountsChanged', 'TransactionsChanged']));
    const audit = (await db.query("SELECT change_json FROM audit_event WHERE kind = 'AddAccount'")).map((r) => String(r[0])).join();
    expect(audit).not.toMatch(/320000/);
  });

  it('two accounts added at once get distinct, increasing sort orders', async () => {
    const { writer, rows } = await setup();
    await Promise.all([add(writer, 'A'), add(writer, 'B'), add(writer, 'C')]);
    expect((await rows()).map((r) => [r.name, r.sortOrder])).toEqual([['A', 0], ['B', 1], ['C', 2]]);
  });
});

describe('schema constraints', () => {
  it('the transaction event-type enum accepts all seven values and rejects others', async () => {
    const { db } = await setup(false);
    const insert = (type: string) =>
      db.raw.exec(`INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('${type}', '${type}', 'confirmed', 1, 1, '2026-01-01', 'UTC', 1, 1)`);
    for (const t of ['expense', 'income', 'transfer', 'opening_balance', 'adjustment', 'refund', 'reversal']) expect(() => insert(t)).not.toThrow();
    expect(() => insert('bogus')).toThrow(/CHECK/i);
  });

  it('rejects a negative amount, a bad status and a malformed local date', async () => {
    const { db } = await setup(false);
    const base = (over: string) => `INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES (${over})`;
    expect(() => db.raw.exec(base("'a','expense','confirmed',-1,1,'2026-01-01','UTC',1,1"))).toThrow(/CHECK/i);
    expect(() => db.raw.exec(base("'b','expense','weird',1,1,'2026-01-01','UTC',1,1"))).toThrow(/CHECK/i);
    expect(() => db.raw.exec(base("'c','expense','confirmed',1,1,'26-1-1','UTC',1,1"))).toThrow(/CHECK/i);
  });

  it('a posting must agree with its direction and reference real rows', async () => {
    const { db, writer } = await setup();
    await add(writer, 'DBS', 'bank', 100);
    const [acc] = await db.query('SELECT id FROM account');
    const [tx] = await db.query('SELECT id FROM "transaction"');
    const post = (id: string, dir: string, amt: number, account = acc![0], txn = tx![0]) =>
      db.raw.exec(`INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES ('${id}', '${txn}', '${account}', '${dir}', ${amt}, 'normal')`);
    expect(() => post('p1', 'in', -5)).toThrow(/CHECK/i);
    expect(() => post('p2', 'out', 5)).toThrow(/CHECK/i);
    expect(() => post('p3', 'in', 5, 'missing-account')).toThrow(/FOREIGN KEY/i);
    expect(() => post('p4', 'in', 5, acc![0], 'missing-tx')).toThrow(/FOREIGN KEY/i);
    expect(() => post('p5', 'in', 5)).not.toThrow();
  });

  it('an account with an unknown balance may have no opening; a known one may not omit it', async () => {
    const { db } = await setup(false);
    const ins = (notSet: number, opening: string) =>
      db.raw.exec(`INSERT INTO account (id, name, type, icon, color_token, opening_minor, balance_not_set, sort_order, created_at, updated_at) VALUES ('${Math.random()}', 'x', 'bank', 'Bank', 'cat-indigo', ${opening}, ${notSet}, 0, 1, 1)`);
    expect(() => ins(1, 'NULL')).not.toThrow();
    expect(() => ins(0, '100')).not.toThrow();
    expect(() => ins(0, 'NULL')).toThrow(/CHECK/i);
  });
});

describe('rename, reorder, archive', () => {
  it('renames and keeps the input on a bad name', async () => {
    const { db, writer } = await setup();
    const r = await add(writer, 'Old');
    const id = r.ok ? r.value.accountId : '';
    expect(await writer.run(RenameAccount, { accountId: id, name: ' New ' }, 'user')).toEqual({ ok: true, value: undefined });
    expect((await db.query('SELECT name FROM account'))[0]![0]).toBe('New');
    expect(await writer.run(RenameAccount, { accountId: id, name: '' }, 'user')).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect((await db.query('SELECT name FROM account'))[0]![0]).toBe('New');
    expect(await writer.run(RenameAccount, { accountId: 'nope', name: 'x' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
  });

  it('Move up / Move down swaps neighbours and stops at the edges', async () => {
    const { writer, rows } = await setup();
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C']) {
      const r = await add(writer, n);
      if (r.ok) ids.push(r.value.accountId);
    }
    const names = async () => (await rows()).map((r) => r.name).join('');
    expect(await writer.run(MoveAccount, { accountId: ids[2]!, direction: 'up' }, 'user')).toEqual({ ok: true, value: undefined });
    expect(await names()).toBe('ACB');
    await writer.run(MoveAccount, { accountId: ids[0]!, direction: 'down' }, 'user');
    expect(await names()).toBe('CAB');
    expect(await writer.run(MoveAccount, { accountId: ids[1]!, direction: 'down' }, 'user')).toEqual({ ok: false, code: 'AT_EDGE' });
    const first = (await rows())[0]!;
    expect(await writer.run(MoveAccount, { accountId: first.id, direction: 'up' }, 'user')).toEqual({ ok: false, code: 'AT_EDGE' });
    expect(await writer.run(MoveAccount, { accountId: 'nope', direction: 'up' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect((await rows()).map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it('archiving hides the account from pickers but keeps its history; restore brings it back at the end', async () => {
    const { db, writer, rows, count } = await setup();
    const a = await add(writer, 'DBS', 'bank', 320000);
    await add(writer, 'Cash', 'cash', 5000);
    const id = a.ok ? a.value.accountId : '';
    await writer.run(ArchiveAccount, { accountId: id }, 'user');
    const active = (await db.query("SELECT name FROM account WHERE status = 'active' ORDER BY sort_order")).map((r) => r[0]);
    expect(active).toEqual(['Cash']);
    expect(await count('transaction')).toBe(2);
    expect(await count('posting')).toBe(2);
    expect((await rows()).find((r) => r.name === 'DBS')).toMatchObject({ status: 'archived', postingsMinor: 320000 });
    expect(assetTotal(await rows()).minor).toBe(5000); // archived accounts are not in the total
    await writer.run(RestoreAccount, { accountId: id }, 'user');
    expect((await db.query("SELECT name FROM account WHERE status = 'active' ORDER BY sort_order")).map((r) => r[0])).toEqual(['Cash', 'DBS']);
    expect(await writer.run(ArchiveAccount, { accountId: 'nope' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await writer.run(RestoreAccount, { accountId: 'nope' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
  });
});

describe('onboarding writes the first account in the same transaction as the profile', () => {
  const input = (account: Parameters<typeof SetUpProfile.execute>[1]['account']) => ({
    region: findRegion('SG')!,
    payday: { kind: 'last_day' as const },
    budgetOffer: { answer: 'skipped' as const },
    timezoneId: 'Asia/Singapore',
    account,
  });

  it('DBS with S$3,200: profile, account, opening transaction and +320000 posting all land together', async () => {
    const { db, writer, count } = await setup(false);
    const r = await writer.run(SetUpProfile, input({ name: 'DBS', type: 'bank', openingMinor: 320000 }), 'user');
    expect(r.ok).toBe(true);
    expect([await count('profile'), await count('account'), await count('transaction'), await count('posting')]).toEqual([1, 1, 1, 1]);
    expect((await db.query('SELECT signed_amount_minor FROM posting'))[0]![0]).toBe(320000);
  });

  it('skipping the account creates none', async () => {
    const { writer, count } = await setup(false);
    await writer.run(SetUpProfile, input(null), 'user');
    expect([await count('profile'), await count('account')]).toEqual([1, 0]);
  });

  it('an account with no balance is stored not set', async () => {
    const { db, writer } = await setup(false);
    await writer.run(SetUpProfile, input({ name: 'Cash', type: 'cash', openingMinor: null }), 'user');
    expect((await db.query('SELECT balance_not_set FROM account'))[0]![0]).toBe(1);
  });

  it('a bad account name fails the whole setup: no profile, no account, nothing written', async () => {
    const { writer, count } = await setup(false);
    const r = await writer.run(SetUpProfile, input({ name: ' ', type: 'bank', openingMinor: 100 }), 'user');
    expect(r).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect([await count('profile'), await count('account'), await count('settings'), await count('outbox')]).toEqual([0, 0, 0, 0]);
  });
});

describe('ledger invariant', () => {
  it('rejects an opening_balance transaction that does not have exactly one matching posting', async () => {
    const { db, writer, count } = await setup();
    await add(writer, 'DBS', 'bank', 100);
    const [acc] = await db.query('SELECT id FROM account');
    const bad: UseCase<void, void, never> = {
      name: 'BadOpening',
      async execute(ctx) {
        await ctx.execute("INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('t-bad', 'opening_balance', 'confirmed', 100, 1, '2026-01-01', 'UTC', 1, 1)");
        for (const id of ['p-a', 'p-b']) {
          await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, 't-bad', ?, 'in', 50, 'opening_balance')", [id, acc![0] as string]);
        }
        ctx.touch('transaction', 't-bad');
        return ok(undefined);
      },
    };
    expect(await writer.run(bad, undefined, 'system')).toEqual({ ok: false, code: 'INVARIANT_VIOLATED' });
    expect(await count('transaction')).toBe(1);
    expect(await count('posting')).toBe(1);
  });
});

describe('opening_minor equals the opening posting', () => {
  it('rejects a write that makes the account copy disagree with its posting', async () => {
    const { writer, db } = await setup();
    await add(writer, 'DBS', 'bank', 5000);
    const id = (await db.query('SELECT id FROM account'))[0]![0] as string;
    const drift: UseCase<void, void, never> = {
      name: 'Drift',
      async execute(ctx) {
        await ctx.execute('UPDATE account SET opening_minor = 9999 WHERE id = ?', [id]);
        ctx.touch('account', id);
        return ok(undefined);
      },
    };
    expect((await writer.run(drift, undefined, 'user')).ok).toBe(false);
    expect(Number((await db.query('SELECT opening_minor FROM account'))[0]![0])).toBe(5000);
  });
});
