import {
  ACCOUNT_LIST_SQL,
  getCurrency,
  homeAccounts,
  mapAccountRows,
  MarkPromptSeen,
  paydayRuleFromRow,
  periodFor,
  periodLabel,
  SEEN_PROMPT_SQL,
  SPENT_EXPENSES_SQL,
  SPENT_REFUNDS_SQL,
  spentMinor,
  toLocalDate,
  type CurrencyCode,
  type HomeAccounts,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import type { SeenStore } from '../../shared/feedback/tooltipController';

export interface HomeData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly timezoneId: string;
  /** Local date (YYYY-MM-DD) and hour (0-23) in the profile timezone. */
  readonly today: string;
  readonly hour: number;
  readonly scope: string;
  readonly spentMinor: number;
  readonly accounts: HomeAccounts;
}

export interface HomeApi {
  load(): Promise<HomeData | null>;
  seen: SeenStore;
}

export const HOME_QUERY_KEY = ['home', 'summary'] as const;

function hourIn(nowMs: number, tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(nowMs));
  } catch {
    return 12;
  }
}

/** Tips are remembered in `prompt_state` and never inserted anywhere else. */
export const promptStateSeenStore: SeenStore = {
  async hasSeen(id) {
    const rows = await getServices().db.query(SEEN_PROMPT_SQL, [id]);
    return rows.length > 0 && Number(rows[0]![0]) > 0;
  },
  async markSeen(id) {
    await getServices().writer.run(MarkPromptSeen, { key: id }, 'user');
  },
};

export const realHomeApi: HomeApi = {
  seen: promptStateSeenStore,
  async load() {
    const db = getServices().db;
    const p = (await db.query('SELECT currency_code, locale, timezone_id, payday_rule, payday_day FROM profile LIMIT 1'))[0];
    if (!p) return null;
    const cur = getCurrency(String(p[0]));
    if (!cur.ok) return null;
    const tz = String(p[2]);
    const now = systemClock.nowMs();
    const date = toLocalDate(now, tz);
    if (!date.ok) return null;
    const rule = paydayRuleFromRow(p[3] === null ? null : String(p[3]), p[4] === null ? null : Number(p[4]));
    const period = periodFor(date.value, rule);
    const expenses = Number((await db.query(SPENT_EXPENSES_SQL, [period.start, period.end]))[0]![0]);
    const refunds = Number((await db.query(SPENT_REFUNDS_SQL, [period.start, period.end]))[0]![0]);
    const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
    return {
      currency: cur.value.code,
      locale: String(p[1]),
      timezoneId: tz,
      today: date.value,
      hour: hourIn(now, tz),
      scope: periodLabel(period, date.value),
      spentMinor: spentMinor(expenses, refunds),
      accounts: homeAccounts(accounts),
    };
  },
};
