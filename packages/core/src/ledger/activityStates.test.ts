import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import type { AccountType } from './accounts';
import { entryShape } from './entryCommands';
import { activitySql, groupByDay, mapActivityRows, REVIEW_COUNT_SQL, rowState, type ActivityRow } from './readModels';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const HOUR = 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(21)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  const add = async (name: string, type: AccountType, openingMinor: number | null) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('add');
    return a.value.accountId;
  };
  let n = 0;
  /** A transaction written the way a later source would write it (refund, waiting, reversed ...). */
  const raw = (o: { id: string; type: string; status: string; amount: number; account: string; direction: 'in' | 'out'; extra?: string; category?: string }) => {
    const signed = o.direction === 'in' ? o.amount : -o.amount;
    db.raw.exec(`INSERT INTO "transaction" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,tags_json,needs_category,created_at,updated_at${o.extra ? ',' + o.extra.split('=')[0] : ''}) VALUES ('${o.id}','${o.type}','${o.status}',${o.amount},${NOW + 2 * HOUR},'2026-11-08','Asia/Kolkata','[]',0,1,1${o.extra ? ',' + o.extra.split('=')[1] : ''})`);
    db.raw.exec(`INSERT INTO posting (id,transaction_id,account_id,direction,signed_amount_minor,posting_kind) VALUES ('p-${o.id}','${o.id}','${o.account}','${o.direction}',${signed},'normal')`);
    db.raw.exec(`INSERT INTO split (id,transaction_id,category_id,amount_minor) VALUES ('s-${o.id}','${o.id}','${o.category ?? 'cat_transport'}',${o.amount})`);
    db.raw.exec(`INSERT INTO source_record (id,transaction_id,source_kind,fingerprint,created_at) VALUES ('sr-${o.id}','${o.id}','manual','fp-${o.id}-${++n}',1)`);
  };
  const rows = async (filter: { accountId?: string } = {}) => mapActivityRows(await db.query(activitySql(filter), filter.accountId ? [filter.accountId, 100] : [100]));
  return { db, clock, writer, add, raw, rows };
}

describe('the day header Spent (Story 3.5)', () => {
  it('a day with ₹1,500 fuel, a ₹1,299 refund, a ₹5,000 transfer, ₹85,000 salary and a ₹300 entry still waiting reads Spent ₹201', async () => {
    const { clock, writer, add, raw, rows } = await setup();
    const hdfc = await add('HDFC', 'bank', 10_000_000);
    const cash = await add('Cash', 'cash', 0);
    clock.advance(HOUR);
    await recordEntry(writer, { kind: 'expense', amountMinor: 150_000, categoryId: 'cat_transport', accountId: hdfc, merchant: 'Fuel' });
    await recordEntry(writer, { kind: 'income', amountMinor: 8_500_000, categoryId: 'cat_in_salary', accountId: hdfc });
    await recordTransfer(writer, { amountMinor: 500_000, fromAccountId: hdfc, toAccountId: cash });
    raw({ id: 'refund', type: 'refund', status: 'confirmed', amount: 129_900, account: hdfc, direction: 'in' });
    raw({ id: 'waiting', type: 'expense', status: 'needs_review', amount: 30_000, account: hdfc, direction: 'out' });
    const days = groupByDay(await rows());
    expect(days).toHaveLength(1);
    expect(days[0]!.spentMinor).toBe(20_100);
    expect(days[0]!.rows.map((r) => rowState(r)).sort()).toEqual(['expense', 'income', 'refund', 'transfer', 'waiting']);
  });

  it('a day whose only entry is a refund reads Spent ₹0; possible duplicates, reversed and removed entries count nowhere', async () => {
    const { db, add, raw, rows } = await setup();
    const a = await add('HDFC', 'bank', 1_000_000);
    raw({ id: 'refund', type: 'refund', status: 'confirmed', amount: 129_900, account: a, direction: 'in' });
    raw({ id: 'rev', type: 'expense', status: 'reversed', amount: 50_000, account: a, direction: 'out' });
    raw({ id: 'dup', type: 'expense', status: 'needs_review', amount: 70_000, account: a, direction: 'out' });
    db.raw.exec("INSERT INTO review_candidate (id,transaction_id,matched_transaction_id,reason,status,created_at) VALUES ('rc','dup','refund','duplicate','open',1)");
    raw({ id: 'gone', type: 'expense', status: 'excluded', amount: 99_000, account: a, direction: 'out' });
    db.raw.exec("UPDATE \"transaction\" SET removed_at = 5, removal_kind = 'deleted' WHERE id = 'gone'");
    const r = await rows();
    expect(r.map((x) => x.id).sort()).toEqual(['dup', 'refund', 'rev']);
    expect(groupByDay(r)[0]!.spentMinor).toBe(0);
    expect(r.map((x) => [x.id, rowState(x)]).sort()).toEqual([['dup', 'check'], ['refund', 'refund'], ['rev', 'reversed']]);
  });

  it('an account filter limits the rows and the day Spent to that account (both sides of a transfer)', async () => {
    const { clock, writer, add, rows } = await setup();
    const hdfc = await add('HDFC', 'bank', 10_000_000);
    const cash = await add('Cash', 'cash', 1_000_000);
    clock.advance(HOUR);
    await recordEntry(writer, { kind: 'expense', amountMinor: 100_000, categoryId: 'cat_food', accountId: hdfc });
    await recordEntry(writer, { kind: 'expense', amountMinor: 25_000, categoryId: 'cat_food', accountId: cash });
    await recordTransfer(writer, { amountMinor: 10_000, fromAccountId: hdfc, toAccountId: cash });
    expect(groupByDay(await rows())[0]!.spentMinor).toBe(125_000);
    const onHdfc = await rows({ accountId: hdfc });
    expect(groupByDay(onHdfc)[0]!.spentMinor).toBe(100_000);
    expect(onHdfc.map((r) => r.kind).sort()).toEqual(['expense', 'transfer']);
    const onCash = await rows({ accountId: cash });
    expect(groupByDay(onCash)[0]!.spentMinor).toBe(25_000);
    expect(onCash.map((r) => r.kind).sort()).toEqual(['expense', 'transfer']);
  });
});

describe('row states (UX-DR29)', () => {
  const base: ActivityRow = { id: 'x', kind: 'expense', amountMinor: 100, localDate: '2026-11-08', merchant: null, categoryName: null, categoryIcon: null, categoryColor: null, accountName: null };
  it('maps every flag to a state, most important first', () => {
    expect(rowState({ ...base, reversed: true, held: true })).toBe('reversed');
    expect(rowState({ ...base, held: true })).toBe('check');
    expect(rowState({ ...base, waiting: true, foreign: { currency: 'USD', amountMinor: 1299 } })).toBe('currency');
    expect(rowState({ ...base, waiting: true })).toBe('waiting');
    expect(rowState({ ...base, needsCategory: true })).toBe('needs-category');
    expect(rowState({ ...base, guessed: true })).toBe('guessed');
    expect(rowState({ ...base, kind: 'refund' })).toBe('refund');
    expect(rowState({ ...base, kind: 'transfer' })).toBe('transfer');
    expect(rowState({ ...base, kind: 'income' })).toBe('income');
    expect(rowState(base)).toBe('expense');
    expect(rowState({ ...base, kind: 'adjustment' })).toBe('adjustment');
  });

  it('reads the flags from the stored columns: needs a category, guessed, foreign amount', async () => {
    const { db, add, raw, rows } = await setup();
    const a = await add('HDFC', 'bank', 1_000_000);
    raw({ id: 'nc', type: 'expense', status: 'confirmed', amount: 1000, account: a, direction: 'out' });
    db.raw.exec("UPDATE \"transaction\" SET needs_category = 1 WHERE id = 'nc'");
    raw({ id: 'g', type: 'expense', status: 'confirmed', amount: 2000, account: a, direction: 'out', extra: "capture_resolution='auto_approved'" });
    raw({ id: 'fx', type: 'expense', status: 'needs_review', amount: 3000, account: a, direction: 'out' });
    db.raw.exec("UPDATE \"transaction\" SET foreign_currency = 'USD', foreign_amount_minor = 1299, foreign_currency_exponent = 2 WHERE id = 'fx'");
    const states = Object.fromEntries((await rows()).map((r) => [r.id, rowState(r)]));
    expect(states).toMatchObject({ nc: 'needs-category', g: 'guessed', fx: 'currency' });
    expect((await rows()).find((r) => r.id === 'fx')!.foreign).toEqual({ currency: 'USD', amountMinor: 1299 });
  });
});

describe('the Activity tab dot', () => {
  it('counts entries waiting for the user and goes away when none remain', async () => {
    const { db, add, raw } = await setup();
    const a = await add('HDFC', 'bank', 1_000_000);
    const count = async () => Number((await db.query(REVIEW_COUNT_SQL))[0]![0]);
    expect(await count()).toBe(0);
    raw({ id: 'w1', type: 'expense', status: 'needs_review', amount: 100, account: a, direction: 'out' });
    expect(await count()).toBe(1);
    db.raw.exec("UPDATE \"transaction\" SET status = 'confirmed' WHERE id = 'w1'");
    expect(await count()).toBe(0);
  });
});
