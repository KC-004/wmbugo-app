import type { HomeAccounts, HomeSummary } from '@wmbugo/core';
import { homeDataFrom, type HomeData } from './homeApi';

/** Test helpers: a Home snapshot and the screen data built from it the same way the app builds it. */
export const BASE_ACCOUNTS: HomeAccounts = { hasAccounts: true, inAccountsMinor: 320_000, notSetCount: 0, cardDuesMinor: null, notSetCards: 0 };

export function summaryOf(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    today: '2026-11-07',
    period: { start: '2026-11-01', end: '2026-11-30', label: 'This month', title: '1–30 Nov', shortened: false },
    heroMode: 'spent_only',
    leftMinor: null,
    usedMinor: null,
    targetMinor: null,
    notClassifiedMinor: 0,
    refundSurplusMinor: 0,
    overallBudgetId: null,
    sortIt: null,
    daysLeft: 24,
    daysToPayday: 24,
    spentThisPeriodMinor: 1250,
    accounts: BASE_ACCOUNTS,
    toCheckCount: 0,
    ...over,
  };
}

export interface DataOver {
  readonly summary?: Partial<HomeSummary>;
  readonly accounts?: Partial<HomeAccounts>;
  readonly currency?: 'SGD' | 'INR';
  readonly nowMs?: number;
}

/** Screen data for a profile (default SGD, en-SG) at 09:00 local on the summary's date. */
export function homeData(over: DataOver = {}): HomeData {
  const summary = summaryOf({ ...over.summary, accounts: { ...BASE_ACCOUNTS, ...over.accounts } });
  const inr = over.currency === 'INR';
  return homeDataFrom(
    { currency: inr ? 'INR' : 'SGD', locale: inr ? 'en-IN' : 'en-SG', timezoneId: inr ? 'Asia/Kolkata' : 'Asia/Singapore' },
    summary,
    over.nowMs ?? Date.UTC(2026, 10, 7, 1, 0, 0),
  );
}
