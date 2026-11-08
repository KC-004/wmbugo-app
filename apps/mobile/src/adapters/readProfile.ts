import {
  effectiveLocale,
  getCurrency,
  parseSettings,
  paydayRuleFromRow,
  SETTINGS_SQL,
  type AppSettings,
  type CurrencyCode,
  type PaydayRule,
  type SqlDatabase,
} from '@wmbugo/core';

/** The profile row plus the app settings, read once the same way by every feature. */
export interface ProfileInfo {
  readonly regionCode: string;
  readonly currency: CurrencyCode;
  readonly exponent: number;
  /** The locale amounts are formatted with (the region's, unless a number format was chosen). */
  readonly locale: string;
  /** The region's own locale, before any number-format choice. */
  readonly regionLocale: string;
  readonly timezoneId: string;
  readonly payday: PaydayRule;
  readonly settings: AppSettings;
}

export const PROFILE_SQL = 'SELECT region, currency_code, currency_exponent, locale, timezone_id, payday_rule, payday_day FROM profile LIMIT 1';

/** null when there is no profile yet, or its currency is not one the app knows. */
export async function readProfile(db: SqlDatabase): Promise<ProfileInfo | null> {
  const p = (await db.query(PROFILE_SQL))[0];
  if (!p) return null;
  const cur = getCurrency(String(p[1]));
  if (!cur.ok) return null;
  const settings = parseSettings(await db.query(SETTINGS_SQL));
  return {
    regionCode: String(p[0]),
    currency: cur.value.code,
    exponent: Number(p[2]),
    locale: effectiveLocale(String(p[3]), settings.numberFormat),
    regionLocale: String(p[3]),
    timezoneId: String(p[4]),
    payday: paydayRuleFromRow(p[5] === null ? null : String(p[5]), p[6] === null ? null : Number(p[6])),
    settings,
  };
}
