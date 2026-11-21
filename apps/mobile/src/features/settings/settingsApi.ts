import {
  ACCOUNT_LIST_SQL,
  AnswerTimezonePrompt,
  ApplyPendingTimezone,
  ChangeProfile,
  previewPaydayChange,
  type PaydayChangePlan,
  ChangeSetting,
  SetAppLock,
  SetNotificationPrivacy,
  SetHideAmounts,
  SaveHomeLayout,
  type HomeLayoutEntry,
  findRegion,
  mapAccountRows,
  PROMPT_TIMEZONE,
  SETTING_TZ_MISMATCH_SINCE,
  shouldAskTimezone,
  TrackTimezone,
  type AccountRow,
  type AppSettings,
  type PaydayRule,
  type ProfileChange,
  type Region,
} from '@wmbugo/core';
import { permissionState } from '../../adapters/permissions';
import { appNotifier } from '../../adapters/notifier';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

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
  /** Active spending categories, Uncategorised included (the Money row's summary). */
  readonly expenseCategoryCount: number;
  /** Notifications are off for wmbugo in Android settings (only when this build can post them). */
  readonly notificationsOff?: boolean;
}

export interface TimezoneAsk {
  readonly deviceTz: string;
}

export interface SettingsApi {
  load(): Promise<SettingsData | null>;
  changeSetting(key: string, value: unknown): Promise<{ ok: boolean; code?: string }>;
  /** Hide amounts on or off (Story 5.3): one audited write. */
  setHideAmounts(hidden: boolean): Promise<{ ok: boolean; code?: string }>;
  /** Notification detail and the full-details opt-in (Story 8.5): one audited write. */
  setNotificationPrivacy(input: { detail?: "full" | "hidden"; fullOptIn?: boolean }): Promise<{ ok: boolean; code?: string }>;
  /** App lock on or off (Story 8.3): one audited write. The device prompt has already succeeded. */
  setAppLock(enabled: boolean): Promise<{ ok: boolean; code?: string }>;
  /** Saves the Home card layout (Story 5.6) in one audited write; null resets to the PRD order. */
  saveHomeLayout(layout: readonly HomeLayoutEntry[] | null): Promise<{ ok: boolean; code?: string }>;
  changeProfile(change: ProfileChange): Promise<{ ok: boolean; code?: string }>;
  /** What a payday change would do today (Story 4.8): the cycle end and the shortened cycle. null when nothing is cut short. Read only. */
  previewPayday?(rule: PaydayRule): Promise<PaydayChangePlan | null>;
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
    const p = await readProfile(db);
    if (!p) return null;
    const count = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    return {
      settings: p.settings,
      profile: {
        region: findRegion(p.regionCode),
        regionCode: p.regionCode,
        currency: p.currency,
        locale: p.regionLocale,
        timezoneId: p.timezoneId,
        payday: p.payday,
      },
      hasTransactions: count > 0,
      notificationsOff: appNotifier.available && (await permissionState('notifications')) === 'denied',
      accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active'),
      expenseCategoryCount: Number((await db.query("SELECT COUNT(*) FROM category WHERE archived = 0 AND kind = 'expense'"))[0]![0]),
    };
  },
  changeSetting: (key, value) => getServices().writer.run(ChangeSetting, { key, value }, 'user'),
  setHideAmounts: (hidden) => getServices().writer.run(SetHideAmounts, { hidden }, 'user'),
  setNotificationPrivacy: (input) => getServices().writer.run(SetNotificationPrivacy, input, 'user'),
  setAppLock: (enabled) => getServices().writer.run(SetAppLock, { enabled }, 'user'),
  saveHomeLayout: (layout) => getServices().writer.run(SaveHomeLayout, { layout }, 'user'),
  changeProfile: (change) => getServices().writer.run(ChangeProfile, change, 'user'),
  previewPayday: (rule) => previewPaydayChange(getServices().db, rule, systemClock.nowMs()),
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
