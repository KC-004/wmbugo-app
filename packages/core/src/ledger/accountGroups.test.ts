import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { ChangeSetting } from '../profile/settingsCommands';
import { parseSettings, SETTING_SHOW_NET_WORTH, SETTINGS_SQL } from '../profile/settings';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, MoveAccount, openingBalanceShape, SetAccountInclusion } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountRow, type AccountType } from './accounts';
import { accountGroups, accountLine } from './balances';
import { homeAccounts } from './readModels';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(4)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const rows = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  return { db, writer, rows, add };
}

const row = (over: Partial<AccountRow> & { id: string }): AccountRow => ({
  name: over.id, type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: false, postingsMinor: 0, ...over,
});

describe('account lines (unsigned, direction in words)', () => {
  it('reads each account kind', () => {
    expect(accountLine(row({ id: 'a', postingsMinor: 230000 }))).toEqual({ kind: 'have', minor: 230000 });
    expect(accountLine(row({ id: 'a', postingsMinor: -50000 }))).toEqual({ kind: 'below-zero', minor: 50000 });
    expect(accountLine(row({ id: 'a', balanceNotSet: true }))).toEqual({ kind: 'not-set' });
    expect(accountLine(row({ id: 'c', type: 'card', postingsMinor: -410000 }))).toEqual({ kind: 'owe', minor: 410000 });
    expect(accountLine(row({ id: 'c', type: 'card', postingsMinor: 900 }))).toEqual({ kind: 'in-credit', minor: 900 });
    expect(accountLine(row({ id: 'c', type: 'card', postingsMinor: 0 }))).toEqual({ kind: 'owe', minor: 0 });
  });
});

describe('account groups (Story 2.2)', () => {
  const ravi = [
    row({ id: 'cash', type: 'cash', sortOrder: 0, postingsMinor: 230000 }),
    row({ id: 'hdfc', sortOrder: 1, postingsMinor: 3120000 }),
    row({ id: 'sbi', sortOrder: 2, postingsMinor: 1880000 }),
    row({ id: 'card', type: 'card', sortOrder: 3, postingsMinor: -410000 }),
  ];

  it("Ravi's accounts: 52,300 have, 4,100 owe, net worth 48,200, in saved order", () => {
    const g = accountGroups(ravi);
    expect(g.have.rows.map((r) => r.id)).toEqual(['cash', 'hdfc', 'sbi']);
    expect(g.have.total).toEqual({ kind: 'amount', minor: 5230000 });
    expect(g.owe.total).toEqual({ kind: 'amount', minor: 410000 });
    expect(g.netWorth).toEqual({ kind: 'net', minor: 4820000 });
  });

  it('not-set accounts are counted, never zeroed; only not-set means "not set yet"', () => {
    const g = accountGroups([...ravi, row({ id: 'x', balanceNotSet: true, sortOrder: 4 })]);
    expect(g.have).toMatchObject({ total: { kind: 'amount', minor: 5230000 }, notSetCount: 1 });
    expect(accountGroups([row({ id: 'x', balanceNotSet: true })]).have.total).toEqual({ kind: 'not-set-yet' });
  });

  it('a negative group total is "below zero"; net worth says you owe more when cards outweigh accounts', () => {
    expect(accountGroups([row({ id: 'a', postingsMinor: -500 })]).have.total).toEqual({ kind: 'below-zero', minor: 500 });
    const g = accountGroups([row({ id: 'a', postingsMinor: 100000 }), row({ id: 'c', type: 'card', postingsMinor: -250000 })]);
    expect(g.netWorth).toEqual({ kind: 'owe-more', minor: 150000 });
  });

  it('accounts left out of totals drop from the total and net worth, and are counted as excluded', () => {
    const g = accountGroups([...ravi.slice(0, 2), { ...ravi[2]!, includeInOverview: false }, ravi[3]!]);
    expect(g.have.total).toEqual({ kind: 'amount', minor: 3350000 });
    expect(g.have.excludedCount).toBe(1);
    expect(g.netWorth).toEqual({ kind: 'net', minor: 2940000 });
  });

  it('archived accounts are in no group', () => {
    expect(accountGroups([row({ id: 'a', postingsMinor: 100, status: 'archived' })]).have.rows).toEqual([]);
  });
});

describe('SetAccountInclusion', () => {
  it('turns an asset out of the totals and back, emitting AccountsChanged; Home follows', async () => {
    const { db, writer, rows, add } = await setup();
    const cash = await add('Cash', 'cash', 230000);
    await add('HDFC', 'bank', 3120000);
    const total = async () => homeAccounts(await rows()).inAccountsMinor;
    expect(await total()).toBe(3350000);

    expect(await writer.run(SetAccountInclusion, { accountId: cash, include: false }, 'user')).toEqual({ ok: true, value: undefined });
    expect(await total()).toBe(3120000);
    expect((await rows()).find((r) => r.id === cash)).toMatchObject({ includeInOverview: false, postingsMinor: 230000 });
    const events = await db.query("SELECT event FROM outbox ORDER BY created_at DESC, rowid DESC LIMIT 1");
    expect(String(events[0]![0])).toBe('AccountsChanged');
    expect(Number((await db.query('SELECT COUNT(*) FROM audit_event WHERE entity_id = ?', [cash]))[0]![0])).toBeGreaterThan(1);

    await writer.run(SetAccountInclusion, { accountId: cash, include: true }, 'user');
    expect(await total()).toBe(3350000);
  });

  it('refuses a card and an unknown account, changing nothing', async () => {
    const { writer, rows, add } = await setup();
    const card = await add('Visa', 'card', 45000);
    expect(await writer.run(SetAccountInclusion, { accountId: card, include: false }, 'user')).toEqual({ ok: false, code: 'CARD_ALWAYS_COUNTS' });
    expect(await writer.run(SetAccountInclusion, { accountId: 'nope', include: false }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect((await rows())[0]!.includeInOverview).toBe(true);
  });
});

describe('MoveAccount stays inside its group', () => {
  it('a card moves only among cards and an asset only among assets; the order stays dense', async () => {
    const { writer, rows, add } = await setup();
    const a = await add('A', 'bank', null);
    const c1 = await add('C1', 'card', null);
    const b = await add('B', 'bank', null);
    const c2 = await add('C2', 'card', null);
    const names = async () => (await rows()).map((r) => r.name).join('');
    expect(await names()).toBe('AC1BC2');

    // A moves down past the card in between, landing after B.
    expect(await writer.run(MoveAccount, { accountId: a, direction: 'down' }, 'user')).toEqual({ ok: true, value: undefined });
    expect(await names()).toBe('BC1AC2');
    // The first card is already first among cards, so there is no move up.
    expect(await writer.run(MoveAccount, { accountId: c1, direction: 'up' }, 'user')).toEqual({ ok: false, code: 'AT_EDGE' });
    expect(await writer.run(MoveAccount, { accountId: c2, direction: 'up' }, 'user')).toEqual({ ok: true, value: undefined });
    expect(await names()).toBe('BC2AC1');
    expect(await writer.run(MoveAccount, { accountId: b, direction: 'up' }, 'user')).toEqual({ ok: false, code: 'AT_EDGE' });
    expect((await rows()).map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
  });
});

describe('Show net worth setting', () => {
  it('is off by default, stored as a setting and refuses a non-boolean', async () => {
    const { db, writer } = await setup();
    expect(parseSettings(await db.query(SETTINGS_SQL)).showNetWorth).toBe(false);
    expect(await writer.run(ChangeSetting, { key: SETTING_SHOW_NET_WORTH, value: true }, 'user')).toMatchObject({ ok: true });
    expect(parseSettings(await db.query(SETTINGS_SQL)).showNetWorth).toBe(true);
    expect(await writer.run(ChangeSetting, { key: SETTING_SHOW_NET_WORTH, value: 'yes' }, 'user')).toMatchObject({ ok: false });
  });
});
