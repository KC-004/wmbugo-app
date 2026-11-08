import { ACTIVITY_SQL, effectiveLocale, getCurrency, groupByDay, mapActivityRows, parseSettings, SETTINGS_SQL, toLocalDate, type ActivityDay, type CurrencyCode } from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';

export interface ActivityData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly today: string;
  readonly days: ActivityDay[];
}

export interface ActivityApi {
  load(): Promise<ActivityData | null>;
}

export const ACTIVITY_QUERY_KEY = ['ledger', 'activity'] as const;

export const realActivityApi: ActivityApi = {
  async load() {
    const db = getServices().db;
    const p = (await db.query('SELECT currency_code, locale, timezone_id FROM profile LIMIT 1'))[0];
    if (!p) return null;
    const cur = getCurrency(String(p[0]));
    const today = toLocalDate(systemClock.nowMs(), String(p[2]));
    if (!cur.ok || !today.ok) return null;
    return {
      currency: cur.value.code,
      locale: effectiveLocale(String(p[1]), parseSettings(await db.query(SETTINGS_SQL)).numberFormat),
      today: today.value,
      days: groupByDay(mapActivityRows(await db.query(ACTIVITY_SQL))),
    };
  },
};
