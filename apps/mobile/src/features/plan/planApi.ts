import { loadPlanTimeline, type CurrencyCode, type PlanTimeline } from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface PlanTimelineData {
  readonly timeline: PlanTimeline;
  readonly currency: CurrencyCode;
  readonly locale: string;
}

/** What the Plan hub's own sections need. The real one reads through core; tests pass a fake. */
export interface PlanApi {
  /** The "Before payday" timeline and the counts the hub's sections use. */
  loadTimeline(): Promise<PlanTimelineData | null>;
}

export const PLAN_TIMELINE_KEY = ['plan', 'timeline'] as const;

export const realPlanApi: PlanApi = {
  async loadTimeline() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const timeline = await loadPlanTimeline(db, systemClock.nowMs());
    return timeline ? { timeline, currency: p.currency, locale: p.locale } : null;
  },
};
