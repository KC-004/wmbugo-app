import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry, recordTransfer } from '../testing/capture';
import { findRegion } from '../profile/regions';
import { SetUpProfile } from '../usecases/setUpProfile';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape, RemoveEntry } from '../ledger/entryCommands';
import { SetSplits } from '../ledger/splits';
import { utf8Decode } from '../backup/format';
import {
  ACCOUNT_COLUMNS,
  countExportEntries,
  CSV_BOM,
  defaultPeriodChoice,
  exportAccountsCsv,
  exportFileName,
  exportTransactionsCsv,
  maskedNumber,
  resolveExportPeriod,
  TRANSACTION_COLUMNS,
  type ExportOptions,
} from './csvExport';

const at = (d: number) => Date.UTC(2026, 10, d, 12, 0, 0);

class MemSink {
  chunks: Uint8Array[] = [];
  failAfter = Infinity;
  async write(c: Uint8Array) {
    if (this.chunks.length >= this.failAfter) throw new Error('disk full');
    this.chunks.push(new Uint8Array(c));
  }
  text(): string {
    const all = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    return utf8Decode(all)!;
  }
}

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 8, 1, 10, 0, 0), 'Europe/London');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(77)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('GB')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Europe/London' }, 'user');
  if (!p.ok) throw new Error('profile');
  const add = async (name: string, type: 'bank' | 'card' | 'cash', openingMinor: number | null = 100000) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('account');
    return a.value.accountId;
  };
  const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
    range: { start: '2026-11-01', end: '2026-11-30' },
    accountIds: null,
    accountNames: [],
    includeNumbers: false,
    numbers: new Map(),
    timezoneId: 'Europe/London',
    currency: 'GBP',
    exponent: 2,
    ...over,
  });
  return { db, writer, add, opts, clock };
}

const lines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));

describe('export transactions (Story 9.9, EXP-001)', () => {
  it('writes the metadata lines, the header and one row per entry: BOM, CRLF, unsigned amounts, the type carries the direction', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 420, categoryId: 'cat_food', accountId: bank, merchant: 'Swiggy', note: 'lunch', occurredAtMs: at(7) });
    await recordEntry(s.writer, { kind: 'income', amountMinor: 200000, categoryId: 'cat_in_salary', accountId: bank, merchant: 'Acme', occurredAtMs: at(1) });
    const sink = new MemSink();
    const r = await exportTransactionsCsv(s.db, s.opts(), sink);
    expect(r).toEqual({ ok: true, value: { entries: 2 } });
    const text = sink.text();
    expect(sink.chunks[0]![0]).toBe(0xef);
    expect(text.startsWith(CSV_BOM + '# Period 2026-11-01 to 2026-11-30 (inclusive)\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
    const l = lines(text);
    expect(l.slice(0, 6)).toEqual([
      '# Period 2026-11-01 to 2026-11-30 (inclusive)',
      '# Filters: Accounts all',
      '# Timezone Europe/London',
      '# Currency GBP',
      '# Schema wmbugo-transactions-1',
      '# Includes confirmed entries only',
    ]);
    expect(l[6]).toBe(TRANSACTION_COLUMNS.join(','));
    expect(l[7]).toMatch(/^2026-11-01,12:00,Acme,Salary,Monzo Current,,income,2000\.00,GBP,,,manual,/);
    expect(l[8]).toMatch(/^2026-11-07,12:00,Swiggy,Food & Drinks,Monzo Current,,expense,4\.20,GBP,,lunch,manual,/);
    expect(l).toHaveLength(9);
  });

  it('a cell that would run as a formula is prefixed with an apostrophe', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: bank, merchant: '=HYPERLINK("http://x")', note: '+1 @home', occurredAtMs: at(2) });
    const sink = new MemSink();
    await exportTransactionsCsv(s.db, s.opts(), sink);
    const row = lines(sink.text())[7]!;
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(row).toContain("'+1 @home");
  });

  it('a split entry is one row per part with the same entry id; a transfer is one row per leg', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    const card = await s.add('Amex', 'card', 0);
    const e = await recordEntry(s.writer, { kind: 'expense', amountMinor: 1000, categoryId: 'cat_food', accountId: bank, merchant: 'Tesco', occurredAtMs: at(3) });
    if (!e.ok) throw new Error('entry');
    const sp = await s.writer.run(SetSplits, { transactionId: e.value.transactionId, splits: [{ categoryId: 'cat_food', amountMinor: 600 }, { categoryId: 'cat_groceries', amountMinor: 400 }] }, 'user');
    expect(sp.ok).toBe(true);
    await recordTransfer(s.writer, { amountMinor: 5000, fromAccountId: bank, toAccountId: card, occurredAtMs: at(4) });
    const sink = new MemSink();
    const r = await exportTransactionsCsv(s.db, s.opts(), sink);
    expect(r).toEqual({ ok: true, value: { entries: 2 } });
    const rows = lines(sink.text()).slice(7).map((x) => x.split(','));
    expect(rows).toHaveLength(4);
    expect(rows[0]!.slice(3, 8)).toEqual(['Food & Drinks', 'Monzo Current', '', 'expense', '6.00']);
    expect(rows[1]!.slice(3, 8)).toEqual(['Groceries', 'Monzo Current', '', 'expense', '4.00']);
    expect(rows[0]![12]).toBe(rows[1]![12]);
    expect(rows[2]!.slice(4, 8)).toEqual(['Monzo Current', '', 'transfer_out', '50.00']);
    expect(rows[3]!.slice(4, 8)).toEqual(['Amex', '', 'transfer_in', '50.00']);
  });

  it('only confirmed entries inside the period and the chosen accounts are written; a transfer filtered to one account keeps its one leg', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    const card = await s.add('Amex', 'card', 0);
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: bank, merchant: 'In', occurredAtMs: at(5) });
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 200, categoryId: 'cat_food', accountId: card, merchant: 'OtherAccount', occurredAtMs: at(5) });
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 300, categoryId: 'cat_food', accountId: bank, merchant: 'Before', occurredAtMs: Date.UTC(2026, 9, 20, 12) });
    const gone = await recordEntry(s.writer, { kind: 'expense', amountMinor: 400, categoryId: 'cat_food', accountId: bank, merchant: 'Deleted', occurredAtMs: at(6) });
    if (!gone.ok) throw new Error('entry');
    await s.writer.run(RemoveEntry, { transactionId: gone.value.transactionId }, 'user');
    await recordTransfer(s.writer, { amountMinor: 700, fromAccountId: bank, toAccountId: card, occurredAtMs: at(8) });
    const sink = new MemSink();
    const r = await exportTransactionsCsv(s.db, s.opts({ accountIds: [bank], accountNames: ['Monzo Current'] }), sink);
    expect(r).toEqual({ ok: true, value: { entries: 2 } });
    const l = lines(sink.text());
    expect(l[1]).toBe('# Filters: Accounts Monzo Current');
    const body = l.slice(7);
    expect(body.map((x) => x.split(',')[2])).toEqual(['In', '']);
    expect(body[1]).toContain('transfer_out');
    expect(body.join('\n')).not.toContain('OtherAccount');
    expect(body.join('\n')).not.toContain('Before');
    expect(body.join('\n')).not.toContain('Deleted');
  });

  it('account numbers are empty unless the switch is on, and then masked to the last four digits', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: bank, merchant: 'A', occurredAtMs: at(5) });
    const off = new MemSink();
    await exportTransactionsCsv(s.db, s.opts({ numbers: new Map([[bank, '12345678 4821']]) }), off);
    expect(lines(off.text())[7]!.split(',')[5]).toBe('');
    const on = new MemSink();
    await exportTransactionsCsv(s.db, s.opts({ includeNumbers: true, numbers: new Map([[bank, '12345678 4821']]) }), on);
    expect(lines(on.text())[7]!.split(',')[5]).toBe('••4821');
    expect(maskedNumber('4821')).toBe('••4821');
    expect(maskedNumber('')).toBe('');
    expect(maskedNumber(null)).toBe('');
  });

  it('1,100 entries come out in pages with steady progress, none lost or repeated, and a cancel stops it between pages', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank', 10_000_000);
    for (let i = 0; i < 1100; i++) await recordEntry(s.writer, { kind: 'expense', amountMinor: 100 + i, categoryId: 'cat_food', accountId: bank, merchant: `Shop ${i}`, occurredAtMs: at(1 + (i % 28)) + i * 1000 });
    const progress: number[][] = [];
    const sink = new MemSink();
    const r = await exportTransactionsCsv(s.db, s.opts(), sink, { onProgress: (d, t) => progress.push([d, t]) });
    expect(r).toEqual({ ok: true, value: { entries: 1100 } });
    expect(progress[0]).toEqual([0, 1100]);
    expect(progress[progress.length - 1]).toEqual([1100, 1100]);
    const body = lines(sink.text()).slice(7);
    expect(body).toHaveLength(1100);
    expect(new Set(body.map((x) => x.split(',').pop())).size).toBe(1100);
    const stopped = new MemSink();
    let pages = 0;
    const c = await exportTransactionsCsv(s.db, s.opts(), stopped, { onProgress: () => pages++, isCancelled: () => pages >= 2 });
    expect(c).toEqual({ ok: false, code: 'CANCELLED' });
    expect(lines(stopped.text()).length).toBeLessThan(1100 + 7);
  });

  it('a sink that fails reports it instead of pretending the file was written', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: bank, occurredAtMs: at(5) });
    const sink = new MemSink();
    sink.failAfter = 1;
    expect(await exportTransactionsCsv(s.db, s.opts(), sink)).toEqual({ ok: false, code: 'WRITE_FAILED' });
    expect(await countExportEntries(s.db, s.opts())).toBe(1);
  });
});

describe('export account summary (Story 9.9)', () => {
  it('writes balances from the same postings as the Accounts screen: start, in, out, end, with have and owe, and not set stays not set', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank', 100000);
    const card = await s.add('Amex', 'card', 0);
    await s.add('Wallet', 'cash', null);
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 25000, categoryId: 'cat_food', accountId: bank, merchant: 'Old', occurredAtMs: Date.UTC(2026, 9, 20, 12) });
    await recordEntry(s.writer, { kind: 'income', amountMinor: 200000, categoryId: 'cat_in_salary', accountId: bank, occurredAtMs: at(1) });
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 4200, categoryId: 'cat_food', accountId: bank, occurredAtMs: at(7) });
    await recordEntry(s.writer, { kind: 'expense', amountMinor: 9900, categoryId: 'cat_food', accountId: card, occurredAtMs: at(7) });
    const sink = new MemSink();
    const r = await exportAccountsCsv(s.db, s.opts(), sink);
    expect(r).toEqual({ ok: true, value: { accounts: 3 } });
    const l = lines(sink.text());
    expect(l[4]).toBe('# Schema wmbugo-accounts-1');
    expect(l[6]).toBe(ACCOUNT_COLUMNS.join(','));
    expect(l[7]).toBe('Monzo Current,bank,active,,750.00,2000.00,42.00,2708.00,have,GBP');
    expect(l[8]).toBe('Amex,card,active,,0.00,0.00,99.00,99.00,owe,GBP');
    expect(l[9]).toBe('Wallet,cash,active,,,0.00,0.00,,not set,GBP');
  });

  it('says that the balances count reversed entries too, and a cancel that arrives after the query still writes nothing', async () => {
    const s = await setup();
    await s.add('Monzo Current', 'bank');
    const sink = new MemSink();
    await exportAccountsCsv(s.db, s.opts(), sink);
    expect(lines(sink.text())[5]).toBe('# Balances include confirmed and reversed entries like the Accounts screen');
    let calls = 0;
    const late = await exportAccountsCsv(s.db, s.opts(), new MemSink(), { isCancelled: () => ++calls >= 2 });
    expect(late).toEqual({ ok: false, code: 'CANCELLED' });
  });

  it('an account name with a comma or a quote keeps the Filters line in one cell', async () => {
    const s = await setup();
    const bank = await s.add('Joint, "main"', 'bank');
    const sink = new MemSink();
    await exportAccountsCsv(s.db, s.opts({ accountIds: [bank], accountNames: ['Joint, "main"'] }), sink);
    expect(lines(sink.text())[1]).toBe('"# Filters: Accounts Joint, ""main"""');
  });

  it('the chosen accounts only, and a failing sink is reported', async () => {
    const s = await setup();
    const bank = await s.add('Monzo Current', 'bank');
    await s.add('Amex', 'card', 0);
    const sink = new MemSink();
    const r = await exportAccountsCsv(s.db, s.opts({ accountIds: [bank], accountNames: ['Monzo Current'] }), sink);
    expect(r).toEqual({ ok: true, value: { accounts: 1 } });
    expect(lines(sink.text())).toHaveLength(8);
    const bad = new MemSink();
    bad.failAfter = 0;
    expect(await exportAccountsCsv(s.db, s.opts(), bad)).toEqual({ ok: false, code: 'WRITE_FAILED' });
  });
});

describe('periods and names (Story 9.9)', () => {
  const profile = { rule: { kind: 'first' as const }, firstDay: 'mon' as const };
  const TODAY = '2026-11-08';

  it('defaults to All time for transactions and This period for the account summary', () => {
    expect(defaultPeriodChoice('transactions')).toBe('all_time');
    expect(defaultPeriodChoice('accounts')).toBe('this_period');
  });

  it('works out each choice', () => {
    const p = (c: Parameters<typeof resolveExportPeriod>[0], first: string | null = '2026-01-01', custom?: { start: string; end: string }) => resolveExportPeriod(c, TODAY, profile, first, custom);
    expect(p('this_period')).toEqual({ ok: true, value: { start: '2026-11-01', end: '2026-11-30' } });
    expect(p('last_period')).toEqual({ ok: true, value: { start: '2026-10-01', end: '2026-10-31' } });
    expect(p('this_year')).toEqual({ ok: true, value: { start: '2026-01-01', end: TODAY } });
    expect(p('all_time')).toEqual({ ok: true, value: { start: '2026-01-01', end: TODAY } });
    expect(p('all_time', null)).toEqual({ ok: true, value: { start: TODAY, end: TODAY } });
    expect(p('custom', null, { start: '2026-02-01', end: '2026-02-28' })).toEqual({ ok: true, value: { start: '2026-02-01', end: '2026-02-28' } });
    expect(p('custom', null, { start: '2026-03-01', end: '2026-02-28' })).toEqual({ ok: false, code: 'RANGE_INVALID' });
    expect(p('custom', null, { start: 'nope', end: '2026-02-28' })).toEqual({ ok: false, code: 'RANGE_INVALID' });
    expect(p('custom')).toEqual({ ok: false, code: 'RANGE_INVALID' });
  });

  it('names the file with the period', () => {
    expect(exportFileName('transactions', { start: '2026-01-01', end: '2026-11-08' })).toBe('wmbugo-transactions-2026-01-01-to-2026-11-08.csv');
    expect(exportFileName('accounts', { start: '2026-11-01', end: '2026-11-30' })).toBe('wmbugo-accounts-2026-11-01-to-2026-11-30.csv');
  });
});
