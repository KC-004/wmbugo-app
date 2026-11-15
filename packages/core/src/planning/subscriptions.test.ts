import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { loadBillsList } from './billsList';
import { monthlyEquivalent, roundHalfUp, sumFractions, type Recurrence } from './recurring';
import { EndRecurringRule, PauseRecurringRule, SaveRecurringRule, type SaveRecurringRuleInput } from './recurringCommands';

const eq = (cadence: Recurrence['cadence'], expectedAmountMinor: number, customEvery: number | null = null, customUnit: Recurrence['customUnit'] = null) => roundHalfUp(monthlyEquivalent({ cadence, expectedAmountMinor, customEvery, customUnit }));

describe('monthly equivalent (Story 6.4, REC-008)', () => {
  it('converts each cadence the way the caption says', () => {
    expect(eq('monthly', 64_900)).toBe(64_900);
    expect(eq('annual', 118_900)).toBe(9_908); // yearly / 12
    expect(eq('weekly', 9_900)).toBe(42_900); // weekly x 52 / 12
    expect(eq('quarterly', 30_000)).toBe(10_000); // every 3 months / 3
    expect(eq('custom', 10_000, 10, 'days')).toBe(30_417); // 10000 x 365 / 120
    expect(eq('custom', 10_000, 2, 'weeks')).toBe(21_667); // 10000 x 52 / 24
    expect(eq('custom', 10_000, 4, 'months')).toBe(2_500);
  });

  it('rounds half up, once, and a malformed custom rule counts as zero', () => {
    expect(eq('annual', 6)).toBe(1); // 0.5 rounds up
    expect(eq('annual', 5)).toBe(0); // 0.4167 rounds down
    expect(eq('custom', 100, null, null)).toBe(0);
    expect(eq('custom', 100, 100, 'days')).toBe(0);
  });

  it('sums exactly and rounds only at the end: Netflix 649 + Spotify 1,189 a year + a 99 weekly plan is 1,177.08', () => {
    const f = (c: Recurrence['cadence'], a: number) => monthlyEquivalent({ cadence: c, expectedAmountMinor: a, customEvery: null, customUnit: null });
    const parts = [f('monthly', 64_900), f('annual', 118_900), f('weekly', 9_900)];
    expect(roundHalfUp(sumFractions(parts))).toBe(117_708);
    // Rounding each part first would give 64,900 + 9,908 + 42,900 = 117,708 here; a case where it differs:
    const thirds = [f('quarterly', 100), f('quarterly', 100), f('quarterly', 100)]; // 33.33 each
    expect(roundHalfUp(sumFractions(thirds))).toBe(100);
    expect(thirds.map(roundHalfUp).reduce((a, b) => a + b, 0)).toBe(99);
  });
});

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

describe('loadBillsList subscriptions header', () => {
  it('counts active subscriptions only; paused and ended are listed but not counted', async () => {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    const clock = new FakeClock(NOW, 'Asia/Kolkata');
    const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(64)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
    const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
    if (!p.ok) throw new Error('setup');
    const save = async (over: Partial<SaveRecurringRuleInput>) => {
      const r = await writer.run(SaveRecurringRule, { title: 'X', expectedAmountMinor: 64_900, cadence: 'monthly', anchorDate: '2026-12-05', kind: 'subscription', ...over }, 'user');
      if (!r.ok) throw new Error(r.code);
      return r.value.ruleId;
    };
    await save({ title: 'Netflix' });
    await save({ title: 'Spotify', expectedAmountMinor: 118_900, cadence: 'annual' });
    await save({ title: 'Cloud', expectedAmountMinor: 9_900, cadence: 'weekly' });
    const paused = await save({ title: 'Gym' });
    const ended = await save({ title: 'Old' });
    await save({ title: 'Rent', kind: 'rent', expectedAmountMinor: 1_800_000 });
    await writer.run(PauseRecurringRule, { ruleId: paused }, 'user');
    await writer.run(EndRecurringRule, { ruleId: ended }, 'user');
    const list = (await loadBillsList(db, NOW))!;
    expect(list.subscriptions).toEqual({ totalMinor: 117_708, counted: 3 });
    expect(list.paused[0]).toMatchObject({ title: 'Gym', monthlyEquivalentMinor: 64_900 });
    expect(list.active.find((r) => r.title === 'Spotify')!.monthlyEquivalentMinor).toBe(9_908);
  });
});
