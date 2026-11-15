import { freeToUse, loadPlanTimeline, type CurrencyCode, type FreeToUse, type PlanTimeline } from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface PlanTimelineData {
  readonly timeline: PlanTimeline;
  readonly currency: CurrencyCode;
  readonly locale: string;
}

export interface FreeToUseData {
  readonly free: FreeToUse;
  readonly currency: CurrencyCode;
  readonly locale: string;
  /** The profile has a payday (`Bills before payday`) rather than month-end. */
  readonly payCycle: boolean;
}

/** What the Plan hub's own sections need. The real one reads through core; tests pass a fake. */
export interface PlanApi {
  /** The "Before payday" timeline and the counts the hub's sections use. */
  loadTimeline(): Promise<PlanTimelineData | null>;
  /** Free to use (Story 6.9): the estimate, or the one step it still needs. */
  loadFreeToUse(): Promise<FreeToUseData | null>;
}

export const PLAN_TIMELINE_KEY = ['plan', 'timeline'] as const;
export const PLAN_FREE_KEY = ['plan', 'free'] as const;

export const realPlanApi: PlanApi = {
  async loadTimeline() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const timeline = await loadPlanTimeline(db, systemClock.nowMs());
    return timeline ? { timeline, currency: p.currency, locale: p.locale } : null;
  },
  async loadFreeToUse() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const timeline = await loadPlanTimeline(db, systemClock.nowMs());
    return { free: await freeToUse(db, systemClock.nowMs()), currency: p.currency, locale: p.locale, payCycle: timeline ? timeline.period.payCycle : true };
  },
};
