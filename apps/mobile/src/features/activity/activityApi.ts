import {
  ACCOUNT_LIST_SQL,
  ACTIVITY_PAGE_SIZE,
  activityCountQuery,
  activityQuery,
  CATEGORY_LIST_SQL,
  groupByDay,
  mapAccountRows,
  mapActivityRows,
  mapCategoryRows,
  pageActivity,
  periodFor,
  periodRule,
  toLocalDate,
  type AccountRow,
  type ActivityDay,
  type ActivityQuery,
  type CategoryRow,
  type CurrencyCode,
} from '@wmbugo/core';
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

/** What the filter sheet offers: accounts, categories and the dates the date presets mean. */
export interface ActivityOptions {
  readonly accounts: AccountRow[];
  readonly categories: CategoryRow[];
  readonly today: string;
  readonly period: { readonly start: string; readonly end: string };
}

export interface ActivityApi {
  /** The newest `limit` entries (default one page) that match the query. */
  load(limit?: number, query?: ActivityQuery): Promise<ActivityData | null>;
  options?(): Promise<ActivityOptions | null>;
  /** How many entries match (the Show N results button). */
  count?(query: ActivityQuery): Promise<number>;
}

export const ACTIVITY_QUERY_KEY = ['ledger', 'activity'] as const;

export const realActivityApi: ActivityApi = {
  async load(limit = ACTIVITY_PAGE_SIZE, query = {}) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const today = toLocalDate(systemClock.nowMs(), p.timezoneId);
    if (!today.ok) return null;
    const { sql, params } = activityQuery(query, limit + 1, { exponent: p.exponent, nowMs: systemClock.nowMs() });
    const page = pageActivity(mapActivityRows(await db.query(sql, params)), limit);
    return { currency: p.currency, locale: p.locale, today: today.value, days: groupByDay(page.rows), hasMore: page.hasMore };
  },
  async options() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const today = toLocalDate(systemClock.nowMs(), p.timezoneId);
    if (!today.ok) return null;
    const period = periodFor(today.value, periodRule(p.payday, p.settings.periodMode));
    return {
      accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL)),
      categories: mapCategoryRows(await db.query(CATEGORY_LIST_SQL)),
      today: today.value,
      period: { start: period.start, end: period.end },
    };
  },
  async count(query) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return 0;
    const { sql, params } = activityCountQuery(query, { exponent: p.exponent, nowMs: systemClock.nowMs() });
    return Number((await db.query(sql, params))[0]?.[0] ?? 0);
  },
};
