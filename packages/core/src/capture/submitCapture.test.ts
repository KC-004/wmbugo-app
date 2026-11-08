import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { entryInput, recordEntry, recordTransfer, transferInput } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { AdjustBalance } from '../ledger/adjustBalance';
import { ACCOUNT_LIST_SQL, mapAccountRows, type AccountType } from '../ledger/accounts';
import { entryShape, RemoveEntry } from '../ledger/entryCommands';
import { ACTIVITY_SQL, homeAccounts, mapActivityRows, SPENT_EXPENSES_SQL, INCOME_SQL } from '../ledger/readModels';
import { OTHER_CATEGORY_ID } from '../ledger/transferCommands';
import { SubmitCapture } from './submitCapture';
import { CAPTURE_STATES, captureStateOf, captureStateOfResult, captureStatusLabel, CAPTURE_LABEL_KEYS } from './statusLabel';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const MIN = 60_000;
const PERIOD: [string, string] = ['2026-11-01', '2026-11-30'];

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(11)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
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
  const events = async () => (await db.query('SELECT event FROM outbox ORDER BY created_at, rowid')).map((r) => String(r[0]));
  return { db, clock, writer, add, rows, events };
}

describe('SubmitCapture (Story 3.2)', () => {
  it('a manual save is confirmed as user_approved, with one manual source_record, audit and events in the same commit', async () => {
    const { db, writer, add, events } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: 45000, categoryId: 'cat_food', accountId: a, merchant: 'Swiggy' });
    expect(r).toMatchObject({ ok: true, value: { result: 'RECORDED', accountId: a, feeTransactionId: null } });
    const id = r.ok ? r.value.transactionId : '';
    const t = (await db.query('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', [id]))[0]!;
    expect([t[0], t[1]]).toEqual(['confirmed', 'user_approved']);
    expect((await db.query('SELECT source_kind FROM source_record WHERE transaction_id = ?', [id])).map((x) => x[0])).toEqual(['manual']);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE entity_id = ?", [id]))[0]![0])).toBeGreaterThanOrEqual(1);
    const ev = await events();
    expect(ev).toEqual(expect.arrayContaining(['TransactionsChanged', 'CapturesSubmitted']));
  });

  it('submitting the same id again returns the existing transaction as ALREADY_SUBMITTED and writes nothing', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const input = entryInput({ kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: a }, 'sub-1');
    const first = await writer.run(SubmitCapture, input, 'user');
    const count = async (t: string) => Number((await db.query(`SELECT COUNT(*) FROM ${t}`))[0]![0]);
    const before = [await count('"transaction"'), await count('posting'), await count('split'), await count('source_record'), await count('outbox')];
    const again = await writer.run(SubmitCapture, input, 'user');
    expect(first.ok && again.ok && again.value.transactionId === first.value.transactionId).toBe(true);
    expect(again).toMatchObject({ ok: true, value: { result: 'ALREADY_SUBMITTED' } });
    // No ledger row, no source record and no event: the retry leaves only the writer's placeholder audit row.
    expect([await count('"transaction"'), await count('posting'), await count('split'), await count('source_record'), await count('outbox')]).toEqual(before);
  });

  it('a transfer and its fee are submitted in one call: both get a source record, and a retry returns both', async () => {
    const { db, writer, add } = await setup();
    const hdfc = await add('HDFC', 'bank', 1000000);
    const cash = await add('Cash', 'cash', 0);
    const input = transferInput({ amountMinor: 20000, fromAccountId: hdfc, toAccountId: cash, fee: { amountMinor: 500, categoryId: OTHER_CATEGORY_ID } }, 'sub-t');
    const r = await writer.run(SubmitCapture, input, 'user');
    if (!r.ok) throw new Error('transfer');
    expect(r.value.feeTransactionId).not.toBeNull();
    expect(Number((await db.query("SELECT COUNT(*) FROM source_record WHERE source_kind = 'manual'"))[0]![0])).toBe(2);
    const again = await writer.run(SubmitCapture, input, 'user');
    expect(again).toMatchObject({ ok: true, value: { result: 'ALREADY_SUBMITTED', transactionId: r.value.transactionId, feeTransactionId: r.value.feeTransactionId } });
  });

  it('every transaction a capture creates has a source_record', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    const b = await add('Cash', 'cash', 0);
    await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: a });
    await recordEntry(writer, { kind: 'income', amountMinor: 900, categoryId: 'cat_in_salary', accountId: a });
    await recordTransfer(writer, { amountMinor: 50, fromAccountId: a, toAccountId: b });
    const orphans = await db.query("SELECT t.id FROM \"transaction\" t WHERE t.event_type IN ('expense','income','transfer') AND NOT EXISTS (SELECT 1 FROM source_record s WHERE s.transaction_id = t.id)");
    expect(orphans).toEqual([]);
  });

  it('a first save with no account creates Cash and says so', async () => {
    const { db, writer, events } = await setup();
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: null });
    expect(r.ok).toBe(true);
    expect(Number((await db.query('SELECT COUNT(*) FROM account'))[0]![0])).toBe(1);
    expect(await events()).toContain('AccountsChanged');
  });

  it('Undo (RemoveEntry) still marks the entry deleted', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000);
    const r = await recordEntry(writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: a });
    if (!r.ok) throw new Error('x');
    await writer.run(RemoveEntry, { transactionId: r.value.transactionId }, 'user');
    expect(String((await db.query('SELECT removal_kind FROM "transaction" WHERE id = ?', [r.value.transactionId]))[0]![0])).toBe('deleted');
  });

  it('invalid input writes nothing: bad amount, empty submission id', async () => {
    const { db, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000);
    expect(await recordEntry(writer, { kind: 'expense', amountMinor: 0, categoryId: 'cat_food', accountId: a })).toEqual({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await writer.run(SubmitCapture, entryInput({ kind: 'expense', amountMinor: 1, categoryId: 'cat_food', accountId: a }, ' '), 'user')).toEqual({ ok: false, code: 'SUBMISSION_INVALID' });
    expect(Number((await db.query('SELECT COUNT(*) FROM source_record'))[0]![0])).toBe(0);
  });
});

describe('possible duplicates are saved, never blocked, and counted nowhere (TXN-012)', () => {
  const dup = { kind: 'expense' as const, amountMinor: 20000, categoryId: 'cat_food', merchant: 'Tea Stall' };

  it('the same amount at the same merchant within 10 minutes is held as needs_review with an open duplicate candidate', async () => {
    const { db, clock, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(1000);
    const first = await recordEntry(writer, { ...dup, accountId: a });
    clock.advance(5 * MIN);
    const second = await recordEntry(writer, { ...dup, accountId: a });
    expect(second).toMatchObject({ ok: true, value: { result: 'POSSIBLE_DUPLICATE', matchedTransactionId: first.ok ? first.value.transactionId : '' } });
    const id = second.ok ? second.value.transactionId : '';
    const t = (await db.query('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', [id]))[0]!;
    expect([t[0], t[1]]).toEqual(['needs_review', null]);
    const c = (await db.query('SELECT reason, status, matched_transaction_id FROM review_candidate WHERE transaction_id = ?', [id]))[0]!;
    expect([c[0], c[1], c[2]]).toEqual(['duplicate', 'open', first.ok ? first.value.transactionId : '']);
  });

  it('it counts in no total: not in Spent, day Spent, the balance, In accounts or Card dues; the first one still does', async () => {
    const { db, clock, writer, add, rows } = await setup();
    const bank = await add('HDFC', 'bank', 1000000);
    const card = await add('Card', 'card', 0);
    clock.advance(1000);
    await recordEntry(writer, { ...dup, accountId: bank });
    await recordEntry(writer, { ...dup, accountId: card, merchant: 'Cafe' });
    clock.advance(MIN);
    await recordEntry(writer, { ...dup, accountId: bank }); // possible duplicate
    await recordEntry(writer, { ...dup, accountId: card, merchant: 'Cafe' }); // possible duplicate

    expect(Number((await db.query(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(40000);
    const all = await rows();
    expect(all.find((r) => r.id === bank)!.postingsMinor).toBe(980000);
    expect(homeAccounts(all)).toMatchObject({ inAccountsMinor: 980000, cardDuesMinor: 20000 });
    const act = mapActivityRows(await db.query(ACTIVITY_SQL, [100]));
    // The held ones are listed so they can be resolved, but they are not counted anywhere.
    expect(act).toHaveLength(4);
    expect(act.filter((r) => !r.held)).toHaveLength(2);
    expect(Number((await db.query(INCOME_SQL, PERIOD))[0]![0])).toBe(0);
  });

  it('two genuine teas 40 minutes apart are both recorded; an entry with no merchant is never held', async () => {
    const { clock, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 1000000);
    clock.advance(1000);
    await recordEntry(writer, { ...dup, accountId: a });
    clock.advance(40 * MIN);
    expect(await recordEntry(writer, { ...dup, accountId: a })).toMatchObject({ value: { result: 'RECORDED' } });
    const bare = { kind: 'expense' as const, amountMinor: 700, categoryId: 'cat_food', accountId: a };
    await recordEntry(writer, bare);
    clock.advance(MIN);
    expect(await recordEntry(writer, bare)).toMatchObject({ value: { result: 'RECORDED' } });
  });

  it('an adjustment, an opening balance and a removed entry are never matched against', async () => {
    const { clock, writer, add } = await setup();
    const a = await add('HDFC', 'bank', 20000);
    await writer.run(AdjustBalance, { accountId: a, actualMinor: 40000, reason: 'rough' }, 'user');
    clock.advance(1000);
    const first = await recordEntry(writer, { ...dup, accountId: a });
    if (!first.ok) throw new Error('x');
    await writer.run(RemoveEntry, { transactionId: first.value.transactionId }, 'user');
    clock.advance(MIN);
    expect(await recordEntry(writer, { ...dup, accountId: a })).toMatchObject({ value: { result: 'RECORDED' } });
  });
});

describe('capture status labels (UX-DR82)', () => {
  it('every state and every result code has a label key, and every key is used', () => {
    const keys = CAPTURE_STATES.map(captureStatusLabel);
    expect(new Set(keys).size).toBe(CAPTURE_STATES.length);
    expect([...keys].sort()).toEqual([...CAPTURE_LABEL_KEYS].sort());
    expect(captureStateOfResult('RECORDED')).toBe('recorded');
    expect(captureStateOfResult('ALREADY_SUBMITTED')).toBe('recorded');
    expect(captureStateOfResult('POSSIBLE_DUPLICATE')).toBe('possible_duplicate');
  });

  it('stored states derive their state', () => {
    const base = { status: 'confirmed' as const, resolution: 'user_approved' as const, needsCategory: false, openDuplicate: false };
    expect(captureStateOf(base)).toBe('recorded');
    expect(captureStateOf({ ...base, categoryGuessed: true })).toBe('recorded_category_guessed');
    expect(captureStateOf({ ...base, needsCategory: true })).toBe('recorded_needs_category');
    expect(captureStateOf({ ...base, resolution: 'auto_linked' })).toBe('recorded_linked_transfer');
    expect(captureStateOf({ ...base, status: 'needs_review', resolution: null })).toBe('waiting');
    expect(captureStateOf({ ...base, status: 'needs_review', resolution: null, openDuplicate: true })).toBe('possible_duplicate');
    expect(captureStateOf({ ...base, status: 'excluded' })).toBe('rejected');
  });
});

describe('LIR-06 architecture: only SubmitCapture creates entries', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
    });
  const base = (p: string) => p.split(/[\\/]/).slice(-1)[0]!;
  const allowedCallers = new Set(['submitCapture.ts', 'entryCommands.ts', 'transferCommands.ts']);

  it('no core module other than SubmitCapture (and the files that define them) mentions the create commands', () => {
    const offenders = walk(join(__dirname, '..'))
      .filter((f) => !allowedCallers.has(base(f)) && !f.includes('testing'))
      .filter((f) => /\b(createEntry|createTransfer)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(base)).toEqual([]);
  });

  it('no app adapter or feature imports them, and the old use cases are gone', () => {
    const offenders = walk(join(__dirname, '../../../../apps/mobile/src')).filter((f) => /\b(createEntry|createTransfer|RecordManualEntry|RecordTransfer)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(base)).toEqual([]);
    const core = walk(join(__dirname, '..')).filter((f) => /\b(RecordManualEntry|RecordTransfer)\b/.test(readFileSync(f, 'utf8')) && !f.includes('testing'));
    expect(core.map(base)).toEqual([]);
  });
});
