import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import type { PaydayRule } from '../profile/payday';
import { LedgerWriter } from '../writer/ledgerWriter';
import { openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { loadPlanTimeline } from './planTimeline';
import { EndRecurringRule, MarkBillPaid, SaveRecurringRule, type SaveRecurringRuleInput } from './recurringCommands';

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0); // 12 Nov 2026

async function setup(payday: PaydayRule = { kind: 'first' }) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(68)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  const save = async (over: Partial<SaveRecurringRuleInput>) => {
    const r = await writer.run(SaveRecurringRule, { title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', kind: 'rent', ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  return { db, writer, save };
}

describe('loadPlanTimeline (Story 6.8)', () => {
  it('lists the bills due from the start of the period to its end, in date order, with a paid one in place and a not-seen-yet one', async () => {
    const { db, writer, save } = await setup();
    await save({ title: 'Rent', anchorDate: '2026-12-05' }); // next period: not on this timeline
    await save({ title: 'Phone', kind: 'utility', anchorDate: '2026-11-14' });
    await save({ title: 'EMI', kind: 'emi', anchorDate: '2026-11-05' });
    const paid = await save({ title: 'Gym', kind: 'other', anchorDate: '2026-11-08' });
    await writer.run(MarkBillPaid, { ruleId: paid, dueDate: '2026-11-08' }, 'user');
    await save({ title: 'Far', anchorDate: '2026-11-28' });
    const t = (await loadPlanTimeline(db, NOW))!;
    expect(t.period).toMatchObject({ start: '2026-11-01', end: '2026-11-30', label: '1–30 Nov', daysLeft: 19, payCycle: true });
    expect(t.items.map((i) => [i.dueDate, i.title, i.status])).toEqual([
      ['2026-11-05', 'EMI', 'not_seen_yet'],
      ['2026-11-08', 'Gym', 'paid'],
      ['2026-11-14', 'Phone', 'due_soon'],
      ['2026-11-28', 'Far', 'upcoming'],
    ]);
    expect(t.activeBills).toBe(5);
    expect(t.nextBill).toEqual({ title: 'Phone', dueDate: '2026-11-14' });
  });

  it('never lists paused, ended or removed bills, and with no payday the period is the month', async () => {
    const { db, writer, save } = await setup({ kind: 'none' });
    const a = await save({ title: 'Old', anchorDate: '2026-11-20' });
    await save({ title: 'Live', anchorDate: '2026-11-25' });
    await writer.run(EndRecurringRule, { ruleId: a }, 'user');
    const t = (await loadPlanTimeline(db, NOW))!;
    expect(t.items.map((i) => i.title)).toEqual(['Live']);
    expect(t.period.payCycle).toBe(false);
    expect(t.activeBills).toBe(1);
  });

  it('has nothing to show before a profile exists, and a bill is never added to it by itself', async () => {
    expect(await loadPlanTimeline(new NodeSqliteDatabase().applyRealMigrations(), NOW)).toBeNull();
    const { db } = await setup();
    const t = (await loadPlanTimeline(db, NOW))!;
    expect(t.items).toEqual([]);
    expect(t.activeBills).toBe(0);
    expect(t.nextBill).toBeNull();
  });
});
