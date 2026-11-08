import {
  ACCOUNT_LIST_SQL,
  ACCOUNT_START_SQL,
  ACCOUNT_TIMELINE_SQL,
  ACTIVITY_PAGE_SIZE,
  groupByDay,
  mapAccountRows,
  mapTimelineRows,
  pageActivity,
  toLocalDate,
  type AccountRow,
  type ActivityDay,
  type CurrencyCode,
  type TimelineRow,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface AccountDetailData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly today: string;
  readonly account: AccountRow;
  /** Newest first, grouped by day. */
  readonly days: ActivityDay[];
  /** Signed effect on this account, by entry id (a transfer reads "To X" or "From X" from it). */
  readonly signed: Readonly<Record<string, number>>;
  readonly hasMore: boolean;
  /** The opening balance and the day tracking began; null when the balance was never set. */
  readonly starting: { readonly minor: number; readonly localDate: string } | null;
}

export interface AccountDetailApi {
  /** null: no profile yet. 'missing': no such account. */
  load(accountId: string, limit?: number): Promise<AccountDetailData | 'missing' | null>;
}

export const accountDetailKey = (accountId: string, limit: number) => ['ledger', 'account', accountId, limit] as const;

export const realAccountDetailApi: AccountDetailApi = {
  async load(accountId, limit = ACTIVITY_PAGE_SIZE) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const account = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((a) => a.id === accountId);
    if (!account) return 'missing';
    const today = toLocalDate(systemClock.nowMs(), p.timezoneId);
    if (!today.ok) return null;
    const timeline: TimelineRow[] = mapTimelineRows(await db.query(ACCOUNT_TIMELINE_SQL, [accountId, accountId, limit + 1]));
    const page = pageActivity(timeline, limit);
    const signed: Record<string, number> = {};
    for (const r of timeline) signed[r.id] = r.signedMinor;
    const start = (await db.query(ACCOUNT_START_SQL, [accountId]))[0];
    const startDate = start ? toLocalDate(Number(start[1]), p.timezoneId) : null;
    return {
      currency: p.currency,
      locale: p.locale,
      today: today.value,
      account,
      days: groupByDay(page.rows),
      signed,
      hasMore: page.hasMore,
      starting: start && startDate?.ok ? { minor: Number(start[0]), localDate: startDate.value } : null,
    };
  },
};
