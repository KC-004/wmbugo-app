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
import type { HomeApi, HomeData } from '../home/homeApi';
import { SettingsBridge } from './SettingsBridge';
import { SettingsScreen } from './SettingsScreen';
import type { SettingsApi, SettingsData } from './settingsApi';

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
    ...over,
  };
}

function fakeApi(initial: SettingsData) {
  let current = initial;
  const changeSetting = jest.fn(async (key: string, value: unknown) => {
    const map: Record<string, keyof AppSettings> = {
      theme: 'theme', 'ui.number_format': 'numberFormat', 'ui.haptics': 'haptics', 'ui.reduce_motion': 'reduceMotion',
      'finance.period_mode': 'periodMode', 'finance.first_day_of_week': 'firstDay', 'finance.default_account': 'defaultAccountId',
      'finance.block_transfers_above_balance': 'blockTransfers',
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
  const api: SettingsApi = { load: async () => current, changeSetting, changeProfile, timezoneCheck, answerTimezone };
  return { api, changeSetting, changeProfile, timezoneCheck, answerTimezone };
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
  it('lists only the You group, with a live one-line summary in its label', async () => {
    const { r } = await open(data({}, { theme: 'dark' }));
    expect(has(r, 'group-you')).toBe(true);
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

describe('Block transfers above the balance', () => {
  it('is a switch in You that saves the setting', async () => {
    const { r, changeSetting } = await open(data());
    act(() => fire(r, 'group-you'));
    expect(host(r, 'switch-block-transfers').props.accessibilityState).toEqual({ checked: false });
    await act(async () => fire(r, 'switch-block-transfers', 'onValueChange', true));
    expect(changeSetting).toHaveBeenCalledWith('finance.block_transfers_above_balance', true);
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
  const home: HomeData = {
    currency: 'SGD', locale: 'en-SG', timezoneId: 'Asia/Singapore', today: '2026-11-07', hour: 9, scope: 'This month', spentMinor: 0,
    accounts: { hasAccounts: false, inAccountsMinor: null, notSetCount: 0, cardDuesMinor: null },
  };
  const homeApi: HomeApi = { load: async () => home, seen: new MemorySeenStore() };

  it('asks once and Yes / No call the answer', async () => {
    const f = fakeApi(data());
    f.timezoneCheck.mockResolvedValue({ deviceTz: 'Asia/Dubai' });
    const r = mount(
      <SheetHost>
        <HomeScreen api={homeApi} settingsApi={f.api} onAccounts={jest.fn()} onProfile={jest.fn()} onAddAccount={jest.fn()} />
      </SheetHost>,
    );
    await settle();
    expect(texts(r)).toContain('Your phone is on a different time zone. Use it for your budget days?');
    await act(async () => fire(r, 'tz-yes'));
    expect(f.answerTimezone).toHaveBeenCalledWith(true, 'Asia/Dubai');
    await act(async () => fire(r, 'tz-no'));
    expect(f.answerTimezone).toHaveBeenCalledWith(false, 'Asia/Dubai');
  });

  it('shows nothing when no prompt is due', async () => {
    const f = fakeApi(data());
    const r = mount(
      <SheetHost>
        <HomeScreen api={homeApi} settingsApi={f.api} onAccounts={jest.fn()} onProfile={jest.fn()} onAddAccount={jest.fn()} />
      </SheetHost>,
    );
    await settle();
    expect(has(r, 'timezone-prompt')).toBe(false);
  });
});
