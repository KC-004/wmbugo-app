import fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { ReverseTransaction } from '../ledger/refunds';
import { SaveCategory } from '../ledger/categoryCommands';
import { addDays, budgetPeriodFor, calendarMonthFor, customPeriod, periodDays, previousPeriod, weekFor, periodFor } from '../profile/period';
import type { PaydayRule } from '../profile/payday';
import { budgetFigures, budgetStatus, figuresFromNets, periodsToCache, targetForPeriod, type BudgetDef, type CategoryNet } from './budgets';
import { RebuildBudgetPeriods } from './budgetStore';

const DAY = 86_400_000;
const nov = (d: number, h = 9) => Date.UTC(2026, 10, d, h, 0, 0) - 5.5 * 3_600_000; // IST wall time
const oct = (d: number, h = 9) => Date.UTC(2026, 9, d, h, 0, 0) - 5.5 * 3_600_000;

async function setup(payday: PaydayRule | { kind: 'first' } = { kind: 'first' }) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 10, 12, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(31)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: payday as PaydayRule, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  const b = await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 5_000_000 }, 'user');
  if (!a.ok || !b.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const spend = async (categoryId: string, amountMinor: number, at: number, account = accountId) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: account, merchant: `M${amountMinor}`, occurredAtMs: at });
    if (!r.ok) throw new Error(`entry ${r.code}`);
    return r.value.transactionId;
  };
  const refund = async (originalId: string, amountMinor: number) => {
    clock.advance(1000);
    const r = await writer.run(SubmitCapture, { submissionId: `rf-${originalId}-${amountMinor}`, sourceKind: 'manual', refund: { originalId, amountMinor, recoveryKind: 'refund' } }, 'user');
    if (!r.ok) throw new Error(`refund ${r.code}`);
    return r.value.transactionId;
  };
  const budget = (over: Partial<BudgetDef> = {}): BudgetDef => ({ id: 'b1', scope: 'overall', categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' }, ...over });
  return { db, clock, writer, accountId, cashId: b.value.accountId, spend, refund, budget };
}

const NOV = { start: '2026-11-01', end: '2026-11-30' };
const OCT = { start: '2026-10-01', end: '2026-10-31' };

describe('the period service (Story 4.5, AD-7)', () => {
  it('weeks start on the profile first day: Monday, Sunday or Saturday', () => {
    // 2026-11-12 is a Thursday.
    expect(weekFor('2026-11-12', 'mon')).toEqual({ start: '2026-11-09', end: '2026-11-15', kind: 'week' });
    expect(weekFor('2026-11-12', 'sun')).toEqual({ start: '2026-11-08', end: '2026-11-14', kind: 'week' });
    expect(weekFor('2026-11-12', 'sat')).toEqual({ start: '2026-11-07', end: '2026-11-13', kind: 'week' });
    // The first day itself and the last day belong to the same week.
    expect(weekFor('2026-11-09', 'mon').start).toBe('2026-11-09');
    expect(weekFor('2026-11-15', 'mon').start).toBe('2026-11-09');
    expect(weekFor('2026-11-16', 'mon').start).toBe('2026-11-16');
  });

  it('calendar months and one-off custom ranges (inclusive, none outside the range)', () => {
    expect(calendarMonthFor('2026-02-14')).toEqual({ start: '2026-02-01', end: '2026-02-28', kind: 'calendar_month' });
    const rule = { rule: 'custom' as const, customStart: '2026-11-10', customEnd: '2026-11-10' };
    const profile = { rule: { kind: 'first' } as PaydayRule, firstDay: 'mon' as const };
    expect(budgetPeriodFor(rule, '2026-11-10', profile)).toEqual(customPeriod('2026-11-10', '2026-11-10'));
    expect(periodDays(customPeriod('2026-11-10', '2026-11-10'))).toBe(1);
    expect(budgetPeriodFor(rule, '2026-11-09', profile)).toBeNull();
    expect(budgetPeriodFor(rule, '2026-11-11', profile)).toBeNull();
  });

  it('previousPeriod follows the same rule: month, week, pay cycle (with a short February) and none for a custom range', () => {
    const profile = { rule: { kind: 'day', day: 31 } as PaydayRule, firstDay: 'mon' as const };
    expect(previousPeriod(calendarMonthFor('2026-03-10'), profile)).toEqual(calendarMonthFor('2026-02-01'));
    expect(previousPeriod(weekFor('2026-11-12', 'mon'), profile)).toEqual(weekFor('2026-11-02', 'mon'));
    const cycle = periodFor('2026-03-05', profile.rule); // from 28 Feb (31 falls on the last day of a short month)
    const before = previousPeriod(cycle, profile)!;
    expect(before.end).toBe(addDays(cycle.start, -1));
    expect(before.start <= before.end).toBe(true);
    expect(previousPeriod(customPeriod('2026-11-01', '2026-11-10'), profile)).toBeNull();
  });

  it('walking back with previousPeriod covers every date exactly once (no gap, no overlap)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 31 }), fc.constantFrom('mon', 'sun', 'sat'), fc.constantFrom('default', 'monthly', 'weekly'), (day, firstDay, ruleKind) => {
        const profile = { rule: { kind: 'day', day } as PaydayRule, firstDay };
        let p = budgetPeriodFor({ rule: ruleKind }, '2026-11-12', profile)!;
        for (let i = 0; i < 14; i++) {
          const prev = previousPeriod(p, profile)!;
          if (addDays(prev.end, 1) !== p.start) return false;
          if (prev.start > prev.end) return false;
          p = prev;
        }
        return true;
      }),
    );
  });
});

describe('budgetUsed and refundSurplus (Story 4.5, BDG-006)', () => {
  it('the November example: Shopping ₹2,000 and a ₹9,000 refund of an October TV, Food ₹10,000, ₹50,000 overall', async () => {
    const { db, spend, refund, budget } = await setup();
    const tv = await spend('cat_shopping', 900_000, oct(20));
    await spend('cat_shopping', 200_000, nov(3));
    await spend('cat_food', 1_000_000, nov(5));
    await refund(tv, 900_000); // dated now: 12 Nov
    const q = db;
    const overall = await budgetFigures(q, budget(), NOV);
    expect(overall.usedMinor).toBe(1_000_000); // Shopping floors at 0; Food ₹10,000
    expect(overall.refundSurplusMinor).toBe(700_000); // ₹7,000: Refunds this period: +₹7,000
    expect(5_000_000 - overall.usedMinor).toBe(4_000_000); // Left in budget ₹40,000
    const shopping = await budgetFigures(q, budget({ scope: 'category', categoryIds: ['cat_shopping'] }), NOV);
    expect(shopping).toEqual({ usedMinor: 0, refundSurplusMinor: 700_000 });
    // October's totals are unchanged by the November refund.
    expect((await budgetFigures(q, budget(), OCT)).usedMinor).toBe(900_000);
  });

  it('counts only confirmed, live expenses: not needs-review, removed, reversed entries or transfers', async () => {
    const { db, writer, spend, budget, accountId, cashId } = await setup();
    await spend('cat_food', 100_000, nov(2));
    const held = await spend('cat_food', 200_000, nov(3));
    const gone = await spend('cat_food', 400_000, nov(4));
    const reversed = await spend('cat_food', 800_000, nov(5));
    db.raw.exec(`UPDATE "transaction" SET status = 'needs_review' WHERE id = '${held}'`);
    db.raw.exec(`UPDATE "transaction" SET removed_at = 1, removal_kind = 'deleted' WHERE id = '${gone}'`);
    expect((await writer.run(ReverseTransaction, { transactionId: reversed }, 'user')).ok).toBe(true);
    const t = await writer.run(SubmitCapture, { submissionId: 'tr-1', sourceKind: 'manual', transfer: { fromAccountId: accountId, toAccountId: cashId, amountMinor: 300_000, occurredAtMs: nov(6) } }, 'user');
    expect(t.ok).toBe(true);
    expect((await budgetFigures(db, budget(), NOV)).usedMinor).toBe(100_000);
  });

  it('a reversed payment in an ended period no longer counts in that period', async () => {
    const { db, writer, spend, budget } = await setup();
    const a = await spend('cat_shopping', 500_000, oct(10));
    await spend('cat_shopping', 100_000, oct(11));
    expect((await budgetFigures(db, budget(), OCT)).usedMinor).toBe(600_000);
    expect((await writer.run(ReverseTransaction, { transactionId: a }, 'user')).ok).toBe(true);
    expect((await budgetFigures(db, budget(), OCT)).usedMinor).toBe(100_000);
    expect((await budgetFigures(db, budget(), NOV)).usedMinor).toBe(0);
  });

  it('subcategories roll into their parent; overall counts Uncategorised and Other; category, type and account scopes narrow it', async () => {
    const { db, writer, spend, budget, accountId, cashId } = await setup();
    const parent = await writer.run(SaveCategory, { name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need' }, 'user');
    if (!parent.ok) throw new Error('cat');
    const sub = await writer.run(SaveCategory, { name: 'Petrol', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'want', parentId: parent.value.categoryId }, 'user');
    if (!sub.ok) throw new Error('sub');
    await spend(parent.value.categoryId, 100_000, nov(2));
    await spend(sub.value.categoryId, 50_000, nov(3));
    await spend('cat_uncategorised', 30_000, nov(4));
    await spend('cat_other', 20_000, nov(5), cashId);
    await spend('cat_food', 70_000, nov(6), cashId);
    const fuel = await budgetFigures(db, budget({ scope: 'category', categoryIds: [parent.value.categoryId] }), NOV);
    expect(fuel.usedMinor).toBe(150_000);
    expect((await budgetFigures(db, budget(), NOV)).usedMinor).toBe(270_000);
    // Type scope reads the parent's type (Need): Fuel and its subcategory (the subcategory's own Want does not split them).
    expect((await budgetFigures(db, budget({ scope: 'budget_type', budgetType: 'need' }), NOV)).usedMinor).toBe(150_000);
    expect((await budgetFigures(db, budget({ scope: 'budget_type', budgetType: 'want' }), NOV)).usedMinor).toBe(70_000);
    // Account scope counts only entries posted on its accounts.
    expect((await budgetFigures(db, budget({ accountIds: [cashId] }), NOV)).usedMinor).toBe(90_000);
    expect((await budgetFigures(db, budget({ accountIds: [accountId] }), NOV)).usedMinor).toBe(180_000);
  });

  it('overlapping overall and category budgets each count on their own', async () => {
    const { db, spend, budget } = await setup();
    await spend('cat_groceries', 400_000, nov(2));
    await spend('cat_food', 100_000, nov(3));
    const overall = await budgetFigures(db, budget(), NOV);
    const groceries = await budgetFigures(db, budget({ scope: 'category', categoryIds: ['cat_groceries'] }), NOV);
    expect([overall.usedMinor, groceries.usedMinor]).toEqual([500_000, 400_000]);
  });

  it('a savings budget and an empty category scope count no spending', async () => {
    const { db, spend, budget } = await setup();
    await spend('cat_food', 100_000, nov(3));
    expect((await budgetFigures(db, budget({ scope: 'savings' }), NOV)).usedMinor).toBe(0);
    expect((await budgetFigures(db, budget({ scope: 'category', categoryIds: [] }), NOV)).usedMinor).toBe(0);
  });

  it('property: overall used is the sum of the floored category amounts and never below zero', () => {
    const net = fc.record({ categoryId: fc.string({ minLength: 1, maxLength: 6 }), netMinor: fc.integer({ min: -5_000_000, max: 5_000_000 }) });
    fc.assert(
      fc.property(fc.array(net, { maxLength: 12 }), (nets: CategoryNet[]) => {
        const f = figuresFromNets(nets);
        const floored = nets.reduce((s, n) => s + Math.max(0, n.netMinor), 0);
        const surplus = nets.reduce((s, n) => s + Math.max(0, -n.netMinor), 0);
        return f.usedMinor === floored && f.usedMinor >= 0 && f.refundSurplusMinor === surplus && f.refundSurplusMinor >= 0;
      }),
    );
  });
});

describe('budgetStatus (Story 4.5, BDG-003)', () => {
  const NOVP = { start: '2026-11-01', end: '2026-11-30' };
  const at = (day: number, used: number, target = 5_000_000, extra: Partial<Parameters<typeof budgetStatus>[0]> = {}) => budgetStatus({ usedMinor: used, targetMinor: target, period: NOVP, today: `2026-11-${String(day).padStart(2, '0')}`, ...extra });

  it('insufficient-data until 3 days have passed (and no projection)', () => {
    const s = at(2, 100_000);
    expect(s).toMatchObject({ status: 'insufficient-data', projectedMinor: null, daysRemaining: 29 });
    expect(at(3, 100_000).status).not.toBe('insufficient-data');
  });

  it('on-track, nearing (by threshold or by projection) and exceeded', () => {
    expect(at(10, 500_000)).toMatchObject({ status: 'on-track', percentUsed: 10, remainingMinor: 4_500_000, daysRemaining: 21, projectedMinor: 1_500_000 });
    expect(at(10, 3_800_000).status).toBe('nearing'); // 76% >= 75%
    expect(at(10, 3_700_000).status).toBe('nearing'); // 74%, but projected 11.1M > 5M
    expect(at(10, 100_000, 5_000_000, { nearingPercent: 1 }).status).toBe('nearing');
    expect(at(20, 5_000_000).status).toBe('nearing'); // used == target is not exceeded
    expect(at(20, 5_000_001)).toMatchObject({ status: 'exceeded', remainingMinor: -1 });
  });

  it('exceeded is never hidden behind insufficient-data', () => {
    expect(at(1, 9_000_000).status).toBe('exceeded');
  });

  it('the projection is used ÷ days elapsed × days in the period, an estimate', () => {
    expect(at(10, 1_000_000).projectedMinor).toBe(3_000_000); // 1,000,000 / 10 x 30
    expect(at(15, 1_500_000).projectedMinor).toBe(3_000_000);
  });

  it('a zero target is exceeded by any spending and otherwise on track', () => {
    expect(at(10, 0, 0)).toMatchObject({ status: 'on-track', percentUsed: 0 });
    expect(at(10, 1, 0)).toMatchObject({ status: 'exceeded', percentUsed: 100, remainingMinor: -1 });
  });

  it('a one-day custom range: day 1 is insufficient-data, exceeded still shows, then it ends', () => {
    const one = { start: '2026-11-10', end: '2026-11-10' };
    expect(budgetStatus({ usedMinor: 10, targetMinor: 100, period: one, today: '2026-11-10' })).toMatchObject({ status: 'insufficient-data', daysRemaining: 1, projectedMinor: null });
    expect(budgetStatus({ usedMinor: 200, targetMinor: 100, period: one, today: '2026-11-10' }).status).toBe('exceeded');
    expect(budgetStatus({ usedMinor: 10, targetMinor: 100, period: one, today: '2026-11-11' })).toMatchObject({ daysRemaining: 0, projectedMinor: null, status: 'on-track' });
  });

  it('a period that ended has 0 days remaining and no projection; a period not started has all its days', () => {
    expect(budgetStatus({ usedMinor: 4_000_000, targetMinor: 5_000_000, period: NOVP, today: '2026-12-02' })).toMatchObject({ daysRemaining: 0, projectedMinor: null, status: 'nearing' });
    expect(budgetStatus({ usedMinor: 0, targetMinor: 5_000_000, period: NOVP, today: '2026-10-30' })).toMatchObject({ daysRemaining: 30, projectedMinor: null });
  });

  it('a past period keeps the target version it had', () => {
    const versions = [{ version: 1, targetMinor: 5_000_000, effectiveFrom: '2026-09-01' }, { version: 2, targetMinor: 4_500_000, effectiveFrom: '2026-11-01' }];
    expect(targetForPeriod(versions, '2026-10-01')).toBe(5_000_000);
    expect(targetForPeriod(versions, '2026-11-01')).toBe(4_500_000);
    expect(targetForPeriod(versions, '2026-08-01')).toBeNull();
    const oct = budgetStatus({ usedMinor: 2_000_000, targetMinor: targetForPeriod(versions, '2026-10-01')!, period: OCT, today: '2026-11-12' });
    expect(oct.remainingMinor).toBe(3_000_000);
  });
});

describe('periods across a boundary and RebuildBudgetPeriods (Story 4.5, BDG-005, ONB-006)', () => {
  async function withBudget(payday: PaydayRule) {
    const s = await setup(payday);
    s.db.raw.exec(`INSERT INTO budget (id, name, scope, period_rule, created_at) VALUES ('b1', 'Overall', 'overall', 'default', 1)`);
    s.db.raw.exec(`INSERT INTO budget_target_version (budget_id, version, target_minor, effective_from) VALUES ('b1', 1, 5000000, '2026-09-01'), ('b1', 2, 4500000, '2026-11-01')`);
    return s;
  }
  const periods = async (db: NodeSqliteDatabase) => (await db.query('SELECT start_date, end_date, target_minor FROM budget_period WHERE budget_id = ? ORDER BY start_date', ['b1'])).map((r) => [String(r[0]), String(r[1]), Number(r[2])]);

  it('caches the current period and the earlier ones back to the first target, each with the version it had', async () => {
    const { db, writer } = await withBudget({ kind: 'first' });
    expect((await writer.run(RebuildBudgetPeriods, {}, 'system')).ok).toBe(true);
    expect(await periods(db)).toEqual([
      ['2026-09-01', '2026-09-30', 5_000_000],
      ['2026-10-01', '2026-10-31', 5_000_000],
      ['2026-11-01', '2026-11-30', 4_500_000],
      ['2026-12-01', '2026-12-31', 4_500_000],
    ]);
  });

  it('a payday change rebuilds the cache from the period service and modifies no transaction, split or posting', async () => {
    const { db, writer, spend } = await withBudget({ kind: 'first' });
    await spend('cat_food', 100_000, nov(3));
    await spend('cat_food', 250_000, oct(28));
    const fingerprint = async () => JSON.stringify([await db.query('SELECT * FROM "transaction" ORDER BY id'), await db.query('SELECT * FROM split ORDER BY id'), await db.query('SELECT * FROM posting ORDER BY id')]);
    await writer.run(RebuildBudgetPeriods, {}, 'system');
    const before = await fingerprint();
    const usedBefore = (await budgetFigures(db, { id: 'b1', scope: 'overall', categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' } }, NOV)).usedMinor;
    db.raw.exec(`UPDATE profile SET payday_rule = 'day', payday_day = 25`);
    await db.query('DELETE FROM audit_event');
    expect((await writer.run(RebuildBudgetPeriods, {}, 'system')).ok).toBe(true);
    // Today (12 Nov) now sits in the cycle that began on 25 Oct; each period keeps the target version it had.
    expect((await periods(db)).slice(-3)).toEqual([
      ['2026-09-25', '2026-10-24', 5_000_000],
      ['2026-10-25', '2026-11-24', 5_000_000],
      ['2026-11-25', '2026-12-24', 4_500_000],
    ]);
    expect(await fingerprint()).toBe(before);
    const kinds = (await db.query('SELECT DISTINCT entity_kind FROM audit_event')).map((r) => String(r[0]));
    expect(kinds.filter((k) => k === 'transaction')).toEqual([]);
    // The same entries are counted again by their own dates in the new periods.
    const used = await budgetFigures(db, { id: 'b1', scope: 'overall', categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' } }, { start: '2026-10-25', end: '2026-11-24' });
    expect(used.usedMinor).toBe(350_000);
    expect(usedBefore).toBe(100_000);
  });

  it('across midnight on the boundary nothing is reset: the old period keeps its figures, the new one starts at zero with no rollover', async () => {
    const { db, clock, spend, budget } = await setup();
    await spend('cat_food', 700_000, nov(30, 20));
    const profile = { rule: { kind: 'first' } as PaydayRule, firstDay: 'mon' as const };
    const before = await budgetFigures(db, budget(), NOV);
    clock.advance(DAY * 19); // into December
    const after = await budgetFigures(db, budget(), NOV);
    expect(after).toEqual(before);
    const dec = budgetPeriodFor({ rule: 'default' }, '2026-12-01', profile)!;
    expect((await budgetFigures(db, budget(), dec)).usedMinor).toBe(0);
    expect(budgetStatus({ usedMinor: after.usedMinor, targetMinor: 5_000_000, period: NOV, today: '2026-12-01' })).toMatchObject({ usedMinor: 700_000, daysRemaining: 0 });
  });

  it('a custom range keeps one period and none after it ends; periodsToCache never walks past the cap', () => {
    const profile = { rule: { kind: 'first' } as PaydayRule, firstDay: 'mon' as const };
    const custom: BudgetDef = { id: 'c', scope: 'overall', categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'custom', customStart: '2026-11-01', customEnd: '2026-11-10' } };
    expect(periodsToCache(custom, '2026-11-01', '2026-11-05', profile)).toEqual([customPeriod('2026-11-01', '2026-11-10')]);
    const monthly: BudgetDef = { ...custom, period: { rule: 'monthly' } };
    expect(periodsToCache(monthly, '2000-01-01', '2026-11-12', profile)).toHaveLength(37); // the next period plus the cap of 36
  });
});

describe('architecture: planning code never computes a period boundary itself (AD-7)', () => {
  it('has no date arithmetic in src/planning', () => {
    for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect({ file: f, hits: src.match(/new Date\(|Date\.UTC|Date\.parse|\.getUTC\w+\(|\.setDate\(|\.setMonth\(/g) ?? [] }).toEqual({ file: f, hits: [] });
    }
  });
});
