import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SubmitCapture } from '../capture/submitCapture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { entryShape } from './entryCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from './accounts';
import { SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL } from './readModels';
import { CATEGORY_TOTALS_SQL, mapRecoverySummary, mapSpendingTotals, RECOVERY_SUMMARY_SQL, refundableMinor, ReverseTransaction, SPENDING_TOTALS_SQL, spendingTotals, UndoReversal, type RefundInput } from './refunds';

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const OCT_28 = Date.UTC(2026, 9, 28, 10, 0, 0);
const NOV_5 = Date.UTC(2026, 10, 5, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 9, 1, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({
    uow: db, clock, newId: createIdGenerator(clock, seededRandom(43)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
  });
  const r = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!r.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok) throw new Error('add');
  clock.advance(NOW - Date.UTC(2026, 9, 1, 10, 0, 1));
  let n = 0;
  const refund = (refundInput: RefundInput) => writer.run(SubmitCapture, { submissionId: `refund-${++n}`, sourceKind: 'manual' as const, refund: refundInput }, 'user');
  const expense = async (amountMinor: number, occurredAtMs: number, categoryId = 'cat_food') => {
    const e = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: a.value.accountId, merchant: 'Swiggy', occurredAtMs });
    if (!e.ok) throw new Error('expense ' + e.code);
    return e.value.transactionId;
  };
  const balance = async () => mapAccountRows(await db.query(ACCOUNT_LIST_SQL))[0]!.postingsMinor;
  const totals = async (start: string, end: string) => mapSpendingTotals(await db.query(SPENDING_TOTALS_SQL, [start, end, start, end].slice(0, 2)));
  return { db, writer, accountId: a.value.accountId, refund, expense, balance, totals };
}

describe('refunds (Story 3.8)', () => {
  it('a ₹1,299 refund of a ₹1,500 order on 5 Nov reduces November spending and leaves the 28 Oct period alone', async () => {
    const { db, refund, expense, totals } = await setup();
    const id = await expense(150_000, OCT_28);
    const octBefore = await totals('2026-10-01', '2026-10-31');
    const r = await refund({ originalId: id, amountMinor: 129_900, occurredAtMs: NOV_5 });
    expect(r).toMatchObject({ ok: true });
    expect(await totals('2026-10-01', '2026-10-31')).toEqual(octBefore);
    expect(octBefore.netMinor).toBe(150_000);
    const nov = await totals('2026-11-01', '2026-11-30');
    expect(nov).toMatchObject({ grossMinor: 0, refundedMinor: 129_900, netMinor: -129_900 });
    expect(Number((await db.query(SPENT_REFUNDS_SQL, ['2026-11-01', '2026-11-30']))[0]![0])).toBe(129_900);
    expect(await refundableMinor({ query: (s, p) => db.query(s, p) }, id)).toBe(20_100);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'SubmitCapture'"))[0]![0])).toBeGreaterThan(0);
  });

  it('refuses more than is left to refund', async () => {
    const { refund, expense } = await setup();
    const id = await expense(150_000, NOV_5);
    await refund({ originalId: id, amountMinor: 100_000 });
    expect(await refund({ originalId: id, amountMinor: 50_001 })).toEqual({ ok: false, code: 'EXCEEDS_REFUNDABLE' });
    expect(await refund({ originalId: id, amountMinor: 50_000 })).toMatchObject({ ok: true });
    expect(await refund({ originalId: id, amountMinor: 1 })).toEqual({ ok: false, code: 'EXCEEDS_REFUNDABLE' });
  });

  it('refuses a zero amount, a missing or non-expense original, and an unlinked refund with no account', async () => {
    const { refund, accountId } = await setup();
    expect(await refund({ amountMinor: 0, accountId })).toEqual({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await refund({ originalId: 'nope', amountMinor: 100 })).toEqual({ ok: false, code: 'ORIGINAL_NOT_FOUND' });
    expect(await refund({ amountMinor: 100 })).toEqual({ ok: false, code: 'ACCOUNT_REQUIRED' });
  });

  it('an unlinked refund lands in Other by default, in the chosen account, and is never income', async () => {
    const { db, refund, accountId, balance } = await setup();
    const before = await balance();
    const r = await refund({ amountMinor: 40_000, accountId });
    expect(r).toMatchObject({ ok: true });
    expect(await balance()).toBe(before + 40_000);
    const rows = await db.query("SELECT t.event_type, s.category_id, t.refund_of_transaction_id FROM \"transaction\" t JOIN split s ON s.transaction_id = t.id WHERE t.event_type = 'refund'");
    expect(rows.map((x) => [String(x[0]), String(x[1]), x[2]])).toEqual([['refund', 'cat_other', null]]);
    expect(Number((await db.query("SELECT COALESCE(SUM(amount_minor),0) FROM \"transaction\" WHERE event_type = 'income'"))[0]![0])).toBe(0);
  });

  it('a ₹1,200 reimbursement on ₹2,400 shows what you paid, what came back and your share; gross and net never subtract twice', async () => {
    const { db, refund, expense } = await setup();
    const id = await expense(240_000, NOV_5);
    await refund({ originalId: id, amountMinor: 120_000, occurredAtMs: NOV_5, recoveryKind: 'reimbursement' });
    expect(mapRecoverySummary(await db.query(RECOVERY_SUMMARY_SQL, [id]))).toEqual({ refundedMinor: 0, reimbursedMinor: 120_000 });
    const rows = await db.query(SPENDING_TOTALS_SQL, ['2026-11-01', '2026-11-30']);
    expect(spendingTotals(rows, 'net')).toBe(120_000);
    expect(spendingTotals(rows, 'gross')).toBe(240_000);
    expect(Number((await db.query(CATEGORY_TOTALS_SQL, ['2026-11-01', '2026-11-30']))[0]![1])).toBe(120_000);
  });

  it('property: net = gross - refunds - reimbursements, however they are split up', async () => {
    await fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.array(fc.tuple(fc.integer({ min: 1, max: 500_000 }), fc.boolean()), { maxLength: 6 }), (gross, recoveries) => {
        const refunded = recoveries.filter(([, r]) => r).reduce((s, [a]) => s + a, 0);
        const reimbursed = recoveries.filter(([, r]) => !r).reduce((s, [a]) => s + a, 0);
        const t = mapSpendingTotals([[gross, refunded, reimbursed]]);
        expect(t.netMinor).toBe(gross - refunded - reimbursed);
        expect(spendingTotals([[gross, refunded, reimbursed]], 'gross')).toBe(gross);
      }),
    );
  });
});

describe('ReverseTransaction (Story 3.8)', () => {
  it('reverses a failed payment: balance nets to unchanged, the original leaves spending, Undo restores it exactly', async () => {
    const { db, writer, expense, balance, totals } = await setup();
    const start = await balance();
    const id = await expense(50_000, NOV_5);
    expect(await balance()).toBe(start - 50_000);
    const r = await writer.run(ReverseTransaction, { transactionId: id }, 'user');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await balance()).toBe(start);
    expect((await totals('2026-11-01', '2026-11-30')).grossMinor).toBe(0);
    expect(Number((await db.query(SPENT_EXPENSES_SQL, ['2026-11-01', '2026-11-30']))[0]![0])).toBe(0);
    expect(String((await db.query('SELECT status FROM "transaction" WHERE id = ?', [id]))[0]![0])).toBe('reversed');
    expect(await writer.run(ReverseTransaction, { transactionId: id }, 'user')).toEqual({ ok: false, code: 'ALREADY_REVERSED' });

    const u = await writer.run(UndoReversal, { snapshot: r.value.snapshot, reversalId: r.value.reversalId }, 'user');
    expect(u).toMatchObject({ ok: true });
    expect(await balance()).toBe(start - 50_000);
    expect(String((await db.query('SELECT status FROM "transaction" WHERE id = ?', [id]))[0]![0])).toBe('confirmed');
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction" WHERE id = ?', [r.value.reversalId]))[0]![0])).toBe(0);
  });

  it('reversing an entry from a closed period flags closedPeriodTouched on the event and still nets the balance', async () => {
    const { db, writer, expense, balance } = await setup();
    const start = await balance();
    const id = await expense(30_000, OCT_28);
    await db.query('DELETE FROM outbox');
    const r = await writer.run(ReverseTransaction, { transactionId: id }, 'user');
    expect(r).toMatchObject({ ok: true });
    expect(await balance()).toBe(start);
    const payloads = (await db.query("SELECT payload_json FROM outbox WHERE event = 'TransactionsChanged'")).map((x) => String(x[0]));
    expect(payloads.some((p) => p.includes('"closedPeriodTouched":true'))).toBe(true);
  });

  it('does not flag a reversal inside the current period', async () => {
    const { db, writer, expense } = await setup();
    const id = await expense(30_000, NOV_5);
    await db.query('DELETE FROM outbox');
    await writer.run(ReverseTransaction, { transactionId: id }, 'user');
    const payloads = (await db.query("SELECT payload_json FROM outbox WHERE event = 'TransactionsChanged'")).map((x) => String(x[0]));
    expect(payloads.some((p) => p.includes('closedPeriodTouched'))).toBe(false);
  });
});

describe('GATE-07: refunds, reversals and spending reconcile (property)', () => {
  it('over random expenses, refunds and reversals: balance, Spent and category totals agree and refunds are never income', async () => {
    const cmd = fc.oneof(
      fc.record({ k: fc.constant('expense' as const), amount: fc.integer({ min: 100, max: 200_000 }) }),
      fc.record({ k: fc.constant('refund' as const), pick: fc.nat(20), amount: fc.integer({ min: 1, max: 200_000 }), reimb: fc.boolean() }),
      fc.record({ k: fc.constant('reverse' as const), pick: fc.nat(20) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 12 }), async (cmds) => {
        const { db, writer, refund, expense, balance, totals } = await setup();
        const opening = await balance();
        const ids: { id: string; amount: number }[] = [];
        for (const c of cmds) {
          if (c.k === 'expense') ids.push({ id: await expense(c.amount, NOV_5), amount: c.amount });
          else if (ids.length > 0) {
            const t = ids[c.pick % ids.length]!;
            if (c.k === 'refund') await refund({ originalId: t.id, amountMinor: c.amount, occurredAtMs: NOV_5, recoveryKind: c.reimb ? 'reimbursement' : 'refund' });
            else await writer.run(ReverseTransaction, { transactionId: t.id }, 'user');
          }
        }
        const confirmedExpenses = Number((await db.query(SPENT_EXPENSES_SQL, ['2026-11-01', '2026-11-30']))[0]![0]);
        const refunds = Number((await db.query(SPENT_REFUNDS_SQL, ['2026-11-01', '2026-11-30']))[0]![0]);
        const t = await totals('2026-11-01', '2026-11-30');
        // Spent
        expect(t.grossMinor).toBe(confirmedExpenses);
        expect(t.refundedMinor + t.reimbursedMinor).toBe(refunds);
        // balance = opening - all expenses that still stand - 0 for reversed (they net out) + refunds
        const reversedTotal = Number((await db.query("SELECT COALESCE(SUM(amount_minor),0) FROM \"transaction\" WHERE event_type = 'expense' AND status = 'reversed'"))[0]![0]);
        expect(await balance()).toBe(opening - confirmedExpenses + refunds - 0 * reversedTotal);
        // categories add up to net
        const cat = (await db.query(CATEGORY_TOTALS_SQL, ['2026-11-01', '2026-11-30'])).reduce((s, r) => s + Number(r[1]), 0);
        expect(cat).toBe(t.netMinor);
        // refunds are never income
        expect(Number((await db.query("SELECT COUNT(*) FROM \"transaction\" WHERE event_type = 'income'"))[0]![0])).toBe(0);
      }),
      { numRuns: 25 },
    );
  });
});
