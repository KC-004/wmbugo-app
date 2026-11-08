import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { accountGroups } from './balances';
import { CARD_DETAILS_SQL, mapCardDetails, statementStatus, UpdateCardDetails } from './cardDetails';
import { entryShape } from './entryCommands';
import { homeAccounts } from './readModels';
import { RecordTransfer } from './transferCommands';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(2)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const details = async (id: string) => mapCardDetails(await db.query(CARD_DETAILS_SQL, [id]))!;
  return { db, clock, writer, add, details };
}

describe('UpdateCardDetails (Story 2.6)', () => {
  it('stores statement due, due date and limit; clearing a field removes it', async () => {
    const { writer, add, details } = await setup();
    const card = await add('HDFC Card', 'card', 1245000);
    expect(await writer.run(UpdateCardDetails, { accountId: card, statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: 10000000 }, 'user')).toEqual({ ok: true, value: undefined });
    expect(await details(card)).toMatchObject({ statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: 10000000 });
    await writer.run(UpdateCardDetails, { accountId: card, statementDueMinor: null, dueDate: null, limitMinor: 10000000 }, 'user');
    expect(await details(card)).toMatchObject({ statementDueMinor: null, dueDate: null, limitMinor: 10000000 });
  });

  it('refuses zero amounts, a bad date, a non-card and an unknown account; nothing changes', async () => {
    const { writer, add, details } = await setup();
    const card = await add('Visa', 'card', 1000);
    const bank = await add('HDFC', 'bank', 1000);
    const base = { statementDueMinor: null, dueDate: null, limitMinor: null };
    expect(await writer.run(UpdateCardDetails, { accountId: card, ...base, limitMinor: 0 }, 'user')).toEqual({ ok: false, code: 'LIMIT_INVALID' });
    expect(await writer.run(UpdateCardDetails, { accountId: card, ...base, statementDueMinor: 0 }, 'user')).toEqual({ ok: false, code: 'STATEMENT_INVALID' });
    expect(await writer.run(UpdateCardDetails, { accountId: card, ...base, dueDate: '2026-02-31' }, 'user')).toEqual({ ok: false, code: 'DATE_INVALID' });
    expect(await writer.run(UpdateCardDetails, { accountId: bank, ...base, limitMinor: 5 }, 'user')).toEqual({ ok: false, code: 'NOT_A_CARD' });
    expect(await writer.run(UpdateCardDetails, { accountId: 'nope', ...base }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await details(card)).toMatchObject({ statementDueMinor: null, limitMinor: null });
  });

  it('the limit and the statement amount never enter In accounts, Card dues, the groups or net worth', async () => {
    const { db, writer, add } = await setup();
    const card = await add('HDFC Card', 'card', 1245000);
    await add('HDFC', 'bank', 3000000);
    const read = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
    const before = [homeAccounts(await read()), accountGroups(await read())];
    await writer.run(UpdateCardDetails, { accountId: card, statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: 10000000 }, 'user');
    expect([homeAccounts(await read()), accountGroups(await read())]).toEqual(before);
    expect(homeAccounts(await read())).toMatchObject({ inAccountsMinor: 3000000, cardDuesMinor: 1245000 });
    expect(accountGroups(await read()).netWorth).toEqual({ kind: 'net', minor: 1755000 });
  });

  it('payments to the card after the statement was entered count toward "paid"; earlier ones do not', async () => {
    const { writer, clock, add, details } = await setup();
    const card = await add('HDFC Card', 'card', 1245000);
    const bank = await add('HDFC', 'bank', 3000000);
    await writer.run(RecordTransfer, { amountMinor: 100000, fromAccountId: bank, toAccountId: card }, 'user'); // before the statement
    clock.advance(1000);
    await writer.run(UpdateCardDetails, { accountId: card, statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: null }, 'user');
    expect((await details(card)).paidSinceMinor).toBe(0);
    clock.advance(1000);
    await writer.run(RecordTransfer, { amountMinor: 500000, fromAccountId: bank, toAccountId: card }, 'user');
    expect((await details(card)).paidSinceMinor).toBe(500000);
    clock.advance(1000);
    await writer.run(RecordTransfer, { amountMinor: 320000, fromAccountId: bank, toAccountId: card }, 'user');
    const d = await details(card);
    expect(statementStatus(d, '2026-11-10')).toEqual({ kind: 'paid', amountMinor: 820000 });
  });
});

describe('statementStatus', () => {
  const d = (over: object = {}) => ({ statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: null, paidSinceMinor: 0, ...over });
  it('none, due, overdue and paid', () => {
    expect(statementStatus(d({ statementDueMinor: null, dueDate: null }), '2026-11-08')).toEqual({ kind: 'none' });
    expect(statementStatus(d(), '2026-11-15')).toEqual({ kind: 'due', amountMinor: 820000, dueDate: '2026-11-15' });
    expect(statementStatus(d(), '2026-11-16')).toEqual({ kind: 'overdue', amountMinor: 820000, dueDate: '2026-11-15' });
    expect(statementStatus(d({ paidSinceMinor: 820000 }), '2026-12-01')).toEqual({ kind: 'paid', amountMinor: 820000 });
    expect(statementStatus(d({ statementDueMinor: null }), '2026-11-08')).toEqual({ kind: 'due', amountMinor: null, dueDate: '2026-11-15' });
  });
});
