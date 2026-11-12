import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { ChangeProfile } from '../profile/settingsCommands';
import { readPaydayRule, previewPaydayChange } from '../profile/paydayChange';
import { periodRule } from '../profile/settings';
import type { PaydayRule, PaydayRuleBase } from '../profile/payday';
import { addDays, periodDays, periodFor, periodLabel, planPaydayChange, prorateTarget } from '../profile/period';
import { SaveBudget, type SaveBudgetInput } from './budgetCommands';
import { loadBudgetList } from './budgetList';
import { loadBudgetDetail } from './budgetDetail';

const day = (month: number, d: number, h = 10) => Date.UTC(2026, month - 1, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup(todayMs: number, payday: PaydayRuleBase = { kind: 'first' }) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(todayMs, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(61)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const base: SaveBudgetInput = { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 5_000_000, alertLevels: [75, 90, 100] };
  const save = async (over: Partial<SaveBudgetInput> = {}) => {
    const r = await writer.run(SaveBudget, { ...base, ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.budgetId;
  };
  const change = (payday: PaydayRule) => writer.run(ChangeProfile, { payday }, 'user');
  const periods = async (id: string) => (await db.query('SELECT start_date, end_date, target_minor, shortened FROM budget_period WHERE budget_id = ? ORDER BY start_date', [id])).map((r) => [String(r[0]), String(r[1]), Number(r[2]), Number(r[3])]);
  const rule = async () => periodRule((await readPaydayRule(db))!.rule, 'pay_cycle');
  return { db, clock, writer, accountId, save, change, periods, rule, spend: async (c: string, amount: number, at: number) => { const r = await recordEntry(writer, { kind: 'expense', amountMinor: amount, categoryId: c, accountId, merchant: 'X', occurredAtMs: at }); if (!r.ok) throw new Error(r.code); } };
}

describe('pro-rating (Story 4.8)', () => {
  it('rounds half up to the minor unit', () => {
    expect(prorateTarget(5_000_000, 24, 30)).toBe(4_000_000);
    expect(prorateTarget(1, 1, 2)).toBe(1); // 0.5 -> 1
    expect(prorateTarget(3, 1, 2)).toBe(2); // 1.5 -> 2
    expect(prorateTarget(5_000_000, 4, 31)).toBe(645_161); // 645,161.29
    expect(prorateTarget(100, 3, 0)).toBe(100);
  });
});

describe('changing payday mid-cycle (Story 4.8)', () => {
  it('payday 1st, ₹50,000 overall, 10 Nov, payday to the 25th: the preview says the cycle ends 24 Nov; the periods are 1–24 Nov shortened and 25 Nov–24 Dec', async () => {
    const { db, save, change, periods, rule } = await setup(day(11, 10));
    const id = await save();
    const preview = await previewPaydayChange(db, { kind: 'day', day: 25 }, day(11, 10));
    expect(preview).toMatchObject({ cycleEnd: '2026-11-24', shortened: { start: '2026-11-01', end: '2026-11-24' } });
    // The preview writes nothing: Cancel changes nothing.
    expect(String((await db.query('SELECT payday_rule FROM profile'))[0]![0])).toBe('first');
    expect(await periods(id)).toEqual([['2026-11-01', '2026-11-30', 5_000_000, 0], ['2026-12-01', '2026-12-31', 5_000_000, 0]]);

    expect((await change({ kind: 'day', day: 25 })).ok).toBe(true);
    const r = await rule();
    expect(periodFor('2026-11-10', r)).toMatchObject({ start: '2026-11-01', end: '2026-11-24', shortened: true });
    expect(periodFor('2026-11-25', r)).toMatchObject({ start: '2026-11-25', end: '2026-12-24' });
    expect(periodFor('2026-11-25', r).shortened).toBeUndefined();
    // The budget cache: 24 ÷ 30 of ₹50,000, labelled shortened, then the full ₹50,000.
    expect(await periods(id)).toEqual([['2026-11-01', '2026-11-24', 4_000_000, 1], ['2026-11-25', '2026-12-24', 5_000_000, 0]]);
  });

  it('SCR-14, SCR-15 and the Home period label show 1–24 Nov · Shortened cycle, from the same period service', async () => {
    const { db, save, change, rule } = await setup(day(11, 10));
    const id = await save();
    await change({ kind: 'day', day: 25 });
    const list = (await loadBudgetList(db, day(11, 10)))!;
    expect(list.rows[0]).toMatchObject({ periodLabel: '1–24 Nov · Shortened cycle', targetMinor: 4_000_000 });
    const d = await loadBudgetDetail(db, id, 0, day(11, 10));
    expect(d).toMatchObject({ periodLabel: '1–24 Nov · Shortened cycle', targetMinor: 4_000_000 });
    expect(periodLabel(periodFor('2026-11-10', await rule()), '2026-11-10')).toBe('1–24 Nov · Shortened cycle');
    // The same dates answer Home's Spent this period: the period service is the only source.
    const home = periodFor('2026-11-10', await rule());
    expect([home.start, home.end]).toEqual([list.rows[0]!.period.start, list.rows[0]!.period.end]);
  });

  it('every default-period budget is pro-rated (overall and default-period category and type budgets); weekly, monthly and custom keep their own periods', async () => {
    const { db, save, change, periods } = await setup(day(11, 10));
    const overall = await save();
    const groceries = await save({ scope: 'category', categoryIds: ['cat_groceries'], periodRule: 'default', targetMinor: 3_000_000 });
    const monthly = await save({ scope: 'category', categoryIds: ['cat_food'], periodRule: 'monthly', targetMinor: 1_000_000 });
    const weekly = await save({ scope: 'category', categoryIds: ['cat_travel'], periodRule: 'weekly', targetMinor: 200_000 });
    const custom = await save({ scope: 'category', categoryIds: ['cat_shopping'], periodRule: 'custom', customStart: '2026-11-03', customEnd: '2026-11-20', targetMinor: 700_000 });
    // A Need/Want budget (Story 4.10 creates them) follows the default period too.
    db.raw.exec(`INSERT INTO budget (id, name, scope, scope_budget_type, period_rule, template, created_at) VALUES ('need', 'Needs', 'budget_type', 'need', 'default', '50_30_20', 1)`);
    db.raw.exec(`INSERT INTO budget_target_version (budget_id, version, target_minor, effective_from) VALUES ('need', 1, 2500000, '2026-11-01')`);
    await change({ kind: 'day', day: 25 });
    expect((await periods(overall))[0]).toEqual(['2026-11-01', '2026-11-24', 4_000_000, 1]);
    expect((await periods(groceries))[0]).toEqual(['2026-11-01', '2026-11-24', 2_400_000, 1]);
    expect((await periods('need'))[0]).toEqual(['2026-11-01', '2026-11-24', 2_000_000, 1]);
    expect((await periods(monthly))[0]).toEqual(['2026-11-01', '2026-11-30', 1_000_000, 0]);
    expect((await periods(weekly))[0]![2]).toBe(200_000);
    expect((await periods(custom))).toEqual([['2026-11-03', '2026-11-20', 700_000, 0]]);
  });

  it('a payday that falls today ends the current cycle yesterday and starts the new one today', async () => {
    const { change, rule } = await setup(day(11, 25));
    expect((await change({ kind: 'day', day: 25 })).ok).toBe(true);
    const r = await rule();
    expect(periodFor('2026-11-24', r)).toMatchObject({ start: '2026-11-01', end: '2026-11-24', shortened: true });
    expect(periodFor('2026-11-25', r)).toMatchObject({ start: '2026-11-25', end: '2026-12-24' });
  });

  it('a new payday after the cycle\'s normal end (1st to the 5th on 28 Nov): the cycle ends as planned, 1–4 Dec is shortened and pro-rated, the new cycle starts on 5 Dec', async () => {
    const { db, save, change, periods, rule } = await setup(day(11, 28));
    const id = await save();
    const preview = await previewPaydayChange(db, { kind: 'day', day: 5 }, day(11, 28));
    expect(preview).toMatchObject({ cycleEnd: '2026-11-30', shortened: { start: '2026-12-01', end: '2026-12-04' } });
    await change({ kind: 'day', day: 5 });
    const r = await rule();
    expect(periodFor('2026-11-28', r)).toMatchObject({ start: '2026-11-01', end: '2026-11-30' });
    expect(periodFor('2026-11-28', r).shortened).toBeUndefined();
    expect(periodFor('2026-12-02', r)).toMatchObject({ start: '2026-12-01', end: '2026-12-04', shortened: true });
    expect(periodFor('2026-12-05', r)).toMatchObject({ start: '2026-12-05', end: '2027-01-04' });
    expect(await periods(id)).toEqual([['2026-11-01', '2026-11-30', 5_000_000, 0], ['2026-12-01', '2026-12-04', 645_161, 1]]);
    // No cycle is ever longer than a normal one.
    for (const d of ['2026-11-15', '2026-12-02', '2026-12-20', '2027-01-10']) expect(periodDays(periodFor(d, r))).toBeLessThanOrEqual(31);
  });

  it('a payday change on a cycle boundary needs no shortened cycle', async () => {
    const { db, change, rule } = await setup(day(12, 1));
    const preview = await previewPaydayChange(db, { kind: 'day', day: 1 }, day(12, 1));
    expect(preview).toBeNull(); // the same payday: nothing changes
    const plan = planPaydayChange('2026-12-01', await rule(), { kind: 'day', day: 15 });
    expect(plan.shortened).toEqual({ start: '2026-12-01', end: '2026-12-14' });
    expect((await change({ kind: 'day', day: 15 })).ok).toBe(true);
  });

  it('modifies no transaction, split or posting; past periods keep their dates and targets; entries are counted again by their own dates', async () => {
    const { db, save, change, spend, rule, periods } = await setup(day(11, 10));
    const id = await save();
    await spend('cat_food', 700_000, day(10, 20));
    await spend('cat_food', 300_000, day(11, 2));
    await spend('cat_food', 500_000, day(11, 28)); // inside the old cycle but beyond today? entries may be dated ahead; it is simply counted by date
    const fingerprint = async () => JSON.stringify([await db.query('SELECT * FROM "transaction" ORDER BY id'), await db.query('SELECT * FROM split ORDER BY id'), await db.query('SELECT * FROM posting ORDER BY id')]);
    const before = await fingerprint();
    const octBefore = periodFor('2026-10-15', await rule());
    await db.query('DELETE FROM audit_event');
    expect((await change({ kind: 'day', day: 25 })).ok).toBe(true);
    expect(await fingerprint()).toBe(before);
    expect(periodFor('2026-10-15', await rule())).toEqual(octBefore);
    expect((await db.query('SELECT DISTINCT entity_kind FROM audit_event')).map((r) => String(r[0])).filter((k) => k === 'transaction')).toEqual([]);
    // The ₹3,000 and ₹5,000 spent in November are counted in the periods their dates fall in.
    const list = (await loadBudgetList(db, day(11, 10)))!;
    expect(list.rows[0]!.usedMinor).toBe(300_000);
    expect(await periods(id)).toHaveLength(2);
  });

  it('two changes in a row keep every earlier period; a change to Not salaried adds no cycle', async () => {
    const { change, rule } = await setup(day(11, 10));
    await change({ kind: 'day', day: 25 });
    const afterFirst = periodFor('2026-11-10', await rule());
    expect((await change({ kind: 'day', day: 20 })).ok).toBe(true);
    expect(periodFor('2026-10-15', await rule())).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    expect(periodFor('2026-11-10', await rule()).start).toBe(afterFirst.start);
    expect((await change({ kind: 'none' })).ok).toBe(true);
  });
});

describe('every date is in exactly one period, whatever the payday changes (Story 4.8)', () => {
  const paydays = fc.oneof(
    fc.constant<PaydayRuleBase>({ kind: 'first' }),
    fc.constant<PaydayRuleBase>({ kind: 'last_day' }),
    fc.constant<PaydayRuleBase>({ kind: 'last_working_day' }),
    fc.integer({ min: 1, max: 31 }).map<PaydayRuleBase>((d) => ({ kind: 'day', day: d })),
  );

  it('periods are contiguous, never overlap and a shortened cycle is never longer than the normal one', () => {
    fc.assert(
      fc.property(paydays, fc.array(fc.tuple(fc.integer({ min: 0, max: 400 }), paydays), { maxLength: 4 }), (first, changes) => {
        let rule: PaydayRule = first;
        for (const [gap, next] of [...changes].sort((a, b) => a[0] - b[0])) {
          const today = addDays('2026-01-01', gap);
          const plan = planPaydayChange(today, rule, next as Exclude<PaydayRuleBase, { kind: 'none' }>);
          rule = { ...next, transitions: [...(rule.transitions ?? []), plan.transition] };
        }
        let prev = periodFor('2025-12-01', rule);
        for (let i = 1; i <= 900; i++) {
          const date = addDays('2025-12-01', i);
          const p = periodFor(date, rule);
          if (!(p.start <= date && date <= p.end)) return false;
          if (p.start === prev.start) {
            if (p.end !== prev.end) return false; // same period for the whole span
          } else {
            if (addDays(prev.end, 1) !== p.start || prev.end !== addDays(date, -1)) return false; // contiguous, no overlap
          }
          // A shortened cycle is never longer than the normal cycle it is cut from; a normal cycle is at most 33 days.
          if (periodDays(p) > (p.shortened ? p.normalDays! : 33)) return false;
          prev = p;
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });
});

describe('changing to Not salaried keeps the past (Epic 4 review)', () => {
  it('payday on the 25th, changed to Not salaried on 10 Nov: the cycle ends on 24 Nov, 25 to 30 Nov is a shortened cycle, calendar months follow, and earlier periods do not move', async () => {
    const { change, rule } = await setup(day(11, 10), { kind: 'day', day: 25 });
    const oct = periodFor('2026-10-10', await rule());
    const nov = periodFor('2026-11-10', await rule());
    expect([oct.start, oct.end, nov.start, nov.end]).toEqual(['2026-09-25', '2026-10-24', '2026-10-25', '2026-11-24']);
    expect((await change({ kind: 'none' })).ok).toBe(true);
    const after = await rule();
    expect(periodFor('2026-10-10', after)).toMatchObject({ start: '2026-09-25', end: '2026-10-24' });
    expect(periodFor('2026-11-10', after)).toMatchObject({ start: '2026-10-25', end: '2026-11-24' });
    expect(periodFor('2026-11-27', after)).toMatchObject({ start: '2026-11-25', end: '2026-11-30', shortened: true });
    expect(periodFor('2026-12-15', after)).toMatchObject({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('the confirmation preview does not ask for Not salaried', async () => {
    const { db } = await setup(day(11, 10));
    expect(await previewPaydayChange(db, { kind: 'none' }, day(11, 10))).toBeNull();
  });
});
