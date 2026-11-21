import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, findRegion, type AppSettings } from '@wmbugo/core';
import { setInAppReduceMotion } from '../../shared/a11y/inAppMotion';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { MemorySeenStore } from '../../shared/feedback/tooltipController';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider, useTheme } from '../../shared/theme/ThemeProvider';
import { HomeScreen } from '../home/HomeScreen';
import { homeData } from '../home/homeTestKit';
import type { HomeApi, HomeData } from '../home/homeApi';
import { authenticate, isDeviceSecure, openSecuritySettings } from '../../adapters/appLock';
import { useLockStore } from '../../shared/state/lockStore';
import { hidingBlocksScreenshots } from '../../adapters/recentsPrivacy';
import { SettingsBridge } from './SettingsBridge';
import { SettingsScreen } from './SettingsScreen';
import type { SettingsApi, SettingsData } from './settingsApi';

jest.mock('../../adapters/appLock', () => ({
  authenticate: jest.fn(async () => ({ result: 'success', message: '' })),
  isDeviceSecure: jest.fn(async () => true),
  openSecuritySettings: jest.fn(async () => undefined),
  availableKind: jest.fn(async () => 'biometric'),
  elapsedRealtimeMs: jest.fn(async () => 0),
}));
jest.mock('../../adapters/recentsPrivacy', () => ({
  ...jest.requireActual('../../adapters/recentsPrivacy'),
  hidingBlocksScreenshots: jest.fn(() => false),
}));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
  setInAppReduceMotion(false);
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const fire = (r: ReactTestRenderer, id: string, handler = 'onPress', ...args: unknown[]) =>
  r.root.findAll((n) => n.props.testID === id && typeof n.props[handler] === 'function')[0]!.props[handler](...args);
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));

function data(over: Partial<SettingsData> = {}, settings: Partial<AppSettings> = {}): SettingsData {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    profile: { region: findRegion('SG'), regionCode: 'SG', currency: 'SGD', locale: 'en-SG', timezoneId: 'Asia/Singapore', payday: { kind: 'first' } },
    hasTransactions: false,
    accounts: [],
    expenseCategoryCount: 14,
    ...over,
  };
}

function fakeApi(initial: SettingsData) {
  let current = initial;
  const changeSetting = jest.fn(async (key: string, value: unknown) => {
    const map: Record<string, keyof AppSettings> = {
      theme: 'theme', 'ui.number_format': 'numberFormat', 'ui.haptics': 'haptics', 'ui.reduce_motion': 'reduceMotion',
      'finance.period_mode': 'periodMode', 'finance.first_day_of_week': 'firstDay', 'finance.default_account': 'defaultAccountId',
      'finance.block_transfers_above_balance': 'blockTransfers', 'device.hide_in_recents': 'hideInRecents', 'device.lock_after': 'lockAfter',
    };
    current = { ...current, settings: { ...current.settings, [map[key]!]: value } };
    return { ok: true };
  });
  const changeProfile = jest.fn(async (c: Parameters<SettingsApi['changeProfile']>[0]) => {
    if (c.payday) current = { ...current, profile: { ...current.profile, payday: c.payday } };
    return { ok: true };
  });
  const timezoneCheck = jest.fn(async () => null as { deviceTz: string } | null);
  const answerTimezone = jest.fn(async () => ({ ok: true }));
  const setHideAmounts = jest.fn(async (hidden: boolean) => {
    current = { ...current, settings: { ...current.settings, hideAmounts: hidden } };
    return { ok: true };
  });
  const saveHomeLayout = jest.fn(async () => ({ ok: true }));
  const setAppLock = jest.fn(async (enabled: boolean) => {
    current = { ...current, settings: { ...current.settings, appLockEnabled: enabled } };
    return { ok: true };
  });
  const setNotificationPrivacy = jest.fn(async (input: { detail?: 'full' | 'hidden'; fullOptIn?: boolean }) => {
    current = {
      ...current,
      settings: {
        ...current.settings,
        ...(input.detail !== undefined ? { notificationDetail: input.detail } : {}),
        ...(input.fullOptIn !== undefined ? { fullNotificationsOptIn: input.fullOptIn } : {}),
      },
    };
    return { ok: true };
  });
  const api: SettingsApi = { load: async () => current, changeSetting, setHideAmounts, setAppLock, setNotificationPrivacy, saveHomeLayout, changeProfile, timezoneCheck, answerTimezone };
  return { api, changeSetting, changeProfile, timezoneCheck, answerTimezone, setHideAmounts, setAppLock, setNotificationPrivacy };
}

function mount(node: React.ReactElement) {
  const qc = createQueryClient();
  clients.push(qc);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>{node}</ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  return r;
}

async function open(d: SettingsData) {
  const f = fakeApi(d);
  const r = mount(<SettingsScreen api={f.api} onBack={jest.fn()} />);
  await settle();
  return { r, ...f };
}

describe('Settings hub', () => {
  it('has a Money group whose summary counts the active spending categories and opens Categories', async () => {
    const { r } = await open(data({ expenseCategoryCount: 14 }));
    expect(host(r, 'group-money').props.accessibilityLabel).toBe('Money, 14 categories');
  });

  it('shows no rules entry in Money: the rule editor is Phase 2 (Story 4.4)', async () => {
    const { r } = await open(data({ expenseCategoryCount: 14 }));
    expect(texts(r).join(' ')).not.toMatch(/\brules?\b/i);
    expect(r.root.findAll((n) => typeof n.type === 'string' && /rule/i.test(String(n.props.testID ?? ''))).length).toBe(0);
  });

  it('lists the You and Data groups, with a live one-line summary in the You label', async () => {
    const { r } = await open(data({}, { theme: 'dark' }));
    expect(has(r, 'group-you') && has(r, 'group-data')).toBe(true);
    expect(host(r, 'group-you').props.accessibilityLabel).toBe('You, Payday 1st · Dark');
    expect(texts(r).join(' ')).not.toMatch(/budgets|insights|reminders/i);
  });

  it('updates the summary immediately after a change', async () => {
    const { r } = await open(data());
    act(() => fire(r, 'group-you'));
    act(() => fire(r, 'row-appearance'));
    await act(async () => fire(r, 'theme-dark'));
    await settle();
    act(() => fire(r, 'settings-back'));
    act(() => fire(r, 'settings-back'));
    expect(host(r, 'group-you').props.accessibilityLabel).toBe('You, Payday 1st · Dark');
  });
});

describe('Appearance', () => {
  const toAppearance = async (d = data()) => {
    const o = await open(d);
    act(() => fire(o.r, 'group-you'));
    act(() => fire(o.r, 'row-appearance'));
    return o;
  };

  it('saves a theme choice as radio chips', async () => {
    const { r, changeSetting } = await toAppearance();
    expect(host(r, 'theme-system').props.accessibilityRole).toBe('radio');
    await act(async () => fire(r, 'theme-light'));
    expect(changeSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('previews the number format through the shared formatter', async () => {
    const a = await toAppearance();
    expect(texts(a.r)).toEqual(expect.arrayContaining(['Amounts look like', 'S$1,234.50']));
    await act(async () => fire(a.r, 'format-european'));
    await settle();
    expect(texts(a.r).some((t) => /1.234,50/.test(t))).toBe(true);
  });

  it('toggles haptics and Reduce motion', async () => {
    const { r, changeSetting } = await toAppearance();
    await act(async () => fire(r, 'switch-reduce-motion', 'onValueChange', true));
    await act(async () => fire(r, 'switch-haptics', 'onValueChange', false));
    expect(changeSetting).toHaveBeenCalledWith('ui.reduce_motion', true);
    expect(changeSetting).toHaveBeenCalledWith('ui.haptics', false);
  });
});

describe('Money basics', () => {
  const toMoney = async (d: SettingsData) => {
    const o = await open(d);
    act(() => fire(o.r, 'group-you'));
    act(() => fire(o.r, 'row-money'));
    await settle();
    return o;
  };

  it('changes payday and keeps the change in the profile', async () => {
    const { r, changeProfile } = await toMoney(data());
    await act(async () => fire(r, 'payday-last_day'));
    expect(changeProfile).toHaveBeenCalledWith({ payday: { kind: 'last_day' } });
  });

  describe('a payday change that cuts the current cycle short (Story 4.8)', () => {
    const plan = { cycleEnd: '2026-11-24', shortened: { start: '2026-11-01', end: '2026-11-24' }, transition: { start: '2026-11-01', end: '2026-11-24', previous: { kind: 'first' as const }, normalDays: 30 } };
    const withPreview = async (p: typeof plan | null) => {
      const o = await open(data());
      const previewPayday = jest.fn(async () => p);
      (o.api as { previewPayday?: unknown }).previewPayday = previewPayday;
      act(() => fire(o.r, 'group-you'));
      act(() => fire(o.r, 'row-money'));
      await settle();
      return { ...o, previewPayday };
    };

    it('asks first with the end of the cycle and the adjusted budgets; Cancel changes nothing', async () => {
      const { r, changeProfile } = await withPreview(plan);
      act(() => fire(r, 'payday-other'));
      act(() => fire(r, 'payday-day', 'onChangeText', '25'));
      await act(async () => fire(r, 'payday-day-save'));
      await settle();
      expect(texts(r)).toContain('Your current cycle will end on 24 Nov. Budgets for 1–24 Nov are adjusted to match.');
      expect(changeProfile).not.toHaveBeenCalled();
      await act(async () => fire(r, 'payday-confirm-cancel'));
      expect(has(r, 'payday-confirm')).toBe(false);
      expect(changeProfile).not.toHaveBeenCalled();
    });

    it('Change payday confirms and saves it', async () => {
      const { r, changeProfile } = await withPreview(plan);
      act(() => fire(r, 'payday-other'));
      act(() => fire(r, 'payday-day', 'onChangeText', '25'));
      await act(async () => fire(r, 'payday-day-save'));
      await settle();
      await act(async () => fire(r, 'payday-confirm-yes'));
      expect(changeProfile).toHaveBeenCalledWith({ payday: { kind: 'day', day: 25 } });
      expect(has(r, 'payday-confirm')).toBe(false);
    });

    it('with no shortened cycle only the cycle end is said, and with no plan it saves at once', async () => {
      const a = await withPreview({ ...plan, shortened: null as never });
      await act(async () => fire(a.r, 'payday-last_day'));
      await settle();
      expect(texts(a.r)).toContain('Your current cycle will end on 24 Nov.');
      const b = await withPreview(null);
      await act(async () => fire(b.r, 'payday-last_day'));
      await settle();
      expect(b.changeProfile).toHaveBeenCalledWith({ payday: { kind: 'last_day' } });
    });

    it('Not salaried never asks', async () => {
      const { r, changeProfile, previewPayday } = await withPreview(plan);
      await act(async () => fire(r, 'payday-none'));
      await settle();
      expect(previewPayday).not.toHaveBeenCalled();
      expect(changeProfile).toHaveBeenCalledWith({ payday: { kind: 'none' } });
    });
  });

  it('Other payday needs a day from 1 to 31', async () => {
    const { r, changeProfile } = await toMoney(data());
    act(() => fire(r, 'payday-other'));
    act(() => fire(r, 'payday-day', 'onChangeText', '40'));
    act(() => fire(r, 'payday-day-save'));
    expect(has(r, 'payday-day-error')).toBe(true);
    expect(changeProfile).not.toHaveBeenCalled();
    act(() => fire(r, 'payday-day', 'onChangeText', '22'));
    await act(async () => fire(r, 'payday-day-save'));
    expect(changeProfile).toHaveBeenCalledWith({ payday: { kind: 'day', day: 22 } });
  });

  it('saves default period, first day of week and default account', async () => {
    const acc = { id: 'a1', name: 'DBS', type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: true, postingsMinor: 0 } as const;
    const { r, changeSetting } = await toMoney(data({ accounts: [acc] }));
    await act(async () => fire(r, 'period-calendar_month'));
    await act(async () => fire(r, 'firstday-sun'));
    await act(async () => fire(r, 'default-account-a1'));
    expect(changeSetting).toHaveBeenCalledWith('finance.period_mode', 'calendar_month');
    expect(changeSetting).toHaveBeenCalledWith('finance.first_day_of_week', 'sun');
    expect(changeSetting).toHaveBeenCalledWith('finance.default_account', 'a1');
  });

  it('with entries, a currency change is blocked with the explanation and nothing changes', async () => {
    const { r, changeProfile } = await toMoney(data({ hasTransactions: true }));
    expect(texts(r).join(' ')).toContain('export your data and start a new profile');
    expect(has(r, 'currency-locked')).toBe(true);
    act(() => fire(r, 'region-change'));
    await settle();
    act(() => fire(r, 'region-search', 'onChangeText', 'united states'));
    await settle();
    act(() => fire(r, 'region-US'));
    expect(changeProfile).not.toHaveBeenCalled();
  });

  it('with no entries, picking a region changes region and currency', async () => {
    const { r, changeProfile } = await toMoney(data());
    act(() => fire(r, 'region-change'));
    await settle();
    act(() => fire(r, 'region-search', 'onChangeText', 'united states'));
    await settle();
    act(() => fire(r, 'region-US'));
    expect(changeProfile).toHaveBeenCalledWith({ region: findRegion('US') });
  });
});

describe('Privacy (Story 8.2)', () => {
  it('has a Privacy group whose live summary is part of its label', async () => {
    const { r } = await open(data());
    expect(host(r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock off · Amounts shown · Notifications: full');
    const hidden = await open(data({}, { hideAmounts: true }));
    expect(host(hidden.r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock off · Amounts hidden · Notifications: hidden');
  });

  it('Hide amounts calls SetHideAmounts and the row summary follows at once', async () => {
    const { r, setHideAmounts } = await open(data());
    act(() => fire(r, 'group-privacy'));
    expect(host(r, 'switch-hide-amounts').props.accessibilityState).toEqual({ checked: false });
    await act(async () => fire(r, 'switch-hide-amounts', 'onValueChange', true));
    await settle();
    expect(setHideAmounts).toHaveBeenCalledWith(true);
    expect(host(r, 'switch-hide-amounts').props.accessibilityState).toEqual({ checked: true });
    act(() => fire(r, 'settings-back'));
    expect(host(r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock off · Amounts hidden · Notifications: hidden');
  });

  it('a change made elsewhere (the hero eye) updates the switch', async () => {
    const f = fakeApi(data());
    const r = mount(<SettingsScreen api={f.api} onBack={jest.fn()} />);
    await settle();
    act(() => fire(r, 'group-privacy'));
    await f.api.setHideAmounts(true);
    const qc = clients[clients.length - 1]!;
    await act(async () => qc.invalidateQueries({ queryKey: ['ledger'] }));
    await settle();
    expect(host(r, 'switch-hide-amounts').props.accessibilityState).toEqual({ checked: true });
  });

  it('Hide wmbugo in recent apps saves the device setting; the screenshot caption shows only below Android 13', async () => {
    const { r, changeSetting } = await open(data());
    act(() => fire(r, 'group-privacy'));
    expect(host(r, 'switch-hide-recents').props.accessibilityState).toEqual({ checked: false });
    await act(async () => fire(r, 'switch-hide-recents', 'onValueChange', true));
    expect(changeSetting).toHaveBeenCalledWith('device.hide_in_recents', true);
    const caption = 'On this phone this also blocks screenshots of wmbugo.';
    (hidingBlocksScreenshots as jest.Mock).mockReturnValue(false);
    const modern = await open(data());
    act(() => fire(modern.r, 'group-privacy'));
    expect(texts(modern.r).join(' ')).not.toContain(caption);
    (hidingBlocksScreenshots as jest.Mock).mockReturnValue(true);
    const old = await open(data());
    act(() => fire(old.r, 'group-privacy'));
    expect(texts(old.r).join(' ')).toContain(caption);
  });

  it('What stays on this phone lists the five plain rows and never claims bytes can never leave', async () => {
    const { r } = await open(data());
    act(() => fire(r, 'group-privacy'));
    act(() => fire(r, 'row-stays'));
    const all = texts(r).join(' | ');
    for (const t of ['Your entries and photos', 'No internet', 'Android backups', 'Backup and export files', 'Diagnostics']) expect(all).toContain(t);
    expect(all).toContain('Stored encrypted on this phone. Nobody else can read them, including us.');
    expect(all).toContain("wmbugo has no internet permission, so it can't send anything.");
    expect(all).not.toMatch(/never leave|can never|under any circumstances/i);
    act(() => fire(r, 'settings-back'));
    expect(has(r, 'switch-hide-amounts')).toBe(true);
  });
});

describe('App lock settings (Story 8.3)', () => {
  beforeEach(() => {
    (authenticate as jest.Mock).mockReset().mockResolvedValue({ result: 'success', message: '' });
    (isDeviceSecure as jest.Mock).mockReset().mockResolvedValue(true);
    (openSecuritySettings as jest.Mock).mockClear();
    useLockStore.setState({ enabled: false, locked: false });
  });

  it('turns on only after the system prompt (Turn on app lock) succeeds, and the summary says App lock on', async () => {
    const { r, setAppLock, changeSetting } = await open(data());
    act(() => fire(r, 'group-privacy'));
    await act(async () => fire(r, 'switch-app-lock', 'onValueChange', true));
    await settle();
    expect(authenticate).toHaveBeenCalledWith('Turn on app lock');
    expect(setAppLock).toHaveBeenCalledWith(true);
    expect(changeSetting).toHaveBeenCalledWith('device.hide_in_recents', true);
    expect(host(r, 'switch-app-lock').props.accessibilityState).toEqual({ checked: true });
    act(() => fire(r, 'settings-back'));
    expect(host(r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock on · Amounts shown · Notifications: hidden');
  });

  it('a cancelled or failed prompt saves nothing', async () => {
    (authenticate as jest.Mock).mockResolvedValue({ result: 'cancelled', message: '' });
    const { r, setAppLock } = await open(data());
    act(() => fire(r, 'group-privacy'));
    await act(async () => fire(r, 'switch-app-lock', 'onValueChange', true));
    await settle();
    expect(setAppLock).not.toHaveBeenCalled();
    expect(host(r, 'switch-app-lock').props.accessibilityState).toEqual({ checked: false });
  });

  it('without a screen lock the switch stays off, says so with Open settings, and saves nothing', async () => {
    (isDeviceSecure as jest.Mock).mockResolvedValue(false);
    const { r, setAppLock } = await open(data());
    act(() => fire(r, 'group-privacy'));
    await act(async () => fire(r, 'switch-app-lock', 'onValueChange', true));
    await settle();
    expect(authenticate).not.toHaveBeenCalled();
    expect(setAppLock).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Set a screen lock on your phone first.');
    await act(async () => fire(r, 'lock-open-security'));
    expect(openSecuritySettings).toHaveBeenCalled();
    expect(host(r, 'switch-app-lock').props.accessibilityState).toEqual({ checked: false });
  });

  it('Lock after offers the four chips with 1 minute as the default', async () => {
    const { r } = await open(data({}, { appLockEnabled: true }));
    act(() => fire(r, 'group-privacy'));
    for (const id of ['immediately', '1m', '5m', '15m']) expect(has(r, `lock-after-${id}`)).toBe(true);
    expect(host(r, 'lock-after-1m').props.accessibilityState).toMatchObject({ selected: true });
    expect(texts(r)).toEqual(expect.arrayContaining(['Immediately', 'After 1 minute', 'After 5 minutes', 'After 15 minutes']));
  });

  it('changing Lock after and turning app lock off ask Confirm it is you (app lock on); cancel changes nothing', async () => {
    useLockStore.setState({ enabled: true });
    const { r, changeSetting, setAppLock } = await open(data({}, { appLockEnabled: true }));
    act(() => fire(r, 'group-privacy'));
    (authenticate as jest.Mock).mockResolvedValue({ result: 'cancelled', message: '' });
    await act(async () => fire(r, 'lock-after-5m'));
    await act(async () => fire(r, 'switch-app-lock', 'onValueChange', false));
    await settle();
    expect(authenticate).toHaveBeenCalledWith("Confirm it's you");
    expect(changeSetting).not.toHaveBeenCalled();
    expect(setAppLock).not.toHaveBeenCalled();
    (authenticate as jest.Mock).mockResolvedValue({ result: 'success', message: '' });
    await act(async () => fire(r, 'lock-after-5m'));
    await settle();
    expect(changeSetting).toHaveBeenCalledWith('device.lock_after', '5m');
    await act(async () => fire(r, 'switch-app-lock', 'onValueChange', false));
    await settle();
    expect(setAppLock).toHaveBeenCalledWith(false);
  });
});

describe('Notification detail (Story 8.5)', () => {
  const openNotifications = async (d: SettingsData) => {
    const f = await open(d);
    act(() => fire(f.r, 'group-privacy'));
    act(() => fire(f.r, 'row-notifications'));
    return f;
  };

  it('shows radio rows Full details and Hidden, the opt-in switch (off) and the lock-screen caption', async () => {
    const { r } = await openNotifications(data());
    expect(texts(r)).toEqual(expect.arrayContaining(['Full details', 'Hidden — shows "New payment to check"', 'Show full details even when app lock or hidden amounts is on', 'On the lock screen, payment details stay hidden unless you allow lock-screen approve.']));
    expect(host(r, 'notif-detail-full').props.accessibilityState).toMatchObject({ selected: true });
    expect(host(r, 'switch-notif-optin').props.accessibilityState).toEqual({ checked: false });
  });

  it('switching to Hidden and the opt-in switch save through SetNotificationPrivacy, and the summary follows', async () => {
    const { r, setNotificationPrivacy } = await openNotifications(data());
    await act(async () => fire(r, 'notif-detail-hidden'));
    await settle();
    expect(setNotificationPrivacy).toHaveBeenCalledWith({ detail: 'hidden' });
    await act(async () => fire(r, 'switch-notif-optin', 'onValueChange', true));
    await settle();
    expect(setNotificationPrivacy).toHaveBeenCalledWith({ fullOptIn: true });
    act(() => fire(r, 'settings-back'));
    expect(host(r, 'row-notifications').props.accessibilityLabel).toBe('Notification detail, Hidden');
    act(() => fire(r, 'settings-back'));
    expect(host(r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock off · Amounts shown · Notifications: hidden');
  });

  it('the Privacy summary ends Notifications: hidden while app lock is on without the opt-in, and full with it', async () => {
    const guarded = await open(data({}, { appLockEnabled: true }));
    expect(host(guarded.r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock on · Amounts shown · Notifications: hidden');
    const optedIn = await open(data({}, { appLockEnabled: true, fullNotificationsOptIn: true }));
    expect(host(optedIn.r, 'group-privacy').props.accessibilityLabel).toBe('Privacy, App lock on · Amounts shown · Notifications: full');
  });

  it('with the permission off it says so with Open settings, and the setting stays editable', async () => {
    const { r, setNotificationPrivacy } = await openNotifications(data({ notificationsOff: true }));
    expect(texts(r)).toContain('Notifications are off for wmbugo');
    await act(async () => fire(r, 'notifications-open-settings'));
    expect(openSecuritySettings).toHaveBeenCalled();
    await act(async () => fire(r, 'notif-detail-hidden'));
    expect(setNotificationPrivacy).toHaveBeenCalledWith({ detail: 'hidden' });
  });

  it('with the permission on (or the build unable to post) no off message shows', async () => {
    const { r } = await openNotifications(data({ notificationsOff: false }));
    expect(texts(r)).not.toContain('Notifications are off for wmbugo');
  });
});

describe('Data group and Back up (Story 8.7)', () => {
  it('the Data summary reads No backup yet, then Last backup 3 Nov from last_backup_at', async () => {
    const none = await open(data());
    expect(host(none.r, 'group-data').props.accessibilityLabel).toBe('Data, No backup yet');
    const made = await open(data({}, { lastBackupAt: Date.UTC(2026, 10, 3, 12, 0, 0) }));
    expect(host(made.r, 'group-data').props.accessibilityLabel).toBe('Data, Last backup 3 Nov');
  });

  it('Data lists Back up and Recently deleted; Back up opens the Back up screen and Back returns to Data', async () => {
    const { r } = await open(data({}, { lastBackupAt: Date.UTC(2026, 10, 3, 12, 0, 0) }));
    act(() => fire(r, 'group-data'));
    expect(host(r, 'row-backup').props.accessibilityLabel).toBe('Back up, Last backup 3 Nov');
    expect(host(r, 'row-restore').props.accessibilityLabel).toBe('Restore from backup, Restore from backup');
    expect(has(r, 'row-deleted')).toBe(true);
    act(() => fire(r, 'row-backup'));
    expect(has(r, 'backup-form')).toBe(true);
    expect(texts(r)).toContain('Back up');
    act(() => fire(r, 'settings-back'));
    expect(has(r, 'row-backup')).toBe(true);
  });
});

describe('Help group and Diagnostics (Story 8.10)', () => {
  it('has a Help group because Diagnostics exists, and Help lists Diagnostics', async () => {
    const { r } = await open(data());
    expect(host(r, 'group-help').props.accessibilityLabel).toBe('Help, Diagnostics');
    act(() => fire(r, 'group-help'));
    expect(host(r, 'row-diagnostics').props.accessibilityLabel).toBe('Diagnostics, Diagnostics');
    act(() => fire(r, 'row-diagnostics'));
    await settle();
    expect(has(r, 'diagnostics')).toBe(true);
    expect(has(r, 'diagnostics-export')).toBe(true);
    act(() => fire(r, 'diagnostics-export'));
    expect(has(r, 'diagnostics-preview')).toBe(true);
    act(() => fire(r, 'settings-back'));
    expect(has(r, 'diagnostics')).toBe(true);
    act(() => fire(r, 'settings-back'));
    act(() => fire(r, 'settings-back'));
    expect(has(r, 'group-help')).toBe(true);
  });
});

describe('Block transfers above the balance', () => {
  it('is a switch in You that saves the setting', async () => {
    const { r, changeSetting } = await open(data());
    act(() => fire(r, 'group-you'));
    expect(host(r, 'switch-block-transfers').props.accessibilityState).toEqual({ checked: false });
    await act(async () => fire(r, 'switch-block-transfers', 'onValueChange', true));
    expect(changeSetting).toHaveBeenCalledWith('finance.block_transfers_above_balance', true);
  });
});

describe('SettingsBridge and the app switcher (Story 8.2)', () => {
  it('applies Hide wmbugo in recent apps natively once the setting is known, on and off', async () => {
    const calls: boolean[] = [];
    const rn = jest.requireActual('react-native') as { NativeModules: Record<string, unknown> };
    rn.NativeModules.WmbugoPrivacy = { setHideInRecents: async (v: boolean) => void calls.push(v), setHideForAppLock: async () => undefined };
    try {
      const f = fakeApi(data({}, { hideInRecents: true }));
      mount(
        <SettingsBridge api={f.api}>
          <Text>x</Text>
        </SettingsBridge>,
      );
      await settle();
      expect(calls).toEqual([true]);
    } finally {
      delete rn.NativeModules.WmbugoPrivacy;
    }
  });
});

describe('SettingsBridge', () => {
  it('applies the saved theme and Reduce motion app-wide', async () => {
    const f = fakeApi(data({}, { theme: 'dark', reduceMotion: true }));
    let seen = '';
    const Probe = () => {
      seen = useTheme().mode;
      return null;
    };
    mount(
      <SettingsBridge api={f.api}>
        <Probe />
      </SettingsBridge>,
    );
    await settle();
    expect(seen).toBe('dark');
  });

  it('opens with defaults when the settings cannot be read', async () => {
    const f = fakeApi(data());
    f.api.load = async () => {
      throw new Error('no db');
    };
    const r = mount(
      <SettingsBridge api={f.api}>
        <Text>child</Text>
      </SettingsBridge>,
    );
    await settle();
    expect(texts(r)).toContain('child');
  });
});

describe('time zone prompt on Home', () => {
  const home: HomeData = homeData({ accounts: { hasAccounts: false, inAccountsMinor: null } });
  const homeApi: HomeApi = { load: async () => home, seen: new MemorySeenStore() };

  it('asks once and Yes / No call the answer', async () => {
    const f = fakeApi(data());
    f.timezoneCheck.mockResolvedValue({ deviceTz: 'Asia/Dubai' });
    const r = mount(
      <SheetHost>
        <HomeScreen api={homeApi} settingsApi={f.api} onAccounts={jest.fn()} onProfile={jest.fn()} onAddAccount={jest.fn()} onOpenBudget={jest.fn()} onOpenPlan={jest.fn()} onSetLimit={jest.fn()} onSortIt={jest.fn()} onOpenReview={jest.fn()} onOpenActivity={jest.fn()} onEditHome={jest.fn()} />
      </SheetHost>,
    );
    await settle();
    expect(texts(r)).toContain('Your phone is on a different time zone. Use it for your budget days?');
    await act(async () => fire(r, 'tz-yes'));
    expect(f.answerTimezone).toHaveBeenCalledWith(true, 'Asia/Dubai');
    await act(async () => fire(r, 'tz-no'));
    expect(f.answerTimezone).toHaveBeenCalledWith(false, 'Asia/Dubai');
  });

  it('is not re-run by a save: invalidating the home area leaves the time zone check alone', async () => {
    const f = fakeApi(data());
    const qc = createQueryClient();
    clients.push(qc);
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <SheetHost>
              <HomeScreen api={homeApi} settingsApi={f.api} onAccounts={jest.fn()} onProfile={jest.fn()} onAddAccount={jest.fn()} onOpenBudget={jest.fn()} onOpenPlan={jest.fn()} onSetLimit={jest.fn()} onSortIt={jest.fn()} onOpenReview={jest.fn()} onOpenActivity={jest.fn()} onEditHome={jest.fn()} />
            </SheetHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await settle();
    expect(f.timezoneCheck).toHaveBeenCalledTimes(1);
    await act(async () => qc.invalidateQueries({ queryKey: ['home'] }));
    await settle();
    expect(f.timezoneCheck).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when no prompt is due', async () => {
    const f = fakeApi(data());
    const r = mount(
      <SheetHost>
        <HomeScreen api={homeApi} settingsApi={f.api} onAccounts={jest.fn()} onProfile={jest.fn()} onAddAccount={jest.fn()} onOpenBudget={jest.fn()} onOpenPlan={jest.fn()} onSetLimit={jest.fn()} onSortIt={jest.fn()} onOpenReview={jest.fn()} onOpenActivity={jest.fn()} onEditHome={jest.fn()} />
      </SheetHost>,
    );
    await settle();
    expect(has(r, 'timezone-prompt')).toBe(false);
  });
});
