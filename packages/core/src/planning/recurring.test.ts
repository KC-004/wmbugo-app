import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { recordEntry } from '../testing/capture';
import { SaveBudget } from './budgetCommands';
import { homeSummary } from '../insights/homeSummary';
import { leftInBudget } from './needsWantsSavings';
import { ACCOUNT_LIST_SQL, mapAccountRows } from '../ledger/accounts';
import { billOccurrences, nextDue, occurrences, type BillPayment, type BillRule, type Recurrence } from './recurring';
import { loadBillOccurrences, loadNextDue } from './recurringStore';
import { EndRecurringRule, MarkBillPaid, PauseRecurringRule, RemoveRecurringRule, ResumeRecurringRule, SaveRecurringRule, UnmarkBillPaid, type SaveRecurringRuleInput } from './recurringCommands';

const rec = (cadence: Recurrence['cadence'], anchorDate: string, customEvery: number | null = null, customUnit: Recurrence['customUnit'] = null): Recurrence => ({ cadence, anchorDate, customEvery, customUnit });

describe('occurrences (Story 6.1, REC-006)', () => {
  it('keeps the anchor day of a monthly rule and falls on the last day of a short month', () => {
    expect(occurrences(rec('monthly', '2027-01-31'), '2027-01-01', '2027-05-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  it('returns 29 Feb in a leap year', () => {
    expect(occurrences(rec('monthly', '2028-01-31'), '2028-02-01', '2028-03-01')).toEqual(['2028-02-29']);
  });

  it('quarterly from 30 Nov and annual from 29 Feb 2028', () => {
    expect(occurrences(rec('quarterly', '2026-11-30'), '2026-11-01', '2027-08-31')).toEqual(['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30']);
    expect(occurrences(rec('annual', '2028-02-29'), '2028-01-01', '2032-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('steps weekly by exactly 7 days and custom days and weeks exactly', () => {
    expect(occurrences(rec('weekly', '2026-11-05'), '2026-11-05', '2026-11-26')).toEqual(['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26']);
    expect(occurrences(rec('custom', '2026-11-01', 10, 'days'), '2026-11-01', '2026-12-01')).toEqual(['2026-11-01', '2026-11-11', '2026-11-21', '2026-12-01']);
    expect(occurrences(rec('custom', '2026-11-01', 2, 'weeks'), '2026-11-01', '2026-12-01')).toEqual(['2026-11-01', '2026-11-15', '2026-11-29']);
  });

  it('keeps the anchor day for custom every 2 months, like monthly', () => {
    expect(occurrences(rec('custom', '2026-12-31', 2, 'months'), '2026-12-01', '2027-06-30')).toEqual(['2026-12-31', '2027-02-28', '2027-04-30', '2027-06-30']);
  });

  it('never returns a date before the anchor, and an empty or reversed range is empty', () => {
    expect(occurrences(rec('monthly', '2026-11-05'), '2026-01-01', '2026-10-31')).toEqual([]);
    expect(occurrences(rec('monthly', '2026-11-05'), '2026-12-01', '2026-11-01')).toEqual([]);
    expect(occurrences(rec('custom', '2026-11-05', null, null), '2026-11-01', '2027-11-01')).toEqual([]);
  });

  it('property: every monthly-based result is the anchor day or the last day of a month shorter than it, and a range is a slice of the whole', () => {
    const date = fc.record({ y: fc.integer({ min: 2024, max: 2034 }), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) });
    const rule = fc.oneof(
      fc.constant({ cadence: 'monthly' as const, customEvery: null, customUnit: null }),
      fc.constant({ cadence: 'quarterly' as const, customEvery: null, customUnit: null }),
      fc.constant({ cadence: 'annual' as const, customEvery: null, customUnit: null }),
      fc.integer({ min: 1, max: 24 }).map((n) => ({ cadence: 'custom' as const, customEvery: n, customUnit: 'months' as const })),
    );
    fc.assert(
      fc.property(date, fc.integer({ min: 28, max: 31 }), rule, (a, anchorDay, shape) => {
        const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
        const day = Math.min(anchorDay, daysIn(a.y, a.m));
        const anchor = `${a.y}-${String(a.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const r: Recurrence = { ...shape, anchorDate: anchor };
        const all = occurrences(r, anchor, '2040-12-31');
        for (const d of all) {
          const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
          expect(dd === day || (dd === daysIn(y, m) && daysIn(y, m) < day)).toBe(true);
        }
        const mid = all[Math.floor(all.length / 2)]!;
        expect(occurrences(r, mid, '2040-12-31')).toEqual(all.filter((d) => d >= mid));
      }),
      { numRuns: 200 },
    );
  });
});

const rule = (over: Partial<BillRule> = {}): BillRule => ({
  id: 'r1', title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', customEvery: null, customUnit: null, anchorDate: '2026-10-05', accountId: null, categoryId: null, kind: 'rent', paidTo: null,
  endsOn: null, pausedAt: null, pausedOn: null, resumedOn: null, endedAt: null, endedOn: null, removedAt: null, ...over,
});
const paid = (dueDate: string, ruleId = 'r1'): BillPayment => ({ ruleId, dueDate, kind: 'marked', transactionId: null, recordedAt: 1 });

describe('billOccurrences statuses and nextDue', () => {
  it('paid, due_soon (today to 3 days), upcoming and not_seen_yet', () => {
    const r = rule({ anchorDate: '2026-10-05' });
    const list = (today: string, p: BillPayment[] = []) => billOccurrences([r], p, '2026-10-01', '2027-01-31', today).map((o) => [o.dueDate, o.status, o.daysUntilDue ?? null]);
    expect(list('2026-11-02', [paid('2026-10-05')])).toEqual([['2026-10-05', 'paid', null], ['2026-11-05', 'due_soon', 3], ['2026-12-05', 'upcoming', null], ['2027-01-05', 'upcoming', null]]);
    expect(list('2026-11-05')[1]).toEqual(['2026-11-05', 'due_soon', 0]);
    expect(list('2026-11-01')[1]).toEqual(['2026-11-05', 'upcoming', null]);
    expect(list('2026-11-08')[1]).toEqual(['2026-11-05', 'not_seen_yet', null]);
  });

  it('leaves the old unpaid date in history as not_marked_paid once the next one has passed, never paid automatically', () => {
    const o = billOccurrences([rule()], [], '2026-10-01', '2026-12-31', '2026-12-06').map((x) => [x.dueDate, x.status]);
    expect(o).toEqual([['2026-10-05', 'not_marked_paid'], ['2026-11-05', 'not_marked_paid'], ['2026-12-05', 'not_seen_yet']]);
  });

  it('paused rules show nothing from the pause day, ended rules nothing after the end, removed rules nothing', () => {
    const range = (r: BillRule) => billOccurrences([r], [], '2026-10-01', '2027-03-31', '2026-11-20').map((x) => x.dueDate);
    expect(range(rule({ pausedAt: 1, pausedOn: '2026-11-20' }))).toEqual(['2026-10-05', '2026-11-05']);
    expect(range(rule({ endedAt: 1, endedOn: '2026-12-31' }))).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
    expect(range(rule({ endsOn: '2026-11-05' }))).toEqual(['2026-10-05', '2026-11-05']);
    expect(range(rule({ removedAt: 1 }))).toEqual([]);
  });

  it('after a resume the dates missed while paused do not exist', () => {
    const r = rule({ pausedOn: '2026-11-20', resumedOn: '2027-02-10' });
    expect(billOccurrences([r], [], '2026-10-01', '2027-04-30', '2027-02-10').map((x) => [x.dueDate, x.status])).toEqual([['2026-10-05', 'not_marked_paid'], ['2026-11-05', 'not_marked_paid'], ['2027-03-05', 'upcoming'], ['2027-04-05', 'upcoming']]);
    expect(nextDue(r, [], '2027-02-10')).toBe('2027-03-05');
  });

  it('nextDue is the first date after the latest paid one, or the first on or after today', () => {
    expect(nextDue(rule(), [], '2026-11-20')).toBe('2026-12-05');
    expect(nextDue(rule(), [], '2026-11-05')).toBe('2026-11-05');
    expect(nextDue(rule(), [paid('2026-11-05')], '2026-11-04')).toBe('2026-12-05');
    // Paying 5 Dec as well moves it by exactly one date, not two.
    expect(nextDue(rule(), [paid('2026-11-05'), paid('2026-12-05')], '2026-11-04')).toBe('2027-01-05');
    // An unpaid past date stays next until it is paid.
    expect(nextDue(rule(), [paid('2026-10-05')], '2026-11-20')).toBe('2026-11-05');
    expect(nextDue(rule({ pausedAt: 1, pausedOn: '2026-11-20' }), [], '2026-11-21')).toBeNull();
    expect(nextDue(rule({ endsOn: '2026-11-05' }), [paid('2026-11-05')], '2026-11-06')).toBeNull();
  });
});

// ---- Commands and queries on a real database ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0); // 12 Nov 2026

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(61)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const base: SaveRecurringRuleInput = { title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', accountId: a.value.accountId, categoryId: 'cat_housing', kind: 'rent', paidTo: 'Ramesh Kumar' };
  const save = (over: Partial<SaveRecurringRuleInput> = {}) => writer.run(SaveRecurringRule, { ...base, ...over }, 'user');
  return { db, clock, writer, accountId: a.value.accountId, save, base };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};
const events = async (db: NodeSqliteDatabase) => (await db.query('SELECT event FROM outbox ORDER BY created_at, id')).map((r) => String(r[0]));

describe('SaveRecurringRule', () => {
  it('writes the rule with an audit row and RecurringChanged, and no transaction', async () => {
    const { db, save } = await setup();
    await db.query('DELETE FROM outbox');
    const txBefore = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    const r = ok(await save());
    expect(r.value.created).toBe(true);
    expect((await db.query('SELECT title, expected_amount_minor, cadence, anchor_date, kind, paid_to FROM recurring_rule WHERE id = ?', [r.value.ruleId]))[0]!.map(String)).toEqual(['Rent', '1800000', 'monthly', '2026-12-05', 'rent', 'Ramesh Kumar']);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'SaveRecurringRule' AND entity_id = ?", [r.value.ruleId]))[0]![0])).toBe(1);
    expect(await events(db)).toContain('RecurringChanged');
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(txBefore);
  });

  it('refuses bad input and writes nothing', async () => {
    const { db, save } = await setup();
    expect(await save({ title: '  ' })).toMatchObject({ ok: false, code: 'TITLE_REQUIRED' });
    expect(await save({ expectedAmountMinor: 0 })).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await save({ anchorDate: '' })).toMatchObject({ ok: false, code: 'DATE_REQUIRED' });
    expect(await save({ anchorDate: '2026-02-31' })).toMatchObject({ ok: false, code: 'DATE_INVALID' });
    expect(await save({ endsOn: '2026-12-04' })).toMatchObject({ ok: false, code: 'END_BEFORE_START' });
    expect(await save({ cadence: 'custom', customEvery: 100, customUnit: 'days' })).toMatchObject({ ok: false, code: 'CADENCE_INVALID' });
    expect(await save({ cadence: 'custom', customEvery: 3, customUnit: null })).toMatchObject({ ok: false, code: 'CADENCE_INVALID' });
    expect(await save({ accountId: 'nope' })).toMatchObject({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(await save({ categoryId: 'nope' })).toMatchObject({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    expect(await save({ id: 'missing' })).toMatchObject({ ok: false, code: 'RULE_NOT_FOUND' });
    expect(Number((await db.query('SELECT COUNT(*) FROM recurring_rule'))[0]![0])).toBe(0);
  });

  it('edits a rule in place and keeps its payment rows', async () => {
    const { db, writer, save } = await setup();
    const id = ok(await save()).value.ruleId;
    ok(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-12-05' }, 'user'));
    const e = ok(await save({ id, anchorDate: '2026-12-07', expectedAmountMinor: 1_850_000 }));
    expect(e.value).toEqual({ ruleId: id, created: false });
    expect((await db.query('SELECT anchor_date, expected_amount_minor FROM recurring_rule WHERE id = ?', [id]))[0]!.map(String)).toEqual(['2026-12-07', '1850000']);
    expect(Number((await db.query('SELECT COUNT(*) FROM recurring_payment WHERE rule_id = ?', [id]))[0]![0])).toBe(1);
  });
});

describe('pause, resume, end, remove', () => {
  it('a paused rule has no due dates and a resumed one does not invent the missed ones', async () => {
    const { db, clock, writer, save } = await setup();
    const id = ok(await save({ anchorDate: '2026-10-05' })).value.ruleId;
    ok(await writer.run(PauseRecurringRule, { ruleId: id }, 'user'));
    expect(await writer.run(PauseRecurringRule, { ruleId: id }, 'user')).toMatchObject({ ok: false, code: 'NOT_ACTIVE' });
    expect(await loadNextDue(db, clock.nowMs(), id)).toBeNull();
    expect((await loadBillOccurrences(db, clock.nowMs(), '2026-10-01', '2027-02-28')).map((o) => o.dueDate)).toEqual(['2026-10-05', '2026-11-05']);
    clock.set(Date.UTC(2027, 0, 20, 10, 0, 0));
    ok(await writer.run(ResumeRecurringRule, { ruleId: id }, 'user'));
    expect(await writer.run(ResumeRecurringRule, { ruleId: id }, 'user')).toMatchObject({ ok: false, code: 'NOT_PAUSED' });
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2027-02-05');
    const o = await loadBillOccurrences(db, clock.nowMs(), '2026-10-01', '2027-03-31');
    expect(o.map((x) => [x.dueDate, x.status])).toEqual([['2026-10-05', 'not_marked_paid'], ['2026-11-05', 'not_marked_paid'], ['2027-02-05', 'upcoming'], ['2027-03-05', 'upcoming']]);
  });

  it('an ended rule has no due dates after its end and keeps its history; remove is refused once any payment exists', async () => {
    const { db, clock, writer, save } = await setup();
    const id = ok(await save({ anchorDate: '2026-10-05' })).value.ruleId;
    ok(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-10-05' }, 'user'));
    expect(await writer.run(RemoveRecurringRule, { ruleId: id }, 'user')).toMatchObject({ ok: false, code: 'HAS_PAYMENTS' });
    ok(await writer.run(EndRecurringRule, { ruleId: id }, 'user'));
    expect(await writer.run(EndRecurringRule, { ruleId: id }, 'user')).toMatchObject({ ok: false, code: 'ALREADY_ENDED' });
    expect((await loadBillOccurrences(db, clock.nowMs(), '2026-10-01', '2027-03-31')).map((o) => [o.dueDate, o.status])).toEqual([['2026-10-05', 'paid'], ['2026-11-05', 'not_seen_yet']]);
    expect(await loadNextDue(db, clock.nowMs(), id)).toBeNull();
  });

  it('removes a rule with no payments, and it stops showing', async () => {
    const { db, clock, writer, save } = await setup();
    const id = ok(await save()).value.ruleId;
    ok(await writer.run(RemoveRecurringRule, { ruleId: id }, 'user'));
    expect(await loadBillOccurrences(db, clock.nowMs(), '2026-10-01', '2027-03-31')).toEqual([]);
    expect(await writer.run(RemoveRecurringRule, { ruleId: id }, 'user')).toMatchObject({ ok: false, code: 'RULE_NOT_FOUND' });
  });
});

describe('MarkBillPaid and UnmarkBillPaid', () => {
  it('records one marked payment per due date and advances nextDue by exactly one', async () => {
    const { db, clock, writer, save } = await setup();
    const id = ok(await save({ anchorDate: '2026-11-05' })).value.ruleId;
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2026-12-05');
    await db.query('DELETE FROM outbox');
    ok(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-11-05' }, 'user'));
    expect(await events(db)).toContain('RecurringChanged');
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2026-12-05');
    ok(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-12-05' }, 'user'));
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2027-01-05');
    // Marking the same date again is refused, and the database refuses a second row for it.
    expect(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-12-05' }, 'user')).toMatchObject({ ok: false, code: 'ALREADY_PAID' });
    await expect(db.query("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, '2026-12-05', 'marked', NULL, 1)", [id])).rejects.toThrow();
    expect(Number((await db.query('SELECT COUNT(*) FROM recurring_payment WHERE rule_id = ?', [id]))[0]![0])).toBe(2);
  });

  it('refuses a date that is not one of the rule\'s due dates', async () => {
    const { writer, save } = await setup();
    const id = ok(await save({ anchorDate: '2026-11-05' })).value.ruleId;
    expect(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-11-06' }, 'user')).toMatchObject({ ok: false, code: 'NOT_A_DUE_DATE' });
    expect(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-10-05' }, 'user')).toMatchObject({ ok: false, code: 'NOT_A_DUE_DATE' });
  });

  it('a transaction can pay one occurrence only (unique key)', async () => {
    const { db, writer, save } = await setup();
    const id = ok(await save({ anchorDate: '2026-11-05' })).value.ruleId;
    await db.query("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, '2026-11-05', 'linked', 'tx1', 1)", [id]);
    await expect(db.query("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, '2026-12-05', 'linked', 'tx1', 1)", [id])).rejects.toThrow();
    // Two payments without an entry are fine: the key only covers a set transaction id.
    await db.query("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, '2026-12-05', 'marked', NULL, 1)", [id]);
    await db.query("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, '2027-01-05', 'marked', NULL, 1)", [id]);
    expect(writer).toBeDefined();
  });

  it('unmark takes back a marked payment only', async () => {
    const { db, clock, writer, save } = await setup();
    const id = ok(await save({ anchorDate: '2026-11-05' })).value.ruleId;
    ok(await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-11-05' }, 'user'));
    ok(await writer.run(UnmarkBillPaid, { ruleId: id, dueDate: '2026-11-05' }, 'user'));
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2026-12-05');
    expect(await writer.run(UnmarkBillPaid, { ruleId: id, dueDate: '2026-11-05' }, 'user')).toMatchObject({ ok: false, code: 'NOT_MARKED' });
    await db.query("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, '2026-11-05', 'linked', 'tx9', 1)", [id]);
    expect(await writer.run(UnmarkBillPaid, { ruleId: id, dueDate: '2026-11-05' }, 'user')).toMatchObject({ ok: false, code: 'NOT_MARKED' });
  });
});

describe('a planned bill changes no ledger figure (REC-002 regression)', () => {
  it('balances, Home summary, left in budget and spent are identical with and without an active rent rule due tomorrow', async () => {
    const snapshot = async (withRule: boolean) => {
      const { db, clock, writer, accountId, save } = await setup();
      const r = await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 6_000_000, alertLevels: [75, 90, 100] }, 'user');
      expect(r.ok).toBe(true);
      const e = await recordEntry(writer, { kind: 'expense', amountMinor: 250_000, categoryId: 'cat_food', accountId, merchant: 'X', occurredAtMs: NOW - 86_400_000 });
      expect(e.ok).toBe(true);
      if (withRule) ok(await save({ anchorDate: '2026-11-13' }));
      const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).map((a) => [a.id, a.postingsMinor, a.balanceNotSet]);
      const spent = (await db.query('SELECT COALESCE(SUM(amount_minor),0), COUNT(*) FROM "transaction"'))[0];
      const postings = (await db.query('SELECT COUNT(*) FROM posting'))[0];
      // Ids differ between runs only through the random sequence; the figures must not.
      const strip = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID'));
      return strip({ accounts: accounts.map((a) => a.slice(1)), spent, postings, home: await homeSummary(db, clock.nowMs()), left: await leftInBudget(db, clock.nowMs()) });
    };
    expect(await snapshot(true)).toEqual(await snapshot(false));
  });
});
