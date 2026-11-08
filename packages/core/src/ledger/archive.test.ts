import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { ChangeSetting } from '../profile/settingsCommands';
import { parseSettings, SETTING_DEFAULT_ACCOUNT, SETTINGS_SQL } from '../profile/settings';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, ArchiveAccount, DeleteAccount, MoveAccount, NEEDS_REVIEW_COUNT_SQL, openingBalanceShape, RestoreAccount } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from './accounts';
import { accountGroups } from './balances';
import { entryShape, LAST_ACCOUNT_FOR_CATEGORY_SQL, RecordManualEntry } from './entryCommands';
import { ACTIVITY_SQL, homeAccounts, mapActivityRows, SPENT_EXPENSES_SQL } from './readModels';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(7)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
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
  const names = async () => (await rows()).filter((r) => r.status === 'active').map((r) => r.name);
  return { db, clock, writer, add, rows, names };
}

describe('archive, restore and delete (Story 2.9)', () => {
  it('archiving leaves both groups and the totals but keeps history in Activity and in the period totals', async () => {
    const { db, writer, add, rows, clock } = await setup();
    const sbi = await add('SBI', 'bank', 120000);
    await add('HDFC', 'bank', 3000000);
    const card = await add('HDFC Card', 'card', 410000);
    clock.advance(1000);
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 20000, categoryId: 'cat_food', accountId: sbi }, 'user');

    await writer.run(ArchiveAccount, { accountId: sbi }, 'user');
    await writer.run(ArchiveAccount, { accountId: card }, 'user');
    const all = await rows();
    expect(homeAccounts(all)).toMatchObject({ inAccountsMinor: 3000000, cardDuesMinor: null });
    const g = accountGroups(all);
    expect([...g.have.rows, ...g.owe.rows].map((r) => r.name)).toEqual(['HDFC']);
    expect(Number((await db.query(SPENT_EXPENSES_SQL, ['2026-11-01', '2026-11-30']))[0]![0])).toBe(20000);
    expect(mapActivityRows(await db.query(ACTIVITY_SQL, [100]))).toHaveLength(1);
    expect(all.find((r) => r.id === sbi)).toMatchObject({ status: 'archived', postingsMinor: 100000 });
  });

  it('archiving the Settings default account sets the default back to None', async () => {
    const { db, writer, add } = await setup();
    const sbi = await add('SBI', 'bank', 100);
    await writer.run(ChangeSetting, { key: SETTING_DEFAULT_ACCOUNT, value: sbi }, 'user');
    expect(parseSettings(await db.query(SETTINGS_SQL)).defaultAccountId).toBe(sbi);
    await writer.run(ArchiveAccount, { accountId: sbi }, 'user');
    expect(parseSettings(await db.query(SETTINGS_SQL)).defaultAccountId).toBeNull();
  });

  it('an archived account is skipped as the remembered account for a category', async () => {
    const { db, writer, add, clock } = await setup();
    const sbi = await add('SBI', 'bank', 100);
    clock.advance(1000);
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 1, categoryId: 'cat_food', accountId: sbi }, 'user');
    expect((await db.query(LAST_ACCOUNT_FOR_CATEGORY_SQL, ['cat_food'])).length).toBe(1);
    await writer.run(ArchiveAccount, { accountId: sbi }, 'user');
    expect((await db.query(LAST_ACCOUNT_FOR_CATEGORY_SQL, ['cat_food'])).length).toBe(0);
  });

  it('restore returns the account to its previous place; its group follows its type', async () => {
    const { writer, add, names } = await setup();
    await add('A', 'bank', 1);
    const b = await add('B', 'bank', 1);
    await add('C', 'bank', 1);
    await add('D', 'card', 1);
    await writer.run(ArchiveAccount, { accountId: b }, 'user');
    expect(await names()).toEqual(['A', 'C', 'D']);
    await writer.run(RestoreAccount, { accountId: b }, 'user');
    expect(await names()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('restore after the others were moved keeps the order dense and sensible', async () => {
    const { writer, add, names, rows } = await setup();
    const a = await add('A', 'bank', 1);
    const b = await add('B', 'bank', 1);
    await add('C', 'bank', 1);
    await writer.run(ArchiveAccount, { accountId: a }, 'user');
    const c = (await rows()).find((r) => r.name === 'C')!;
    await writer.run(MoveAccount, { accountId: c.id, direction: 'up' }, 'user');
    expect(await names()).toEqual(['C', 'B']);
    await writer.run(RestoreAccount, { accountId: a }, 'user');
    expect((await rows()).map((r) => r.sortOrder).sort()).toEqual([0, 1, 2]);
    expect(await names()).toContain('A');
    void b;
  });

  it('counts entries waiting for review on an account', async () => {
    const { db, add } = await setup();
    const a = await add('SBI', 'bank', 100);
    expect(Number((await db.query(NEEDS_REVIEW_COUNT_SQL, [a]))[0]![0])).toBe(0);
  });

  it('DeleteAccount removes an account that never held anything, with an audit row', async () => {
    const { db, writer, add, rows } = await setup();
    const empty = await add('Mistake', 'cash', null);
    expect((await rows())[0]!.postingCount).toBe(0);
    expect(await writer.run(DeleteAccount, { accountId: empty }, 'user')).toEqual({ ok: true, value: undefined });
    expect(await rows()).toHaveLength(0);
    expect(Number((await db.query('SELECT COUNT(*) FROM audit_event WHERE entity_id = ?', [empty]))[0]![0])).toBeGreaterThanOrEqual(2);
  });

  it('DeleteAccount refuses any account with a posting (an opening balance counts) and writes nothing', async () => {
    const { db, writer, add, rows } = await setup();
    const a = await add('SBI', 'bank', 100);
    const before = Number((await db.query('SELECT COUNT(*) FROM audit_event'))[0]![0]);
    expect(await writer.run(DeleteAccount, { accountId: a }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_HAS_POSTINGS' });
    expect(await writer.run(DeleteAccount, { accountId: 'nope' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await rows()).toHaveLength(1);
    expect(Number((await db.query('SELECT COUNT(*) FROM audit_event'))[0]![0])).toBe(before);
    expect((await rows())[0]!.postingCount).toBe(1);
  });

  it('deleting the Settings default clears it', async () => {
    const { db, writer, add } = await setup();
    const a = await add('Mistake', 'cash', null);
    await writer.run(ChangeSetting, { key: SETTING_DEFAULT_ACCOUNT, value: a }, 'user');
    await writer.run(DeleteAccount, { accountId: a }, 'user');
    expect(parseSettings(await db.query(SETTINGS_SQL)).defaultAccountId).toBeNull();
  });
});

describe('review fixes (Epic 2)', () => {
  it('archiving leaves an entry waiting for review untouched', async () => {
    const { db, writer, add, clock } = await setup();
    const a = await add('SBI', 'bank', 100000);
    clock.advance(1000);
    const r = await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 500, categoryId: 'cat_food', accountId: a }, 'user');
    if (!r.ok) throw new Error('entry');
    db.raw.prepare('UPDATE "transaction" SET status = ? WHERE id = ?').run('needs_review', r.value.transactionId);
    expect(Number((await db.query(NEEDS_REVIEW_COUNT_SQL, [a]))[0]![0])).toBe(1);
    await writer.run(ArchiveAccount, { accountId: a }, 'user');
    expect(Number((await db.query(NEEDS_REVIEW_COUNT_SQL, [a]))[0]![0])).toBe(1);
    expect(String((await db.query('SELECT status FROM "transaction" WHERE id = ?', [r.value.transactionId]))[0]![0])).toBe('needs_review');
  });

  it('restoring an account that is already active changes nothing', async () => {
    const { writer, add, rows } = await setup();
    const a = await add('A', 'bank', 1);
    await add('B', 'bank', 1);
    const before = (await rows()).map((r) => [r.name, r.sortOrder]);
    expect(await writer.run(RestoreAccount, { accountId: a }, 'user')).toEqual({ ok: true, value: undefined });
    expect((await rows()).map((r) => [r.name, r.sortOrder])).toEqual(before);
  });
});
