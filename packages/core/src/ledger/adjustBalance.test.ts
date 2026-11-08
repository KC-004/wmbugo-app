import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { AdjustBalance, adjustmentDelta, ADJUST_REASONS } from './adjustBalance';
import { entryShape, RecordManualEntry, RemoveEntry } from './entryCommands';
import { ACTIVITY_SQL, homeAccounts, INCOME_SQL, mapActivityRows, SPENT_EXPENSES_SQL } from './readModels';
import { ACCOUNT_TIMELINE_SQL, mapTimelineRows } from './timeline';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(6)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const account = async (id: string) => mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((x) => x.id === id)!;
  return { db, clock, writer, add, account };
}

describe('AdjustBalance (Story 2.5)', () => {
  it('HDFC 30,000 told it is really 31,200: one adjustment of +1,200, the opening posting untouched, balance 31,200', async () => {
    const { db, clock, writer, add, account } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    clock.advance(1000);
    const r = await writer.run(AdjustBalance, { accountId: hdfc, actualMinor: 3120000, reason: 'rough' }, 'user');
    expect(r.ok && r.value.deltaMinor).toBe(120000);
    expect((await account(hdfc)).postingsMinor).toBe(3120000);

    const rows = await db.query('SELECT p.posting_kind, p.signed_amount_minor, p.direction, t.event_type, t.amount_minor, t.occurred_at_utc, t.note FROM posting p JOIN "transaction" t ON t.id = p.transaction_id WHERE p.account_id = ? ORDER BY t.created_at', [hdfc]);
    expect(rows.map((x) => [x[0], Number(x[1])])).toEqual([['opening_balance', 3000000], ['adjustment', 120000]]);
    expect([rows[1]![2], rows[1]![3], Number(rows[1]![4]), Number(rows[1]![5]), rows[1]![6]]).toEqual(['in', 'adjustment', 120000, NOW + 1000, 'Starting balance was rough']);
    expect(Number((await db.query('SELECT opening_minor FROM account WHERE id = ?', [hdfc]))[0]![0])).toBe(3000000);
    const events = (await db.query('SELECT event FROM outbox ORDER BY created_at DESC, rowid DESC LIMIT 2')).map((x) => String(x[0])).sort();
    expect(events).toEqual(['AccountsChanged', 'TransactionsChanged']);
  });

  it('Cash 2,300 counted as 1,900: the posting is -400, Spent and income do not move, nothing appears as an expense', async () => {
    const { db, writer, add, account } = await setup();
    const cash = await add('Cash', 'cash', 230000);
    const r = await writer.run(AdjustBalance, { accountId: cash, actualMinor: 190000, reason: 'missed' }, 'user');
    expect(r.ok && r.value.deltaMinor).toBe(-40000);
    expect((await account(cash)).postingsMinor).toBe(190000);
    const range: [string, string] = ['2026-11-01', '2026-11-30'];
    expect(Number((await db.query(SPENT_EXPENSES_SQL, range))[0]![0])).toBe(0);
    expect(Number((await db.query(INCOME_SQL, range))[0]![0])).toBe(0);
  });

  it('a card owing 4,100 whose statement says 4,350: the posting is -250 and Card dues reads 4,350', async () => {
    const { writer, add, account } = await setup();
    const card = await add('HDFC Card', 'card', 410000);
    const r = await writer.run(AdjustBalance, { accountId: card, actualMinor: 435000, reason: 'charges' }, 'user');
    expect(r.ok && r.value.deltaMinor).toBe(-25000);
    const row = await account(card);
    expect(homeAccounts([row]).cardDuesMinor).toBe(435000);
  });

  it('the same amount writes nothing (NO_CHANGE); a not-set account, bad amount, bad reason and long note are refused', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 100000);
    const bare = await add('Cash', 'cash', null);
    const before = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    expect(await writer.run(AdjustBalance, { accountId: a, actualMinor: 100000, reason: 'rough' }, 'user')).toEqual({ ok: false, code: 'NO_CHANGE' });
    expect(await writer.run(AdjustBalance, { accountId: bare, actualMinor: 5, reason: 'rough' }, 'user')).toEqual({ ok: false, code: 'BALANCE_NOT_SET' });
    expect(await writer.run(AdjustBalance, { accountId: a, actualMinor: -1, reason: 'rough' }, 'user')).toEqual({ ok: false, code: 'AMOUNT_NEGATIVE' });
    expect(await writer.run(AdjustBalance, { accountId: a, actualMinor: 1.5, reason: 'rough' }, 'user')).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(await writer.run(AdjustBalance, { accountId: a, actualMinor: 5, reason: 'nope' as never }, 'user')).toEqual({ ok: false, code: 'REASON_INVALID' });
    expect(await writer.run(AdjustBalance, { accountId: a, actualMinor: 5, reason: 'other', note: 'x'.repeat(201) }, 'user')).toEqual({ ok: false, code: 'NOTE_TOO_LONG' });
    expect(await writer.run(AdjustBalance, { accountId: 'nope', actualMinor: 5, reason: 'rough' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(before);
  });

  it('Other keeps the note as the reason text', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 100000);
    await writer.run(AdjustBalance, { accountId: a, actualMinor: 90000, reason: 'other', note: ' Lent to Sam ' }, 'user');
    expect(String((await db.query("SELECT note FROM \"transaction\" WHERE event_type = 'adjustment'"))[0]![0])).toBe('Lent to Sam');
  });

  it('Undo (RemoveEntry) takes the adjustment back out of the balance', async () => {
    const { writer, add, account } = await setup();
    const a = await add('HDFC', 'bank', 100000);
    const r = await writer.run(AdjustBalance, { accountId: a, actualMinor: 150000, reason: 'rough' }, 'user');
    if (!r.ok) throw new Error('adjust');
    await writer.run(RemoveEntry, { transactionId: r.value.transactionId }, 'user');
    expect((await account(a)).postingsMinor).toBe(100000);
  });

  it('Activity and the account timeline show it as an adjustment with its direction, never spent', async () => {
    const { db, clock, writer, add } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    const cash = await add('Cash', 'cash', 230000);
    clock.advance(1000);
    await writer.run(AdjustBalance, { accountId: hdfc, actualMinor: 3120000, reason: 'rough' }, 'user');
    await writer.run(AdjustBalance, { accountId: cash, actualMinor: 190000, reason: 'missed' }, 'user');
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 1000, categoryId: 'cat_food', accountId: cash }, 'user');

    const rows = mapActivityRows(await db.query(ACTIVITY_SQL, [100]));
    const adj = rows.filter((r) => r.kind === 'adjustment').map((r) => [r.amountMinor, r.signedMinor, r.accountName, r.beforeTracking]);
    expect(adj).toEqual(expect.arrayContaining([[120000, 120000, 'HDFC', false], [40000, -40000, 'Cash', false]]));
    const t = mapTimelineRows(await db.query(ACCOUNT_TIMELINE_SQL, [cash, cash, 100]));
    expect(t.map((r) => [r.kind, r.signedMinor])).toEqual(expect.arrayContaining([['adjustment', -40000], ['expense', -1000]]));
  });

  it('delta helper and the offered reasons', () => {
    expect(adjustmentDelta('bank', 3000000, 3120000)).toBe(120000);
    expect(adjustmentDelta('cash', 230000, 190000)).toBe(-40000);
    expect(adjustmentDelta('card', -410000, 435000)).toBe(-25000);
    expect(adjustmentDelta('card', -410000, 410000)).toBe(0);
    expect(ADJUST_REASONS.map((r) => r.label)).toEqual(['Starting balance was rough', 'Missed some entries', 'Bank charges or interest', 'Other']);
  });
});

describe('review fixes (Epic 2)', () => {
  it('an archived account cannot be adjusted, and a note is kept with any reason', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 100000);
    await writer.run(AdjustBalance, { accountId: a, actualMinor: 90000, reason: 'missed', note: 'cafe' }, 'user');
    expect(String((await db.query("SELECT note FROM \"transaction\" WHERE event_type = 'adjustment'"))[0]![0])).toBe('Missed some entries · cafe');
    const { ArchiveAccount } = await import('./accountCommands');
    await writer.run(ArchiveAccount, { accountId: a }, 'user');
    expect(await writer.run(AdjustBalance, { accountId: a, actualMinor: 1, reason: 'rough' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_ARCHIVED' });
  });
});
