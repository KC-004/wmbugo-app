import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { accountGroups, accountLine } from './balances';
import { entryShape, RecordManualEntry } from './entryCommands';
import { homeAccounts, INCOME_SQL, SPENT_EXPENSES_SQL } from './readModels';
import { ChangeAccountType, SAVINGS_MOVED_IN_SQL, savedDisplay } from './savings';
import { RecordTransfer } from './transferCommands';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const PERIOD: [string, string] = ['2026-11-01', '2026-11-30'];

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(5)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const rows = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const moved = async () => Number((await db.query(SAVINGS_MOVED_IN_SQL, PERIOD))[0]![0]);
  const move = (from: string, to: string, amountMinor: number) => {
    clock.advance(1000);
    return writer.run(RecordTransfer, { amountMinor, fromAccountId: from, toAccountId: to }, 'user');
  };
  return { db, clock, writer, add, rows, moved, move };
}

describe('savings pots (Story 2.8)', () => {
  it('a pot with no balance is neither counted nor "not set"; one with a balance counts as money you have', async () => {
    const { add, rows } = await setup();
    await add('HDFC', 'bank', 3000000);
    await add('SIP - Axis MF', 'savings_pot', null);
    await add('Emergency fund', 'savings_pot', 4000000);
    const all = await rows();
    expect(homeAccounts(all)).toMatchObject({ inAccountsMinor: 7000000, notSetCount: 0 });
    const g = accountGroups(all);
    expect(g.have.rows.map((r) => r.name)).toEqual(['HDFC', 'Emergency fund']);
    expect(g.have.savedRows.map((r) => r.name)).toEqual(['SIP - Axis MF']);
    expect(g.have.notSetCount).toBe(0);
  });

  it('moving 5,000 from HDFC into the SIP: one balanced transfer, spending and income unchanged, "moved in" 5,000, savingsMovedIn 5,000', async () => {
    const { db, add, rows, moved, move } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    const sip = await add('SIP', 'savings_pot', null);
    expect((await move(hdfc, sip, 500000)).ok).toBe(true);
    const all = await rows();
    expect(all.find((r) => r.id === sip)!.movedInMinor).toBe(500000);
    expect(accountLine(all.find((r) => r.id === sip)!)).toEqual({ kind: 'moved-in', minor: 500000 });
    expect(await moved()).toBe(500000);
    expect(Number((await db.query(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(0);
    expect(Number((await db.query(INCOME_SQL, PERIOD))[0]![0])).toBe(0);
    expect(homeAccounts(all).inAccountsMinor).toBe(2500000);
  });

  it('HDFC to Cash, a card bill paid from HDFC and pot-to-pot moves do not change savingsMovedIn', async () => {
    const { add, moved, move } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    const cash = await add('Cash', 'cash', 0);
    const card = await add('Card', 'card', 410000);
    const p1 = await add('PPF', 'savings_pot', 100000);
    const p2 = await add('RD', 'savings_pot', 100000);
    await move(hdfc, cash, 100000);
    await move(hdfc, card, 410000);
    await move(p1, p2, 50000);
    expect(await moved()).toBe(0);
  });

  it('a 2,000 withdrawal from a pot lowers the pot and savingsMovedIn; a net below zero is exact but displays as zero', async () => {
    const { add, rows, moved, move } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    const fund = await add('Emergency fund', 'savings_pot', 4000000);
    await move(fund, hdfc, 200000);
    expect((await rows()).find((r) => r.id === fund)!.postingsMinor).toBe(3800000);
    expect(await moved()).toBe(-200000);
    expect(savedDisplay(await moved())).toBe(0);
    await move(hdfc, fund, 500000);
    expect(await moved()).toBe(300000);
    expect(savedDisplay(300000)).toBe(300000);
  });

  it('a pot with no balance whose net is below zero reads moved in zero, never a minus', async () => {
    const { add, rows, move } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    const sip = await add('SIP', 'savings_pot', null);
    await move(sip, hdfc, 100000);
    expect(accountLine((await rows()).find((r) => r.id === sip)!)).toEqual({ kind: 'moved-in', minor: 0 });
  });

  it('expenses are never savings', async () => {
    const { writer, add, moved } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 1000, categoryId: 'cat_food', accountId: hdfc }, 'user');
    expect(await moved()).toBe(0);
  });
});

describe('ChangeAccountType (Story 2.8)', () => {
  it('asset types switch freely, with the icon and colour following the type when they were the defaults', async () => {
    const { writer, add, rows } = await setup();
    const a = await add('Money', 'bank', 100000);
    expect(await writer.run(ChangeAccountType, { accountId: a, type: 'savings_pot' }, 'user')).toEqual({ ok: true, value: undefined });
    expect((await rows())[0]).toMatchObject({ type: 'savings_pot', icon: 'PiggyBank', colorToken: 'cat-emerald', postingsMinor: 100000 });
  });

  it('between an asset and a card it is blocked once entries exist', async () => {
    const { writer, add, rows } = await setup();
    const a = await add('HDFC', 'bank', 100000);
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 500, categoryId: 'cat_food', accountId: a }, 'user');
    expect(await writer.run(ChangeAccountType, { accountId: a, type: 'card' }, 'user')).toEqual({ ok: false, code: 'HAS_ENTRIES' });
    expect((await rows())[0]!.type).toBe('bank');
  });

  it('with no entries a mistyped account can become a card: the opening is re-signed so what was typed is what is owed', async () => {
    const { writer, add, rows } = await setup();
    const a = await add('Visa', 'bank', 450000);
    expect(await writer.run(ChangeAccountType, { accountId: a, type: 'card' }, 'user')).toEqual({ ok: true, value: undefined });
    expect((await rows())[0]).toMatchObject({ type: 'card', postingsMinor: -450000 });
    expect(homeAccounts(await rows()).cardDuesMinor).toBe(450000);
    await writer.run(ChangeAccountType, { accountId: a, type: 'cash' }, 'user');
    expect((await rows())[0]).toMatchObject({ type: 'cash', postingsMinor: 450000 });
  });

  it('refuses a bad type and an unknown account', async () => {
    const { writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1);
    expect(await writer.run(ChangeAccountType, { accountId: a, type: 'nope' as never }, 'user')).toEqual({ ok: false, code: 'TYPE_INVALID' });
    expect(await writer.run(ChangeAccountType, { accountId: 'x', type: 'cash' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
  });
});

describe('review fixes (Epic 2)', () => {
  it('an account left out of totals counts again when it becomes a card, and a card losing its type drops its statement', async () => {
    const { db, writer, add, rows } = await setup();
    const a = await add('Visa', 'bank', 450000);
    const { SetAccountInclusion } = await import('./accountCommands');
    const { UpdateCardDetails } = await import('./cardDetails');
    await writer.run(SetAccountInclusion, { accountId: a, include: false }, 'user');
    await writer.run(ChangeAccountType, { accountId: a, type: 'card' }, 'user');
    expect(homeAccounts(await rows()).cardDuesMinor).toBe(450000);
    await writer.run(UpdateCardDetails, { accountId: a, statementDueMinor: 1000, dueDate: '2026-11-15', limitMinor: 5000 }, 'user');
    await writer.run(ChangeAccountType, { accountId: a, type: 'bank' }, 'user');
    const r = (await db.query('SELECT statement_due_minor, statement_due_date, credit_limit_minor, statement_set_at FROM account WHERE id = ?', [a]))[0]!;
    expect(r).toEqual([null, null, null, null]);
  });
});
