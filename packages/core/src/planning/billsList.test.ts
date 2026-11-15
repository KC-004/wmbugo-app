import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { loadBillDetail, loadBillsList } from './billsList';
import { EndRecurringRule, MarkBillPaid, PauseRecurringRule, SaveRecurringRule, type SaveRecurringRuleInput } from './recurringCommands';

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0); // 12 Nov 2026

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(62)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const save = async (over: Partial<SaveRecurringRuleInput>) => {
    const r = await writer.run(SaveRecurringRule, { title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', accountId: a.value.accountId, categoryId: 'cat_housing', kind: 'rent', ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  return { db, clock, writer, save };
}

describe('loadBillsList and loadBillDetail (Story 6.2)', () => {
  it('lists active bills by next due date with their status line, then Paused and Ended', async () => {
    const { db, writer, save } = await setup();
    const rent = await save({ title: 'Rent', anchorDate: '2026-12-05' });
    const phone = await save({ title: 'Phone', kind: 'utility', categoryId: 'cat_bills', expectedAmountMinor: 59_900, anchorDate: '2026-11-14' });
    const late = await save({ title: 'EMI', kind: 'emi', anchorDate: '2026-11-05' });
    const paused = await save({ title: 'Gym', kind: 'other', anchorDate: '2026-11-20' });
    const ended = await save({ title: 'Old plan', kind: 'subscription', anchorDate: '2026-10-01' });
    await writer.run(PauseRecurringRule, { ruleId: paused }, 'user');
    await writer.run(EndRecurringRule, { ruleId: ended }, 'user');
    const list = (await loadBillsList(db, NOW + 1000))!;
    expect(list.today).toBe('2026-11-12');
    expect(list.active.map((r) => [r.title, r.nextDue, r.status.kind, r.status.date, r.status.daysUntilDue])).toEqual([
      ['Phone', '2026-11-14', 'due_soon', '2026-11-14', 2],
      ['EMI', '2026-12-05', 'not_seen_yet', '2026-11-05', null],
      ['Rent', '2026-12-05', 'upcoming', '2026-12-05', null],
    ]);
    expect(list.paused.map((r) => [r.title, r.status.kind, r.nextDue])).toEqual([['Gym', 'paused', null]]);
    expect(list.ended.map((r) => r.title)).toEqual(['Old plan']);
    expect(list.active[2]!.title).toBe('Rent');
    expect(list.active[2]).toMatchObject({ accountName: 'HDFC', categoryName: 'Housing', hasPayments: false });
    expect(rent).toBeDefined();
    expect(phone).toBeDefined();
    expect(late).toBeDefined();
  });

  it('marking the current date paid shows Paid and moves the next due on; the detail has history and Delete only without payments', async () => {
    const { db, writer, save } = await setup();
    const id = await save({ anchorDate: '2026-10-05' });
    await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-10-05' }, 'user');
    let d = (await loadBillDetail(db, NOW + 1000, id)) as Exclude<Awaited<ReturnType<typeof loadBillDetail>>, 'missing' | null>;
    expect(d.row.status).toMatchObject({ kind: 'not_seen_yet', date: '2026-11-05' });
    expect(d.markableDate).toBe('2026-11-05');
    expect(d.history.map((h) => [h.dueDate, h.status, h.paidBy])).toEqual([['2026-11-05', 'not_seen_yet', null], ['2026-10-05', 'paid', 'marked']]);
    expect(d.canDelete).toBe(false);
    await writer.run(MarkBillPaid, { ruleId: id, dueDate: '2026-11-05' }, 'user');
    d = (await loadBillDetail(db, NOW + 1000, id)) as typeof d;
    expect(d.row.status).toMatchObject({ kind: 'paid', date: '2026-11-05', paidBy: 'marked' });
    expect(d.row.nextDue).toBe('2026-12-05');
    expect(d.markableDate).toBe('2026-12-05');
  });

  it('a bill with no payments can be deleted, and a missing id reads missing', async () => {
    const { db, save } = await setup();
    const id = await save({});
    expect(((await loadBillDetail(db, NOW, id)) as { canDelete: boolean }).canDelete).toBe(true);
    expect(await loadBillDetail(db, NOW, 'nope')).toBe('missing');
  });
});
