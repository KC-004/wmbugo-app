import fc from 'fast-check';
import type { HomeSummary } from '@wmbugo/core';
import { perDay, presentHero, type HeroView } from './heroPresenter';

const accounts = { hasAccounts: true, inAccountsMinor: 5_230_000, notSetCount: 0, cardDuesMinor: 410_000, notSetCards: 0 };

function summary(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    today: '2026-11-18',
    period: { start: '2026-11-01', end: '2026-11-30', label: 'This month', shortened: false },
    heroMode: 'overall',
    leftMinor: 1_186_000,
    usedMinor: 814_000,
    targetMinor: 2_000_000,
    notClassifiedMinor: 0,
    refundSurplusMinor: 0,
    daysLeft: 12,
    daysToPayday: 12,
    spentThisPeriodMinor: 814_000,
    accounts,
    toCheckCount: 0,
    ...over,
  };
}

const strings = (h: HeroView): string[] => [h.label, h.daysText ?? ''];
const numbers = (h: HeroView): number[] => [h.amountMinor, h.usedMinor, h.targetMinor, h.perDayMinor].filter((n): n is number => n !== null);

describe('presentHero (Story 5.1)', () => {
  it('loading has no figures', () => {
    expect(presentHero(null, 2)).toMatchObject({ state: 'loading', amountMinor: null, label: '' });
  });

  it('under: Left in budget with the per-day figure rounded down to a whole rupee', () => {
    // ₹11,860 ÷ 12 = ₹988.33 → ₹988
    expect(presentHero(summary(), 2)).toMatchObject({ state: 'under', label: 'Left in budget', amountMinor: 1_186_000, perDayMinor: 98_800, daysText: '12 days to payday' });
  });

  it('under, S$413.50 over 9 days is S$45 a day', () => {
    expect(presentHero(summary({ leftMinor: 41_350, usedMinor: 0, targetMinor: 41_350, daysToPayday: 9, daysLeft: 9 }), 2)).toMatchObject({ perDayMinor: 4500, daysText: '9 days to payday' });
  });

  it('without a payday the divisor and the line use the days left', () => {
    expect(presentHero(summary({ daysToPayday: null, daysLeft: 13 }), 2)).toMatchObject({ perDayMinor: Math.floor(1_186_000 / 13 / 100) * 100, daysText: '13 days left' });
  });

  it('over: the amount over is positive, no per-day figure, the line is days to payday', () => {
    const h = presentHero(summary({ usedMinor: 2_234_000, targetMinor: 2_000_000, leftMinor: -234_000, daysToPayday: 5, daysLeft: 5 }), 2);
    expect(h).toMatchObject({ state: 'over', label: 'Over budget', amountMinor: 234_000, perDayMinor: null, daysText: '5 days to payday' });
  });

  it('the singular reads 1 day', () => {
    expect(presentHero(summary({ daysToPayday: 1 }), 2).daysText).toBe('1 day to payday');
    expect(presentHero(summary({ daysToPayday: null, daysLeft: 1 }), 2).daysText).toBe('1 day left');
  });

  it('spent only: Spent this period, no bar numbers', () => {
    expect(presentHero(summary({ heroMode: 'spent_only', leftMinor: null, usedMinor: null, targetMinor: null, spentThisPeriodMinor: 120_000 }), 2)).toMatchObject({ state: 'spent_only', label: 'Spent this period', amountMinor: 120_000, usedMinor: null, perDayMinor: null });
  });

  it('flags: not classified only for nws_only with an amount, and accounts not set', () => {
    expect(presentHero(summary({ heroMode: 'nws_only', notClassifiedMinor: 300_000 }), 2).notClassified).toBe(true);
    expect(presentHero(summary({ heroMode: 'nws_only', notClassifiedMinor: 0 }), 2).notClassified).toBe(false);
    expect(presentHero(summary({ heroMode: 'overall', notClassifiedMinor: 300_000 }), 2).notClassified).toBe(false);
    expect(presentHero(summary({ accounts: { ...accounts, hasAccounts: false, inAccountsMinor: null } }), 2).accountsNotSet).toBe(true);
    expect(presentHero(summary({ accounts: { ...accounts, notSetCards: 1 } }), 2).accountsNotSet).toBe(true);
    expect(presentHero(summary(), 2).accountsNotSet).toBe(false);
  });

  it('a whole-unit currency (exponent 0) rounds to a whole unit', () => {
    expect(perDay(1000, 3, 0)).toBe(333);
  });

  it('no days remaining gives no per-day figure instead of a division by zero', () => {
    expect(perDay(1000, 0, 2)).toBeNull();
    expect(perDay(-5, 3, 2)).toBeNull();
  });

  it('no state, in any summary, prints a minus sign or yields a negative amount (property)', () => {
    const modes = ['overall', 'nws_only', 'spent_only'] as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
        fc.constantFrom(...modes),
        fc.integer({ min: 0, max: 3 }),
        (used, target, daysLeft, daysToPayday, heroMode, exponent) => {
          const h = presentHero(
            summary({ heroMode, usedMinor: used, targetMinor: target, leftMinor: target - used, daysLeft, daysToPayday, spentThisPeriodMinor: used }),
            exponent,
          );
          expect(numbers(h).every((n) => n >= 0)).toBe(true);
          expect(strings(h).every((s) => !s.includes('-') && !s.includes('−'))).toBe(true);
          if (heroMode !== 'spent_only') expect(h.state).toBe(used > target ? 'over' : 'under');
          if (h.state === 'over') expect(h.amountMinor).toBe(used - target);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('every state has strings without a minus sign', () => {
    const all = [presentHero(null, 2), presentHero(summary(), 2), presentHero(summary({ usedMinor: 3_000_000, leftMinor: -1_000_000 }), 2), presentHero(summary({ heroMode: 'spent_only', leftMinor: null, usedMinor: null, targetMinor: null }), 2)];
    for (const h of all) for (const s of strings(h)) expect(s).not.toMatch(/[-−]/);
  });
});
