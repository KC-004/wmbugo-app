import { useEffect } from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import { useSheet } from '../../shared/feedback/SheetHost';
import { has, installInsightsHooks, mountNode, press, settle, texts } from '../insights/insightsTestKit';
import { AppLockOfferHost, type AppLockOfferApi } from './AppLockOfferHost';
import { cancelAppLockOffer, scheduleAppLockOffer } from './appLockOfferBus';

jest.mock('./enableAppLock', () => ({ enableAppLock: jest.fn() }));
jest.mock('../home/homeApi', () => ({ promptStateSeenStore: { hasSeen: jest.fn(), markSeen: jest.fn() } }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'UTC' } }));

import { enableAppLock } from './enableAppLock';

installInsightsHooks();

const wait = (ms: number) => act(async () => new Promise((res) => setTimeout(res, ms)));

function fakeApi(kind: 'biometric' | 'credential' | null = 'biometric') {
  let seen = false;
  const markShown = jest.fn(async () => void (seen = true));
  const api: AppLockOfferApi = {
    eligibility: jest.fn(async () => (seen ? null : kind)),
    markShown,
    settings: { setAppLock: jest.fn(async () => ({ ok: true })), changeSetting: jest.fn(async () => ({ ok: true })) },
  };
  return { api, markShown };
}

const mountHost = (api: AppLockOfferApi) => mountNode(<AppLockOfferHost api={api} delayMs={5} />);

describe('one-time app lock offer (Story 8.4)', () => {
  beforeEach(() => (enableAppLock as jest.Mock).mockReset());

  it('opens after the first save with the fingerprint wording, and records it as shown at once', async () => {
    const { api, markShown } = fakeApi('biometric');
    const r = await mountHost(api);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(texts(r)).toContain('Lock wmbugo with your fingerprint?');
    expect(texts(r)).toContain("You'll unlock it when you open wmbugo. Change this anytime in Settings › Privacy.");
    expect(texts(r)).toContain('Turn on app lock');
    expect(texts(r)).toContain('Not now');
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('says screen lock when no biometric is enrolled', async () => {
    const r = await mountHost(fakeApi('credential').api);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(texts(r)).toContain('Lock wmbugo with your screen lock?');
  });

  it('Not now closes it and it never appears again, even after another save', async () => {
    const { api, markShown } = fakeApi();
    const r = await mountHost(api);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    await press(r, 'app-lock-offer-later');
    expect(has(r, 'app-lock-offer')).toBe(false);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(has(r, 'app-lock-offer')).toBe(false);
    expect(markShown).toHaveBeenCalledTimes(1);
    expect(enableAppLock).not.toHaveBeenCalled();
  });

  it('Turn on app lock runs the Story 8.3 enable flow and toasts App lock on', async () => {
    (enableAppLock as jest.Mock).mockResolvedValue({ status: 'enabled' });
    const { api } = fakeApi();
    const r = await mountHost(api);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    await press(r, 'app-lock-offer-yes');
    await settle();
    expect(enableAppLock).toHaveBeenCalledWith(api.settings);
    expect(texts(r)).toContain('App lock on');
  });

  it('a cancelled system prompt leaves app lock off, shows no toast, and the offer is not repeated', async () => {
    (enableAppLock as jest.Mock).mockResolvedValue({ status: 'cancelled' });
    const { api, markShown } = fakeApi();
    const r = await mountHost(api);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    await press(r, 'app-lock-offer-yes');
    await settle();
    expect(texts(r)).not.toContain('App lock on');
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(has(r, 'app-lock-offer')).toBe(false);
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('an Undo before the sheet appears cancels it, records nothing, and the next save can offer it', async () => {
    const { api, markShown } = fakeApi();
    const r = await mountHost(api);
    act(() => scheduleAppLockOffer());
    act(() => cancelAppLockOffer());
    await wait(30);
    await settle();
    expect(has(r, 'app-lock-offer')).toBe(false);
    expect(markShown).not.toHaveBeenCalled();
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(has(r, 'app-lock-offer')).toBe(true);
  });

  it('does nothing and records nothing when it must not appear (app lock on, already shown, or no screen lock)', async () => {
    const { api, markShown } = fakeApi(null);
    const r = await mountHost(api);
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(has(r, 'app-lock-offer')).toBe(false);
    expect(markShown).not.toHaveBeenCalled();
  });

  it('never opens over another sheet', async () => {
    const { api, markShown } = fakeApi();
    function OtherSheet() {
      const sheet = useSheet();
      useEffect(() => {
        sheet.open({ id: 'other', title: 'Other sheet', body: () => <Text>other</Text> });
      }, []);
      return null;
    }
    const r = await mountNode(
      <>
        <AppLockOfferHost api={api} delayMs={5} />
        <OtherSheet />
      </>,
    );
    act(() => scheduleAppLockOffer());
    await wait(30);
    await settle();
    expect(has(r, 'app-lock-offer')).toBe(false);
    expect(texts(r)).toContain('Other sheet');
    expect(markShown).not.toHaveBeenCalled();
  });
});
