import {
  ACCOUNT_LIST_SQL,
  ACTIVITY_PAGE_SIZE,
  activityCountQuery,
  activityIdsQuery,
  BULK_CHUNK,
  BulkRecategorise,
  bulkRowsSql,
  classifyBulk,
  mapBulkRows,
  UndoBulkRecategorise,
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

export interface BulkPreviewResult {
  readonly movable: number;
  readonly wontChange: number;
  readonly fromCategoryId: string | null;
}

export type BulkMoveResult = { ok: true; value: { movedIds: string[]; skipped: number; previous: { id: string; categoryId: string }[] } } | { ok: false; code: string };

export interface ActivityApi {
  /** The newest `limit` entries (default one page) that match the query. */
  load(limit?: number, query?: ActivityQuery): Promise<ActivityData | null>;
  options?(): Promise<ActivityOptions | null>;
  /** How many entries match (the Show N results button). */
  count?(query: ActivityQuery): Promise<number>;
  /** Every id that matches the query (Select all covers rows that are not loaded). */
  ids?(query: ActivityQuery): Promise<string[]>;
  bulkPreview?(ids: readonly string[], categoryId: string): Promise<BulkPreviewResult>;
  bulkMove?(ids: readonly string[], categoryId: string): Promise<BulkMoveResult>;
  bulkUndo?(previous: readonly { id: string; categoryId: string }[]): Promise<{ ok: boolean }>;
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
  async ids(query) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return [];
    const { sql, params } = activityIdsQuery(query, { exponent: p.exponent, nowMs: systemClock.nowMs() });
    return (await db.query(sql, params)).map((r) => String(r[0]));
  },
  async bulkPreview(ids, categoryId) {
    const db = getServices().db;
    const kind = (await db.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [categoryId]))[0]?.[0];
    const rows = [];
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const chunk = ids.slice(i, i + BULK_CHUNK);
      rows.push(...mapBulkRows(await db.query(bulkRowsSql(chunk.length), [...chunk])));
    }
    const c = classifyBulk(rows, { id: categoryId, kind: kind === undefined ? '' : String(kind) });
    return { movable: c.movableIds.length, wontChange: ids.length - c.movableIds.length, fromCategoryId: c.fromCategoryId };
  },
  bulkMove: (ids, categoryId) => getServices().writer.run(BulkRecategorise, { transactionIds: ids, categoryId }, 'user'),
  bulkUndo: (previous) => getServices().writer.run(UndoBulkRecategorise, { previous }, 'user'),
};
