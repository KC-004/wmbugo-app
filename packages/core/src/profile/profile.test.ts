import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { getCurrency, SUPPORTED_CURRENCIES } from '../shared/currency';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { MemoryDatabase } from '../writer/fakes';
import { LedgerWriter, type Invariant } from '../writer/ledgerWriter';
import {
  canContinue,
  continueHint,
  initialOnboarding,
  isComplete,
  onboardingReducer,
  parseRoughIncome,
  type OnboardingState,
} from './onboarding';
import { paydayFromChoice, periodModeFor } from './payday';
import { detectRegion, findRegion, REGIONS, searchRegions } from './regions';
import { PROMPT_BUDGET_NOT_NOW, PROMPT_BUDGET_YES, SETTING_ROUGH_INCOME, SETTING_THEME, SetUpProfile } from './setUpProfile';

describe('regions', () => {
  it('every region maps to a supported currency, and every currency has a region', () => {
    for (const r of REGIONS) expect(getCurrency(r.currency).ok).toBe(true);
    const used = new Set(REGIONS.map((r) => r.currency));
    for (const c of SUPPORTED_CURRENCIES) expect(used.has(c.code)).toBe(true);
    expect(new Set(REGIONS.map((r) => r.code)).size).toBe(REGIONS.length);
  });

  it('detects Singapore and India regardless of language, and nothing for a non-Phase 1 region', () => {
    expect(detectRegion('SG')).toMatchObject({ name: 'Singapore', currency: 'SGD' });
    expect(detectRegion('in')).toMatchObject({ currency: 'INR', locale: 'en-IN' });
    expect(detectRegion('JP')).toBeNull();
    expect(detectRegion('')).toBeNull();
    expect(detectRegion(null)).toBeNull();
    expect(findRegion(undefined)).toBeNull();
  });

  it('searches by country name or currency code and pins the detected region first', () => {
    expect(searchRegions('sing').map((r) => r.code)).toEqual(['SG']);
    expect(searchRegions('inr').map((r) => r.code)).toEqual(['IN']);
    expect(searchRegions('eur').length).toBeGreaterThan(5);
    expect(searchRegions('zzz')).toEqual([]);
    expect(searchRegions('')).toHaveLength(REGIONS.length);
    const sg = findRegion('SG')!;
    expect(searchRegions('', sg)[0]).toEqual(sg);
    expect(searchRegions('in', findRegion('IN'))[0]!.code).toBe('IN');
    expect(searchRegions('united', sg).map((r) => r.code)).not.toContain('SG');
  });
});

describe('payday', () => {
  it.each(['first', 'last_day', 'last_working_day', 'none'] as const)('%s needs no day', (c) => {
    expect(paydayFromChoice(c)).toEqual({ ok: true, value: { kind: c } });
  });

  it('Other needs a day 1-31', () => {
    expect(paydayFromChoice('other', 15)).toEqual({ ok: true, value: { kind: 'day', day: 15 } });
    expect(paydayFromChoice('other', 1).ok).toBe(true);
    expect(paydayFromChoice('other', 31).ok).toBe(true);
    for (const bad of [0, 32, -1, 1.5, NaN, undefined]) expect(paydayFromChoice('other', bad as number)).toEqual({ ok: false, code: 'PAYDAY_INVALID' });
  });

  it('the pay cycle is the default period unless Not salaried (calendar month)', () => {
    expect(periodModeFor({ kind: 'first' })).toBe('pay_cycle');
    expect(periodModeFor({ kind: 'last_working_day' })).toBe('pay_cycle');
    expect(periodModeFor({ kind: 'day', day: 25 })).toBe('pay_cycle');
    expect(periodModeFor({ kind: 'none' })).toBe('calendar_month');
  });
});

describe('onboarding state machine', () => {
  const sg = findRegion('SG')!;
  const run = (s: OnboardingState, ...actions: Parameters<typeof onboardingReducer>[1][]) => actions.reduce(onboardingReducer, s);

  it('starts at Welcome with the detected region pre-selected, or nothing for an unsupported one', () => {
    expect(initialOnboarding(sg)).toMatchObject({ step: 'welcome', region: sg, payday: null, budgetOffer: null });
    expect(initialOnboarding(null).region).toBeNull();
  });

  it('Welcome continues in one tap; the region step needs a region; the payday step needs a payday; the last needs an answer', () => {
    let s = initialOnboarding(null);
    expect(canContinue(s)).toBe(true);
    s = run(s, { type: 'continue' });
    expect(s.step).toBe('region');
    expect(canContinue(s)).toBe(false);
    expect(continueHint(s)).toBe('choose-region');
    expect(run(s, { type: 'continue' }).step).toBe('region'); // disabled Continue does nothing
    s = run(s, { type: 'choose-region', region: sg }, { type: 'continue' });
    expect(s.step).toBe('payday');
    expect(continueHint(s)).toBe('choose-payday');
    s = run(s, { type: 'choose-payday', choice: 'last_day' }, { type: 'continue' });
    expect(s.step).toBe('budget-offer');
    expect(continueHint(s)).toBe('answer-budget');
    expect(isComplete(s)).toBe(false);
    s = run(s, { type: 'answer-budget', offer: { answer: 'not-now' } });
    expect(isComplete(s)).toBe(true);
    expect(continueHint(s)).toBeNull();
  });

  it('Back keeps earlier answers and never goes before Welcome', () => {
    let s = run(initialOnboarding(sg), { type: 'continue' }, { type: 'continue' }, { type: 'choose-payday', choice: 'first' }, { type: 'continue' });
    expect(s.step).toBe('budget-offer');
    s = run(s, { type: 'back' }, { type: 'back' });
    expect(s.step).toBe('region');
    expect(s.region).toEqual(sg);
    expect(s.payday).toEqual({ kind: 'first' });
    s = run(s, { type: 'back' }, { type: 'back' }, { type: 'back' });
    expect(s.step).toBe('welcome');
  });

  it('an invalid Other day clears the payday so Continue stays disabled', () => {
    const s = run(initialOnboarding(sg), { type: 'continue' }, { type: 'continue' }, { type: 'choose-payday', choice: 'other', day: 40 });
    expect(s.payday).toBeNull();
    expect(canContinue(s)).toBe(false);
    expect(run(s, { type: 'choose-payday', choice: 'other', day: 25 }).payday).toEqual({ kind: 'day', day: 25 });
  });

  it('rejects an unknown region and parses a rough income in the profile currency', () => {
    const s = initialOnboarding(null);
    expect(onboardingReducer(s, { type: 'choose-region', region: { code: 'ZZ', name: 'x', currency: 'INR', locale: 'en' } }).region).toBeNull();
    expect(parseRoughIncome('50000', findRegion('IN')!)).toEqual({ ok: true, minor: 5000000 });
    expect(parseRoughIncome('1500.5', findRegion('SG')!)).toEqual({ ok: true, minor: 150050 });
    expect(parseRoughIncome('1500', findRegion('ID')!)).toEqual({ ok: true, minor: 1500 });
    for (const bad of ['', '0', 'abc', '-5', '1.234']) expect(parseRoughIncome(bad, findRegion('SG')!).ok).toBe(false);
  });
});

describe('SetUpProfile', () => {
  const singleProfile: Invariant = {
    name: 'singleProfile',
    async check(ctx) {
      const rows = await ctx.query('SELECT 1 FROM profile LIMIT 1');
      return rows.length > 1 ? 'more than one profile' : null;
    },
  };
  function setup() {
    const db = new MemoryDatabase();
    const clock = new FakeClock(1_700_000_000_000, 'Asia/Singapore');
    const writer = new LedgerWriter({
      uow: db,
      clock,
      newId: createIdGenerator(clock, seededRandom(5)),
      logger: createRedactingLogger({ write: () => undefined }),
      invariants: [singleProfile],
    });
    return { db, writer };
  }
  const input = (over: Partial<Parameters<typeof SetUpProfile.execute>[1]> = {}) => ({
    region: findRegion('SG')!,
    payday: { kind: 'last_day' as const },
    budgetOffer: { answer: 'not-now' as const },
    timezoneId: 'Asia/Singapore',
    ...over,
  });

  it('writes profile, settings (theme System) and the answer in one transaction and emits ProfileChanged', async () => {
    const { db, writer } = setup();
    const r = await writer.run(SetUpProfile, input(), 'user');
    expect(r.ok).toBe(true);
    expect(db.profile).toHaveLength(1);
    const p = db.profile[0]!.params;
    expect([p[1], p[2], p[3], p[4], p[5], p[6], p[7]]).toEqual(['SG', 'SGD', 2, 'en-SG', 'Asia/Singapore', 'last_day', null]);
    expect(db.settings.map((s) => s.params[0])).toEqual([SETTING_THEME]);
    expect(db.settings[0]!.params[1]).toBe('"system"');
    expect(db.promptState.map((s) => s.params[0])).toEqual([PROMPT_BUDGET_NOT_NOW]);
    expect(db.outbox.map((o) => o.event)).toEqual(['ProfileChanged']);
    expect(db.audit.map((a) => [a.kind, a.entity_kind])).toEqual([['SetUpProfile', 'profile']]);
  });

  it('stores the exponent from the currency table: whole units for IDR, three digits for BHD', async () => {
    const id = setup();
    await id.writer.run(SetUpProfile, input({ region: findRegion('ID')! }), 'user');
    expect(id.db.profile[0]!.params[3]).toBe(0);
    const bh = setup();
    await bh.writer.run(SetUpProfile, input({ region: findRegion('BH')! }), 'user');
    expect(bh.db.profile[0]!.params[3]).toBe(3);
  });

  it('saves a Yes answer with the rough income, and creates no budget', async () => {
    const { db, writer } = setup();
    await writer.run(SetUpProfile, input({ budgetOffer: { answer: 'yes', roughMonthlyIncomeMinor: 5000000 } }), 'user');
    expect(db.promptState.map((s) => s.params[0])).toEqual([PROMPT_BUDGET_YES]);
    expect(db.settings.map((s) => s.params[0])).toEqual([SETTING_THEME, SETTING_ROUGH_INCOME]);
    expect(db.settings[1]!.params[1]).toBe('5000000');
    expect(db.audit[0]!.change_json).not.toMatch(/5000000/);
  });

  it('a skipped step writes no prompt_state', async () => {
    const { db, writer } = setup();
    await writer.run(SetUpProfile, input({ budgetOffer: { answer: 'skipped' } }), 'user');
    expect(db.promptState).toHaveLength(0);
  });

  it('a Day payday stores the day', async () => {
    const { db, writer } = setup();
    await writer.run(SetUpProfile, input({ payday: { kind: 'day', day: 25 } }), 'user');
    expect(db.profile[0]!.params.slice(6, 8)).toEqual(['day', 25]);
  });

  it('refuses a second profile and writes nothing more', async () => {
    const { db, writer } = setup();
    await writer.run(SetUpProfile, input(), 'user');
    const again = await writer.run(SetUpProfile, input({ region: findRegion('IN')! }), 'user');
    expect(again).toEqual({ ok: false, code: 'PROFILE_EXISTS' });
    expect(db.profile).toHaveLength(1);
    expect(db.outbox).toHaveLength(1);
  });

  it('a crash midway leaves no profile (process death before finishing restarts at Welcome)', async () => {
    const { db, writer } = setup();
    const crashing = { ...SetUpProfile, execute: async (ctx: Parameters<typeof SetUpProfile.execute>[0], i: Parameters<typeof SetUpProfile.execute>[1]) => {
      await SetUpProfile.execute(ctx, i);
      throw new Error('killed');
    } };
    expect(await writer.run(crashing, input(), 'user')).toEqual({ ok: false, code: 'WRITE_FAILED' });
    expect(db.profile).toHaveLength(0);
    expect(db.settings).toHaveLength(0);
    expect(db.outbox).toHaveLength(0);
  });

  it('an unsupported currency is rejected', async () => {
    const { db, writer } = setup();
    const bad = { code: 'ZZ', name: 'x', currency: 'XXX' as never, locale: 'en' };
    expect(await writer.run(SetUpProfile, input({ region: bad }), 'user')).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
    expect(db.profile).toHaveLength(0);
  });
});
