import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { entryShape } from './entryCommands';
import { ACTIVITY_SQL, mapActivityRows, pageActivity } from './readModels';
import { ACCOUNT_START_SQL, ACCOUNT_TIMELINE_SQL, mapTimelineRows } from './timeline';
import { OTHER_CATEGORY_ID } from './transferCommands';
import { recordEntry, recordTransfer } from '../testing/capture';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const DAY = 86_400_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(3)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  const timeline = async (id: string, limit = 100) => mapTimelineRows(await db.query(ACCOUNT_TIMELINE_SQL, [id, id, limit + 1]));
  const balance = async (id: string) => mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((a) => a.id === id)!;
  return { db, clock, writer, add, timeline, balance };
}

describe('account timeline (Story 2.3)', () => {
  it('lists every entry that touched the account, newest first; a transfer is one leg each side, a fee is its own expense', async () => {
    const { writer, clock, add, timeline } = await setup();
    const hdfc = await add('HDFC', 'bank', 3000000);
    const cash = await add('Cash', 'cash', 100000);
    clock.advance(DAY);
    await recordEntry(writer, { kind: 'expense', amountMinor: 45000, categoryId: 'cat_food', accountId: hdfc });
    clock.advance(1000);
    await recordEntry(writer, { kind: 'income', amountMinor: 500000, categoryId: 'cat_in_salary', accountId: hdfc });
    clock.advance(1000);
    await recordTransfer(writer, { amountMinor: 20000, fromAccountId: hdfc, toAccountId: cash, fee: { amountMinor: 500, categoryId: OTHER_CATEGORY_ID } });

    const h = await timeline(hdfc);
    expect(h.map((r) => [r.kind, r.signedMinor, r.accountName])).toEqual([
      ['expense', -500, null], // the fee
      ['transfer', -20000, 'Cash'],
      ['income', 500000, null],
      ['expense', -45000, null],
    ]);
    const c = await timeline(cash);
    expect(c.map((r) => [r.kind, r.signedMinor, r.accountName])).toEqual([['transfer', 20000, 'HDFC']]);
  });

  it('an entry dated before the tracking start is flagged, leaves the balance alone, and the opening is not in the list', async () => {
    const { writer, clock, add, timeline, balance } = await setup();
    const cash = await add('Cash', 'cash', 100000);
    await recordEntry(writer, { kind: 'expense', amountMinor: 30000, categoryId: 'cat_food', accountId: cash, occurredAtMs: clock.nowMs() - 3 * DAY });
    await recordEntry(writer, { kind: 'expense', amountMinor: 10000, categoryId: 'cat_food', accountId: cash, occurredAtMs: clock.nowMs() + 1000 });
    const rows = await timeline(cash);
    expect(rows.map((r) => [r.amountMinor, r.beforeTracking])).toEqual([[10000, false], [30000, true]]);
    expect((await balance(cash)).postingsMinor).toBe(90000);
    expect(rows.some((r) => r.kind === ('opening_balance' as never))).toBe(false);
  });

  it('Activity flags the same entry, and an entry on an account with no opening is never "before"', async () => {
    const { db, writer, clock, add } = await setup();
    const cash = await add('Cash', 'cash', 100000);
    const bare = await add('Wallet', 'wallet', null);
    await recordEntry(writer, { kind: 'expense', amountMinor: 30000, categoryId: 'cat_food', accountId: cash, occurredAtMs: clock.nowMs() - 3 * DAY });
    await recordEntry(writer, { kind: 'expense', amountMinor: 7000, categoryId: 'cat_food', accountId: bare, occurredAtMs: clock.nowMs() - 3 * DAY });
    const rows = pageActivity(mapActivityRows(await db.query(ACTIVITY_SQL, [101])), 100).rows;
    expect(rows.map((r) => [r.amountMinor, r.beforeTracking])).toEqual(expect.arrayContaining([[30000, true], [7000, false]]));
  });

  it('pages: asking for one more than the page tells the caller there are earlier entries', async () => {
    const { writer, clock, add, timeline } = await setup();
    const a = await add('A', 'bank', 0);
    for (let i = 0; i < 5; i++) {
      clock.advance(1000);
      await recordEntry(writer, { kind: 'expense', amountMinor: 100 + i, categoryId: 'cat_food', accountId: a });
    }
    expect(await timeline(a, 3)).toHaveLength(4);
    expect(await timeline(a, 10)).toHaveLength(5);
  });

  it('the starting balance reads from the account, and a not-set account has none', async () => {
    const { db, add } = await setup();
    const a = await add('HDFC', 'bank', 3000000);
    const bare = await add('Cash', 'cash', null);
    const r = (await db.query(ACCOUNT_START_SQL, [a]))[0]!;
    expect(Number(r[0])).toBe(3000000);
    expect(Number(r[1])).toBeGreaterThan(0);
    expect(await db.query(ACCOUNT_START_SQL, [bare])).toHaveLength(0);
  });
});
