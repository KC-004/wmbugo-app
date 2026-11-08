import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { ok } from '../shared/result';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { runMigrations } from '../usecases/migrations';
import { FakeSqlDatabase } from '../usecases/fakes';
import { findRegion } from '../profile/regions';
import { ChangeProfile, ChangeSetting } from '../profile/settingsCommands';
import { SETTING_BLOCK_TRANSFERS_KEY } from '../profile/settings';
import { OutboxDispatcher, type HandlerMap } from '../writer/outbox';
import { LedgerWriter, type UseCase } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, assetTotal, mapAccountRows } from './accounts';
import { entryShape } from './entryCommands';
import { homeAccounts, pageActivity, type ActivityRow } from './readModels';
import { RecordTransfer } from './transferCommands';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const logger = createRedactingLogger({ write: () => undefined });
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(4)), logger, invariants: [openingBalanceShape, entryShape] });
  const setUp = (over: object = {}) =>
    writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore', ...over } as never, 'user');
  return { db, clock, logger, writer, setUp };
}

describe('payday and timezone are validated inside the use cases', () => {
  it('ChangeProfile refuses a payday day outside 1 to 31, a fraction, and an unknown kind', async () => {
    const { writer, setUp, db } = await setup();
    await setUp();
    for (const payday of [{ kind: 'day', day: 45 }, { kind: 'day', day: 0 }, { kind: 'day', day: 15.5 }, { kind: 'weekly' }]) {
      expect(await writer.run(ChangeProfile, { payday } as never, 'user')).toEqual({ ok: false, code: 'PAYDAY_INVALID' });
    }
    expect((await db.query('SELECT payday_rule FROM profile'))[0]![0]).toBe('first');
  });

  it('SetUpProfile refuses a bad payday and a bad timezone and writes nothing', async () => {
    const { setUp, db } = await setup();
    expect(await setUp({ payday: { kind: 'day', day: 99 } })).toEqual({ ok: false, code: 'PAYDAY_INVALID' });
    expect(await setUp({ timezoneId: 'Mars/Base' })).toEqual({ ok: false, code: 'TIMEZONE_INVALID' });
    expect(await db.query('SELECT 1 FROM profile')).toEqual([]);
  });
});

describe('strict transfers count the fee', () => {
  it('refuses 100 plus a fee of 5 from a balance of 100', async () => {
    const { writer, setUp, db } = await setup();
    await setUp();
    await writer.run(AddAccount, { name: 'A', type: 'bank', openingMinor: 10000 }, 'user');
    await writer.run(AddAccount, { name: 'B', type: 'cash', openingMinor: 0 }, 'user');
    const ids = (await db.query('SELECT id FROM account ORDER BY sort_order')).map((r) => r[0] as string);
    await writer.run(ChangeSetting, { key: SETTING_BLOCK_TRANSFERS_KEY, value: true }, 'user');
    const withFee = { amountMinor: 10000, fromAccountId: ids[0]!, toAccountId: ids[1]!, fee: { amountMinor: 500, categoryId: 'cat_other' } };
    expect(await writer.run(RecordTransfer, withFee, 'user')).toEqual({ ok: false, code: 'INSUFFICIENT_FUNDS' });
    expect((await writer.run(RecordTransfer, { ...withFee, fee: undefined }, 'user')).ok).toBe(true);
  });
});

describe('an Activity page never ends in the middle of a day', () => {
  const row = (id: string, localDate: string): ActivityRow => ({ id, kind: 'expense', amountMinor: 1, localDate, merchant: null, categoryName: null, categoryIcon: null, categoryColor: null, accountName: null });

  it('leaves a partly shown day for the next page', () => {
    const rows = [row('a', '2026-11-08'), row('b', '2026-11-07'), row('c', '2026-11-07'), row('d', '2026-11-07')];
    const p = pageActivity(rows, 3); // d (limit index 3) shares its day with b and c
    expect(p.hasMore).toBe(true);
    expect(p.rows.map((r) => r.id)).toEqual(['a']);
  });

  it('keeps a whole page when one day fills it, and says nothing is left when it all fits', () => {
    const rows = [row('a', '2026-11-08'), row('b', '2026-11-08'), row('c', '2026-11-08')];
    expect(pageActivity(rows, 2).rows).toHaveLength(2);
    expect(pageActivity(rows, 3)).toEqual({ rows, hasMore: false });
  });
});

describe('outbox order within one commit', () => {
  it('delivers events in the order the use case raised them', async () => {
    const { db, clock, logger, writer, setUp } = await setup();
    await setUp();
    const seen: string[] = [];
    const handlers: HandlerMap = { AccountsChanged: [() => void seen.push('accounts')], TransactionsChanged: [() => void seen.push('transactions')] };
    const both: UseCase<void, void, never> = {
      name: 'Both',
      async execute(ctx) {
        ctx.emit('AccountsChanged', { accountIds: [] });
        ctx.emit('TransactionsChanged', { transactionIds: [] });
        ctx.emit('AccountsChanged', { accountIds: [] });
        return ok(undefined);
      },
    };
    await db.query('UPDATE outbox SET delivered_at = 1');
    await writer.run(both, undefined, 'user');
    await new OutboxDispatcher({ db, clock, logger, handlers }).deliverPending();
    expect(seen).toEqual(['accounts', 'transactions', 'accounts']);
  });
});

describe('migrations notice a gap', () => {
  it('refuses a database whose applied versions skip one', async () => {
    const db = new FakeSqlDatabase();
    const m = (version: number) => ({ version, tag: `t${version}`, checksum: `c${version}`, statements: ['SELECT 1'] });
    db.tables.add('schema_migration');
    db.migrationRows.push({ version: 1, tag: 't1', checksum: 'c1', applied_at: 1 }, { version: 3, tag: 't3', checksum: 'c3', applied_at: 1 });
    const r = await runMigrations(db, [m(1), m(2), m(3)], () => 1);
    expect(r.ok).toBe(false);
  });
});

describe('include in overview', () => {
  it('an account switched out of the overview is not in the Home total', async () => {
    const { writer, setUp, db } = await setup();
    await setUp();
    await writer.run(AddAccount, { name: 'A', type: 'bank', openingMinor: 1000 }, 'user');
    await writer.run(AddAccount, { name: 'B', type: 'bank', openingMinor: 5000 }, 'user');
    await db.query("UPDATE account SET include_in_overview = 0 WHERE name = 'B'");
    const rows = mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
    expect(assetTotal(rows).minor).toBe(1000);
    expect(homeAccounts(rows).inAccountsMinor).toBe(1000);
  });
});
