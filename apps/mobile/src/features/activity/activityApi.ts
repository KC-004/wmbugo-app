import { ACTIVITY_PAGE_SIZE, ACTIVITY_SQL, groupByDay, mapActivityRows, pageActivity, toLocalDate, type ActivityDay, type CurrencyCode } from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface ActivityData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly today: string;
  readonly days: ActivityDay[];
  /** Earlier entries exist beyond this page. */
  readonly hasMore: boolean;
}

export interface ActivityApi {
  /** The newest `limit` entries (default one page). */
  load(limit?: number): Promise<ActivityData | null>;
}

export const ACTIVITY_QUERY_KEY = ['ledger', 'activity'] as const;

export const realActivityApi: ActivityApi = {
  async load(limit = ACTIVITY_PAGE_SIZE) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const today = toLocalDate(systemClock.nowMs(), p.timezoneId);
    if (!today.ok) return null;
    const page = pageActivity(mapActivityRows(await db.query(ACTIVITY_SQL, [limit + 1])), limit);
    return { currency: p.currency, locale: p.locale, today: today.value, days: groupByDay(page.rows), hasMore: page.hasMore };
  },
};
