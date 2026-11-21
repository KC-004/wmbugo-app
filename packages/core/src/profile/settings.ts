import { isHomeLayout, sanitizeHomeLayout, type HomeLayoutEntry } from './homeLayout';
import type { PaydayRule, PeriodMode } from './payday';

/** Settings keys (the `settings` table holds one JSON value per key). */
export const SETTING_NUMBER_FORMAT = 'ui.number_format';
export const SETTING_HAPTICS = 'ui.haptics';
export const SETTING_REDUCE_MOTION = 'ui.reduce_motion';
export const SETTING_PERIOD_MODE = 'finance.period_mode';
export const SETTING_FIRST_DAY = 'finance.first_day_of_week';
export const SETTING_DEFAULT_ACCOUNT = 'finance.default_account';
export const SETTING_BLOCK_TRANSFERS_KEY = 'finance.block_transfers_above_balance';
export const SETTING_SHOW_NET_WORTH = 'ui.show_net_worth';
/** Hide amounts (Story 5.3): every amount in the app is masked while it is on. Per device; the setting is the source of truth. */
export const SETTING_HIDE_AMOUNTS = 'ui.hide_amounts';
/**
 * Hide wmbugo in recent apps (Story 8.2): a device setting, so a restore keeps this phone's choice (Story 8.8). On Android 13+
 * the recents snapshot is switched off; on Android 8 to 12 the window is marked secure.
 */
export const SETTING_HIDE_IN_RECENTS = 'device.hide_in_recents';
/** Notification detail (Story 8.5): `full` or `hidden`, and whether full details are still shown while app lock or hide amounts is on. */
export const SETTING_NOTIFICATION_DETAIL = 'privacy.notification_detail';
export const SETTING_FULL_NOTIFICATIONS_OPT_IN = 'privacy.full_notifications_opt_in';
/** App lock (Story 8.3): a UI gate only, never bound to the database key (AD-9). A device setting: a restore keeps this phone's choice. */
export const SETTING_APP_LOCK = 'device.app_lock_enabled';
/** How long wmbugo may be in the background before it locks again (Story 8.3). */
export const SETTING_LOCK_AFTER = 'device.lock_after';
/** The Home card layout (Story 5.6): a list of `{cardId, hidden, size}` in display order, or null for the PRD order. */
export const SETTING_HOME_LAYOUT = 'ui.home_layout';
export const SETTING_THEME_KEY = 'theme';

export type LockAfter = 'immediately' | '1m' | '5m' | '15m';
export const LOCK_AFTER_CHOICES: readonly LockAfter[] = ['immediately', '1m', '5m', '15m'];
export const NOTIFICATION_DETAIL_CHOICES = ['full', 'hidden'] as const;
export type ThemeChoice = 'system' | 'light' | 'dark';
export type NumberFormat = 'region' | 'international' | 'indian' | 'european';
export type FirstDay = 'mon' | 'sun' | 'sat';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
export const NUMBER_FORMATS: readonly NumberFormat[] = ['region', 'international', 'indian', 'european'];
export const PERIOD_MODES: readonly PeriodMode[] = ['pay_cycle', 'calendar_month'];
export const FIRST_DAYS: readonly FirstDay[] = ['mon', 'sun', 'sat'];

export interface AppSettings {
  readonly theme: ThemeChoice;
  readonly numberFormat: NumberFormat;
  readonly haptics: boolean;
  readonly reduceMotion: boolean;
  readonly periodMode: PeriodMode;
  readonly firstDay: FirstDay;
  readonly defaultAccountId: string | null;
  readonly blockTransfers: boolean;
  readonly showNetWorth: boolean;
  readonly hideAmounts: boolean;
  readonly hideInRecents: boolean;
  readonly appLockEnabled: boolean;
  readonly lockAfter: LockAfter;
  readonly notificationDetail: 'full' | 'hidden';
  readonly fullNotificationsOptIn: boolean;
  readonly homeLayout: readonly HomeLayoutEntry[] | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  numberFormat: 'region',
  haptics: true,
  reduceMotion: false,
  periodMode: 'pay_cycle',
  firstDay: 'mon',
  defaultAccountId: null,
  blockTransfers: false,
  showNetWorth: false,
  hideAmounts: false,
  hideInRecents: false,
  appLockEnabled: false,
  lockAfter: '1m',
  notificationDetail: 'full',
  fullNotificationsOptIn: false,
  homeLayout: null,
};

export const SETTINGS_SQL = 'SELECT key, value_json FROM settings';

/** Validates a value for a key; returns the value to store, or null when it is not allowed. */
export function validateSetting(key: string, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const oneOf = (list: readonly unknown[]) => (list.includes(value) ? { ok: true as const, value } : { ok: false as const });
  switch (key) {
    case SETTING_THEME_KEY:
      return oneOf(THEME_CHOICES);
    case SETTING_NUMBER_FORMAT:
      return oneOf(NUMBER_FORMATS);
    case SETTING_PERIOD_MODE:
      return oneOf(PERIOD_MODES);
    case SETTING_FIRST_DAY:
      return oneOf(FIRST_DAYS);
    case SETTING_HAPTICS:
    case SETTING_REDUCE_MOTION:
    case SETTING_BLOCK_TRANSFERS_KEY:
    case SETTING_SHOW_NET_WORTH:
    case SETTING_HIDE_AMOUNTS:
    case SETTING_APP_LOCK:
    case SETTING_FULL_NOTIFICATIONS_OPT_IN:
    case SETTING_HIDE_IN_RECENTS:
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case SETTING_LOCK_AFTER:
      return oneOf(LOCK_AFTER_CHOICES);
    case SETTING_NOTIFICATION_DETAIL:
      return oneOf(NOTIFICATION_DETAIL_CHOICES);
    case SETTING_HOME_LAYOUT:
      return value === null ? { ok: true, value } : isHomeLayout(value) ? { ok: true, value: sanitizeHomeLayout(value) } : { ok: false };
    case SETTING_DEFAULT_ACCOUNT:
      return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 64) ? { ok: true, value } : { ok: false };
    default:
      return { ok: false };
  }
}

/** Reads the stored rows into typed settings; anything missing or invalid falls back to its default. */
export function parseSettings(rows: readonly (readonly unknown[])[]): AppSettings {
  const raw = new Map<string, unknown>();
  for (const r of rows) {
    try {
      raw.set(String(r[0]), JSON.parse(String(r[1])));
    } catch {
      // a corrupt value is treated as unset
    }
  }
  const pick = <T,>(key: string, fallback: T): T => {
    if (!raw.has(key)) return fallback;
    const v = validateSetting(key, raw.get(key));
    return v.ok ? (v.value as T) : fallback;
  };
  return {
    theme: pick(SETTING_THEME_KEY, DEFAULT_SETTINGS.theme),
    numberFormat: pick(SETTING_NUMBER_FORMAT, DEFAULT_SETTINGS.numberFormat),
    haptics: pick(SETTING_HAPTICS, DEFAULT_SETTINGS.haptics),
    reduceMotion: pick(SETTING_REDUCE_MOTION, DEFAULT_SETTINGS.reduceMotion),
    periodMode: pick(SETTING_PERIOD_MODE, DEFAULT_SETTINGS.periodMode),
    firstDay: pick(SETTING_FIRST_DAY, DEFAULT_SETTINGS.firstDay),
    defaultAccountId: pick<string | null>(SETTING_DEFAULT_ACCOUNT, null),
    blockTransfers: pick(SETTING_BLOCK_TRANSFERS_KEY, DEFAULT_SETTINGS.blockTransfers),
    showNetWorth: pick(SETTING_SHOW_NET_WORTH, DEFAULT_SETTINGS.showNetWorth),
    hideAmounts: pick(SETTING_HIDE_AMOUNTS, DEFAULT_SETTINGS.hideAmounts),
    hideInRecents: pick(SETTING_HIDE_IN_RECENTS, DEFAULT_SETTINGS.hideInRecents),
    appLockEnabled: pick(SETTING_APP_LOCK, DEFAULT_SETTINGS.appLockEnabled),
    lockAfter: pick(SETTING_LOCK_AFTER, DEFAULT_SETTINGS.lockAfter),
    notificationDetail: pick(SETTING_NOTIFICATION_DETAIL, DEFAULT_SETTINGS.notificationDetail),
    fullNotificationsOptIn: pick(SETTING_FULL_NOTIFICATIONS_OPT_IN, DEFAULT_SETTINGS.fullNotificationsOptIn),
    homeLayout: pick<readonly HomeLayoutEntry[] | null>(SETTING_HOME_LAYOUT, null),
  };
}

const LOCALE_FOR: Readonly<Record<Exclude<NumberFormat, 'region'>, string>> = {
  international: 'en-US',
  indian: 'en-IN',
  european: 'de-DE',
};

/** The locale amounts are formatted with: the region's, unless a number format was chosen. */
export function effectiveLocale(regionLocale: string, format: NumberFormat): string {
  return format === 'region' ? regionLocale : LOCALE_FOR[format];
}

/** The payday rule the period service should use: calendar month overrides a pay cycle when chosen. */
export function periodRule(rule: PaydayRule, mode: PeriodMode): PaydayRule {
  return mode === 'calendar_month' ? { kind: 'none' } : rule;
}

const ORDINAL: Readonly<Record<string, string>> = { first: '1st', last_day: 'last day', last_working_day: 'last working day' };

/** "1st", "last day", "15th", "none" for the Settings summary. */
export function paydaySummary(rule: PaydayRule): string {
  if (rule.kind === 'none') return 'not salaried';
  if (rule.kind === 'day') {
    const d = rule.day;
    const suffix = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[d % 10] ?? 'th';
    return `${d}${suffix}`;
  }
  return ORDINAL[rule.kind] ?? rule.kind;
}

const THEME_WORD: Readonly<Record<ThemeChoice, string>> = { system: 'System', light: 'Light', dark: 'Dark' };

/** The live one-line summary for the You group: "Payday 1st · Dark". */
export function youSummary(rule: PaydayRule, theme: ThemeChoice): string {
  return `Payday ${paydaySummary(rule)} · ${THEME_WORD[theme]}`;
}

export interface PrivacySummaryParts {
  /** Story 8.3 adds this part; absent until app lock exists. */
  readonly appLock?: boolean;
  readonly hideAmounts: boolean;
  /** Story 8.5 adds this part: the effective shade form for captures. */
  readonly notifications?: 'full' | 'hidden';
}

/** The live one-line Privacy summary, part of the row's spoken label: "App lock off · Amounts shown · Notifications: full". */
export function privacySummary(parts: PrivacySummaryParts): string {
  const out: string[] = [];
  if (parts.appLock !== undefined) out.push(parts.appLock ? 'App lock on' : 'App lock off');
  out.push(parts.hideAmounts ? 'Amounts hidden' : 'Amounts shown');
  if (parts.notifications !== undefined) out.push(`Notifications: ${parts.notifications}`);
  return out.join(' · ');
}
