import {
  ACCOUNT_LIST_SQL,
  AnswerTimezonePrompt,
  ApplyPendingTimezone,
  ChangeProfile,
  ChangeSetting,
  findRegion,
  mapAccountRows,
  paydayRuleFromRow,
  parseSettings,
  PROMPT_TIMEZONE,
  SETTING_TZ_MISMATCH_SINCE,
  SETTINGS_SQL,
  shouldAskTimezone,
  TrackTimezone,
  type AccountRow,
  type AppSettings,
  type PaydayRule,
  type ProfileChange,
  type Region,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';

export interface ProfileView {
  readonly region: Region | null;
  readonly regionCode: string;
  readonly currency: string;
  readonly locale: string;
  readonly timezoneId: string;
  readonly payday: PaydayRule;
}

export interface SettingsData {
  readonly settings: AppSettings;
  readonly profile: ProfileView;
  /** Any transaction (including an opening balance) exists, so the currency can no longer change. */
  readonly hasTransactions: boolean;
  readonly accounts: AccountRow[];
}

export interface TimezoneAsk {
  readonly deviceTz: string;
}

export interface SettingsApi {
  load(): Promise<SettingsData | null>;
  changeSetting(key: string, value: unknown): Promise<{ ok: boolean; code?: string }>;
  changeProfile(change: ProfileChange): Promise<{ ok: boolean; code?: string }>;
  /** Tracks the device zone, applies a pending switch, and says whether to ask. */
  timezoneCheck(): Promise<TimezoneAsk | null>;
  answerTimezone(use: boolean, deviceTz: string): Promise<{ ok: boolean }>;
}

export const SETTINGS_QUERY_KEY = ['ledger', 'settings'] as const;
/** Not in an event area on purpose: it writes, so it runs once per app open and after the user answers, not after every save. */
export const TIMEZONE_QUERY_KEY = ['app', 'timezone-check'] as const;

export const realSettingsApi: SettingsApi = {
  async load() {
    const db = getServices().db;
    const p = (await db.query('SELECT region, currency_code, locale, timezone_id, payday_rule, payday_day FROM profile LIMIT 1'))[0];
    if (!p) return null;
    const count = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    return {
      settings: parseSettings(await db.query(SETTINGS_SQL)),
      profile: {
        region: findRegion(String(p[0])),
        regionCode: String(p[0]),
        currency: String(p[1]),
        locale: String(p[2]),
        timezoneId: String(p[3]),
        payday: paydayRuleFromRow(p[4] === null ? null : String(p[4]), p[5] === null ? null : Number(p[5])),
      },
      hasTransactions: count > 0,
      accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active'),
    };
  },
  changeSetting: (key, value) => getServices().writer.run(ChangeSetting, { key, value }, 'user'),
  changeProfile: (change) => getServices().writer.run(ChangeProfile, change, 'user'),
  async timezoneCheck() {
    const { db, writer } = getServices();
    const deviceTz = systemClock.timezoneId();
    await writer.run(ApplyPendingTimezone, undefined, 'system');
    await writer.run(TrackTimezone, { deviceTz }, 'system');
    const since = (await db.query('SELECT value_json FROM settings WHERE key = ?', [SETTING_TZ_MISMATCH_SINCE]))[0];
    const answered = (await db.query('SELECT count FROM prompt_state WHERE key = ?', [PROMPT_TIMEZONE])).length > 0;
    const ask = shouldAskTimezone({ mismatchSinceMs: since ? Number(JSON.parse(String(since[0]))) : null, nowMs: systemClock.nowMs(), answered });
    return ask ? { deviceTz } : null;
  },
  answerTimezone: (use, deviceTz) => getServices().writer.run(AnswerTimezonePrompt, { use, deviceTz }, 'user'),
};
