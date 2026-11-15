import type { HomeSummary } from '@wmbugo/core';
import { copy } from '../../shared/copy';

/**
 * The Home hero as a view model (Story 5.1, UX-DR101). A pure function of the Home snapshot: it decides the state, the
 * label and the day line, and it has no path that outputs a negative amount or a minus sign. Every amount it returns is
 * zero or more, in minor units; a screen formats it. Being over budget is `over` with `overMinor`, never a negative left.
 */

export type HeroState = 'under' | 'over' | 'spent_only' | 'loading';

export interface HeroView {
  readonly state: HeroState;
  /** `Left in budget`, `Over budget`, `Spent this period` (empty while loading). */
  readonly label: string;
  /** Under: what is left. Over: how far over. Spent only: what was spent. Always zero or more; null while loading. */
  readonly amountMinor: number | null;
  readonly usedMinor: number | null;
  readonly targetMinor: number | null;
  /** Under only: left ÷ days, rounded down to a whole major unit, in minor units. Null when over, spent only or no days remain. */
  readonly perDayMinor: number | null;
  /** `12 days left` or `5 days to payday` (`1 day ...` in the singular); null while loading. */
  readonly daysText: string | null;
  /** Only the 50/30/20 targets exist and some spending is not classified. */
  readonly notClassified: boolean;
  /** No account, or an included account or card has no balance yet. */
  readonly accountsNotSet: boolean;
}

const dayCount = (n: number, payday: boolean): string => {
  const h = copy.home.hero;
  if (n === 1) return payday ? h.dayToPayday : h.dayLeft;
  return (payday ? h.daysToPayday : h.daysLeft).replace('{n}', String(n));
};

/** Per-day figure: whole major units, rounded down. `exponent` is the profile currency's. */
export function perDay(leftMinor: number, days: number, exponent: number): number | null {
  if (days <= 0 || leftMinor < 0) return null;
  const unit = 10 ** exponent;
  return Math.floor(leftMinor / days / unit) * unit;
}

export function presentHero(summary: HomeSummary | null | undefined, exponent: number): HeroView {
  if (!summary) {
    return { state: 'loading', label: '', amountMinor: null, usedMinor: null, targetMinor: null, perDayMinor: null, daysText: null, notClassified: false, accountsNotSet: false };
  }
  const a = summary.accounts;
  const accountsNotSet = !a.hasAccounts || a.inAccountsMinor === null || a.notSetCount > 0 || a.notSetCards > 0;
  const payday = summary.daysToPayday !== null;
  const days = payday ? summary.daysToPayday! : summary.daysLeft;
  const daysText = dayCount(Math.max(0, days), payday);

  if (summary.heroMode === 'spent_only' || summary.usedMinor === null || summary.targetMinor === null || summary.leftMinor === null) {
    return { state: 'spent_only', label: copy.home.spentThisPeriod, amountMinor: Math.max(0, summary.spentThisPeriodMinor), usedMinor: null, targetMinor: null, perDayMinor: null, daysText, notClassified: false, accountsNotSet };
  }
  const notClassified = summary.heroMode === 'nws_only' && summary.notClassifiedMinor > 0;
  const base = { usedMinor: Math.max(0, summary.usedMinor), targetMinor: Math.max(0, summary.targetMinor), notClassified, accountsNotSet };
  if (summary.usedMinor > summary.targetMinor) {
    return { ...base, state: 'over', label: copy.home.hero.overBudget, amountMinor: summary.usedMinor - summary.targetMinor, perDayMinor: null, daysText };
  }
  return { ...base, state: 'under', label: copy.home.hero.leftInBudget, amountMinor: Math.max(0, summary.leftMinor), perDayMinor: perDay(summary.leftMinor, days, exponent), daysText };
}
