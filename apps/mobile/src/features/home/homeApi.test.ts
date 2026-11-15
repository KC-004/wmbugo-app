import type { HomeSummary } from '@wmbugo/core';
import { homeDataFrom } from './homeApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

const summary: HomeSummary = {
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
  spentThisPeriodMinor: 700_000,
  accounts: { hasAccounts: true, inAccountsMinor: 5_230_000, notSetCount: 0, cardDuesMinor: 410_000, notSetCards: 0 },
  toCheckCount: 2,
};

describe('homeDataFrom (Story 5.1)', () => {
  it('maps the snapshot to what Home shows: today, scope, the spent figure and the accounts', () => {
    const d = homeDataFrom({ currency: 'INR', locale: 'en-IN', timezoneId: 'Asia/Kolkata' }, summary, Date.UTC(2026, 10, 18, 4, 0, 0));
    expect(d).toMatchObject({ currency: 'INR', locale: 'en-IN', timezoneId: 'Asia/Kolkata', today: '2026-11-18', scope: 'This month', spentMinor: 700_000, hour: 9 });
    expect(d.accounts).toBe(summary.accounts);
    expect(d.summary).toBe(summary);
  });

  it('builds the hero with the profile currency exponent', () => {
    const inr = homeDataFrom({ currency: 'INR', locale: 'en-IN', timezoneId: 'Asia/Kolkata' }, summary, 0);
    expect(inr.hero).toMatchObject({ state: 'under', amountMinor: 1_186_000, perDayMinor: 98_800 });
    // A whole-unit currency (no minor unit) rounds to whole units of that currency.
    const jpy = homeDataFrom({ currency: 'IDR', locale: 'id-ID', timezoneId: 'Asia/Jakarta' }, { ...summary, leftMinor: 11_860, usedMinor: 8_140, targetMinor: 20_000 }, 0);
    expect(jpy.hero).toMatchObject({ perDayMinor: 988 });
  });
});
