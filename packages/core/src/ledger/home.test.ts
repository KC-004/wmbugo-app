import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { dayHeading, greetingFor, longDate, paydayInMonth, paydayRuleFromRow, periodFor, periodLabel, previousDay, shortDate } from '../profile/period';
import type { PaydayRule } from '../profile/payday';
import { MarkPromptSeen, SEEN_PROMPT_SQL, TIP_IN_ACCOUNTS } from '../profile/promptState';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { entryShape, RecordManualEntry, RemoveEntry } from './entryCommands';
import { ACTIVITY_SQL, groupByDay, homeAccounts, mapActivityRows, SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL, spentMinor } from './readModels';

const RULES: PaydayRule[] = [{ kind: 'none' }, { kind: 'first' }, { kind: 'last_day' }, { kind: 'last_working_day' }, { kind: 'day', day: 15 }, { kind: 'day', day: 31 }, { kind: 'day', day: 30 }];

describe('periods', () => {
  it('calendar month for not salaried', () => {
    expect(periodFor('2026-02-14', { kind: 'none' })).toEqual({ start: '2026-02-01', end: '2026-02-28', kind: 'calendar_month' });
  });

  it('first: the calendar month by pay cycle', () => {
    expect(periodFor('2026-11-08', { kind: 'first' })).toEqual({ start: '2026-11-01', end: '2026-11-30', kind: 'pay_cycle' });
  });

  it('last day: the cycle starts on the last day of the previous month', () => {
    expect(periodFor('2026-11-08', { kind: 'last_day' })).toEqual({ start: '2026-10-31', end: '2026-11-29', kind: 'pay_cycle' });
    expect(periodFor('2026-11-30', { kind: 'last_day' })).toEqual({ start: '2026-11-30', end: '2026-12-30', kind: 'pay_cycle' });
  });

  it('last working day skips weekends (Mon to Fri)', () => {
    // 30 Aug 2026 is a Sunday, 31 Aug is a Monday; 28 Feb 2026 is a Saturday so the 27th is the payday.
    expect(paydayInMonth(2026, 8, { kind: 'last_working_day' })).toBe('2026-08-31');
    expect(paydayInMonth(2026, 5, { kind: 'last_working_day' })).toBe('2026-05-29'); // 31 May is a Sunday
    expect(paydayInMonth(2026, 2, { kind: 'last_working_day' })).toBe('2026-02-27');
  });

  it('day N falls on the last day of shorter months', () => {
    expect(paydayInMonth(2026, 2, { kind: 'day', day: 31 })).toBe('2026-02-28');
    expect(paydayInMonth(2028, 2, { kind: 'day', day: 30 })).toBe('2028-02-29');
    expect(paydayInMonth(2026, 4, { kind: 'day', day: 31 })).toBe('2026-04-30');
    expect(periodFor('2026-03-01', { kind: 'day', day: 31 })).toEqual({ start: '2026-02-28', end: '2026-03-30', kind: 'pay_cycle' });
  });

  it('every local date belongs to exactly one period, and periods tile the calendar', () => {
    const date = fc.integer({ min: Date.UTC(2020, 0, 1) / 86_400_000, max: Date.UTC(2032, 11, 31) / 86_400_000 }).map((d) => new Date(d * 86_400_000).toISOString().slice(0, 10));
    fc.assert(
      fc.property(date, fc.constantFrom(...RULES), (d, rule) => {
        const p = periodFor(d, rule);
        expect(p.start <= d && d <= p.end).toBe(true);
        // The period is the same for every date inside it, and the next day is in the next period.
        expect(periodFor(p.start, rule)).toEqual(p);
        expect(periodFor(p.end, rule)).toEqual(p);
        const after = periodFor(addDay(p.end), rule);
        expect(after.start).toBe(addDay(p.end));
        expect(after).not.toEqual(p);
        expect(previousDay(p.start) < p.start).toBe(true);
        expect(periodFor(previousDay(p.start), rule).end).toBe(previousDay(p.start));
      }),
      { numRuns: 400 },
    );
  });

  it('labels the scope and the days', () => {
    expect(periodLabel(periodFor('2026-11-08', { kind: 'none' }), '2026-11-08')).toBe('This month');
    expect(periodLabel(periodFor('2026-11-08', { kind: 'last_day' }), '2026-11-08')).toBe('31 Oct to 29 Nov');
    expect(shortDate('2026-11-07')).toBe('Sat 7 Nov');
    expect(longDate('2026-11-05')).toBe('Thursday 5 November');
    expect(dayHeading('2026-11-07', '2026-11-07')).toBe('Today · Sat 7 Nov');
    expect(dayHeading('2026-11-06', '2026-11-07')).toBe('Yesterday · Fri 6 Nov');
    expect(dayHeading('2026-11-05', '2026-11-07')).toBe('Thu 5 Nov');
    expect(dayHeading('2026-03-01', '2026-03-02')).toBe('Yesterday · Sun 1 Mar');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect([greetingFor(6), greetingFor(13), greetingFor(20), greetingFor(2)]).toEqual(['Good morning', 'Good afternoon', 'Good evening', 'Good evening']);
    expect(paydayRuleFromRow('day', 15)).toEqual({ kind: 'day', day: 15 });
    expect(paydayRuleFromRow(null, null)).toEqual({ kind: 'none' });
    expect(paydayRuleFromRow('last_day', null)).toEqual({ kind: 'last_day' });
  });
});

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// 2026-11-08T10:00:00Z, which is 2026-11-08 18:00 in Singapore.
const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(5)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  const p = await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'none' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
  if (!p.ok) throw new Error('setup');
  const accounts = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const spent = async (start: string, end: string) => {
    const e = Number((await db.query(SPENT_EXPENSES_SQL, [start, end]))[0]![0]);
    const r = Number((await db.query(SPENT_REFUNDS_SQL, [start, end]))[0]![0]);
    return spentMinor(e, r);
  };
  return { db, clock, writer, accounts, spent };
}

describe('spent this period', () => {
  it('counts confirmed expenses in the period by local date, not income, removed entries or other months', async () => {
    const { db, writer, spent } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 100000 }, 'user');
    const acc = (await db.query('SELECT id FROM account'))[0]![0] as string;
    const rec = (kind: 'expense' | 'income', amountMinor: number, categoryId: string, occurredAtMs?: number) =>
      writer.run(RecordManualEntry, { kind, amountMinor, categoryId, accountId: acc, ...(occurredAtMs ? { occurredAtMs } : {}) }, 'user');
    await rec('expense', 1250, 'cat_food');
    const gone = await rec('expense', 9999, 'cat_food');
    await rec('income', 500000, 'cat_in_salary');
    await rec('expense', 7000, 'cat_food', Date.UTC(2026, 9, 20)); // October
    if (!gone.ok) throw new Error('x');
    await writer.run(RemoveEntry, { transactionId: gone.value.transactionId }, 'user');
    expect(await spent('2026-11-01', '2026-11-30')).toBe(1250);
    expect(await spent('2026-10-01', '2026-10-31')).toBe(7000);
  });

  it('refunds reduce it and it never goes below zero', async () => {
    const { db } = await setup();
    const now = 1;
    await db.query(`INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, created_at, updated_at) VALUES ('r1','refund','confirmed',3000,${now},'2026-11-03','UTC',${now},${now})`);
    expect(Number((await db.query(SPENT_REFUNDS_SQL, ['2026-11-01', '2026-11-30']))[0]![0])).toBe(3000);
    expect(spentMinor(1000, 3000)).toBe(0);
    expect(spentMinor(5000, 3000)).toBe(2000);
  });
});

describe('home accounts', () => {
  it('shows no total for no accounts, and never zero for an unknown balance', async () => {
    const { writer, accounts } = await setup();
    expect(homeAccounts(await accounts())).toEqual({ hasAccounts: false, inAccountsMinor: null, notSetCount: 0, cardDuesMinor: null });
    await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: null }, 'user');
    expect(homeAccounts(await accounts())).toEqual({ hasAccounts: true, inAccountsMinor: null, notSetCount: 1, cardDuesMinor: null });
  });

  it('adds asset accounts, counts the unset ones, and keeps card dues separate and positive', async () => {
    const { writer, accounts } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 320000 }, 'user');
    await writer.run(AddAccount, { name: 'Wallet', type: 'wallet', openingMinor: null }, 'user');
    await writer.run(AddAccount, { name: 'Visa', type: 'card', openingMinor: 25000 }, 'user');
    expect(homeAccounts(await accounts())).toEqual({ hasAccounts: true, inAccountsMinor: 320000, notSetCount: 1, cardDuesMinor: 25000 });
  });

  it('an archived account is left out', async () => {
    const { writer, db, accounts } = await setup();
    await writer.run(AddAccount, { name: 'Old', type: 'bank', openingMinor: 5000 }, 'user');
    await db.query("UPDATE account SET status = 'archived'");
    expect(homeAccounts(await accounts()).hasAccounts).toBe(false);
  });
});

describe('activity', () => {
  it('lists newest first with category and account, one row per entry, excluding removed and opening balances', async () => {
    const { db, writer, clock } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 100000 }, 'user');
    const acc = (await db.query('SELECT id FROM account'))[0]![0] as string;
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 1250, categoryId: 'cat_food', accountId: acc, merchant: 'Kopi', occurredAtMs: Date.UTC(2026, 10, 7, 2) }, 'user');
    clock.advance(1000);
    await writer.run(RecordManualEntry, { kind: 'income', amountMinor: 50000, categoryId: 'cat_in_salary', accountId: acc }, 'user');
    clock.advance(1000);
    const gone = await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 1, categoryId: 'cat_food', accountId: acc }, 'user');
    if (!gone.ok) throw new Error('x');
    await writer.run(RemoveEntry, { transactionId: gone.value.transactionId }, 'user');

    const rows = mapActivityRows(await db.query(ACTIVITY_SQL));
    expect(rows.map((r) => [r.kind, r.amountMinor, r.localDate, r.merchant, r.categoryName, r.accountName])).toEqual([
      ['income', 50000, '2026-11-08', null, 'Salary', 'DBS'],
      ['expense', 1250, '2026-11-07', 'Kopi', 'Food & Drinks', 'DBS'],
    ]);
  });

  it('groups by day with Spent = expenses minus refunds, floored at zero; income and transfers are not counted', () => {
    const row = (id: string, kind: 'expense' | 'income' | 'transfer' | 'refund', amountMinor: number, localDate: string) => ({
      id, kind, amountMinor, localDate, merchant: null, categoryName: null, categoryIcon: null, categoryColor: null, accountName: null,
    });
    const days = groupByDay([
      row('a', 'expense', 1250, '2026-11-07'),
      row('b', 'income', 99999, '2026-11-07'),
      row('c', 'transfer', 5000, '2026-11-07'),
      row('d', 'refund', 400, '2026-11-07'),
      row('e', 'refund', 900, '2026-11-06'),
    ]);
    expect(days.map((d) => [d.localDate, d.spentMinor, d.rows.length])).toEqual([['2026-11-07', 850, 4], ['2026-11-06', 0, 1]]);
  });
});

describe('prompt state', () => {
  it('records a seen tip once and counts further marks', async () => {
    const { db, writer } = await setup();
    expect((await db.query(SEEN_PROMPT_SQL, [TIP_IN_ACCOUNTS])).length).toBe(0);
    expect((await writer.run(MarkPromptSeen, { key: TIP_IN_ACCOUNTS }, 'user')).ok).toBe(true);
    await writer.run(MarkPromptSeen, { key: TIP_IN_ACCOUNTS }, 'user');
    expect(Number((await db.query(SEEN_PROMPT_SQL, [TIP_IN_ACCOUNTS]))[0]![0])).toBe(2);
    expect(await writer.run(MarkPromptSeen, { key: 'Bad Key' }, 'user')).toEqual({ ok: false, code: 'KEY_INVALID' });
  });
});
