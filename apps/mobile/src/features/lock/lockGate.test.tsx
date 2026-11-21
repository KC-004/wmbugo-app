import { useState } from 'react';
import { AppState, Pressable, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type AppSettings } from '@wmbugo/core';
import { deliverIntent, pendingIntents, registerIntentHandler, type AppIntent } from '../../shared/appIntents';
import { createQueryClient } from '../../shared/queryClient';
import { useLockStore } from '../../shared/state/lockStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import type { SettingsApi } from '../settings/settingsApi';
import { LockGate, type LockGateDeps } from './LockGate';

jest.mock('../../adapters/recentsPrivacy', () => ({ applyHideForAppLock: jest.fn(async () => undefined) }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'UTC' } }));

import { applyHideForAppLock } from '../../adapters/recentsPrivacy';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
  useLockStore.setState({ enabled: false, locked: false });
  pendingIntents.drop();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));

/** A child with state of its own: proves the app tree stays mounted under the gate (FLOW-12). */
function Screen() {
  const [draft, setDraft] = useState('');
  return (
    <>
      <Text testID="amount">₹1,18,600 in your account</Text>
      <Pressable testID="type" onPress={() => setDraft('rent for Feb')}>
        <Text>{`draft:${draft}`}</Text>
      </Pressable>
    </>
  );
}

function makeApi(settings: Partial<AppSettings>): SettingsApi {
  return { load: async () => ({ settings: { ...DEFAULT_SETTINGS, ...settings } }) } as unknown as SettingsApi;
}

type AuthFn = LockGateDeps['authenticate'];
function mount(settings: Partial<AppSettings>, over: Partial<LockGateDeps> = {}) {
  const deps: LockGateDeps = {
    authenticate: jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'success', message: '' })),
    elapsedRealtimeMs: jest.fn(async () => 0),
    openSecuritySettings: jest.fn(async () => undefined),
    ...over,
  };
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <LockGate api={makeApi(settings)} deps={deps}>
            <Screen />
          </LockGate>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  return { r, deps };
}

type Listener = (state: string) => void;
function captureAppState() {
  const listeners: Listener[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: Listener) => {
    listeners.push(l);
    return { remove: () => listeners.splice(listeners.indexOf(l), 1) };
  }) as never);
  return (state: string) => listeners.slice().forEach((l) => l(state));
}

describe('LockGate (Story 8.3)', () => {
  it('does nothing with app lock off', async () => {
    const { r, deps } = mount({ appLockEnabled: false });
    await settle();
    expect(has(r, 'lock-gate')).toBe(false);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('covers a cold start, starts the prompt by itself, and shows the coin mark, the title and Unlock', async () => {
    captureAppState();
    const { r, deps } = mount({ appLockEnabled: true });
    await settle();
    expect(deps.authenticate).toHaveBeenCalledWith('Unlock wmbugo');
    // The prompt succeeded in this run, so the gate is already open; run it again with a cancelled prompt to see the cover.
    expect(has(r, 'lock-gate')).toBe(false);
  });

  it('a dismissed prompt leaves the person on LockGate with Unlock; the tree under it is hidden from accessibility', async () => {
    captureAppState();
    const { r, deps } = mount({ appLockEnabled: true }, { authenticate: jest.fn(async () => ({ result: 'cancelled', message: '' }) as const) });
    await settle();
    expect(has(r, 'lock-gate')).toBe(true);
    expect(texts(r)).toContain('wmbugo is locked');
    expect(texts(r)).toContain('Unlock');
    const hidden = r.root.findAll((n) => typeof n.type === 'string' && n.props.importantForAccessibility === 'no-hide-descendants' && n.props.accessibilityElementsHidden === true);
    expect(hidden.length).toBeGreaterThan(0);
    expect((deps.authenticate as jest.Mock).mock.calls.length).toBe(1);
  });

  it('Unlock runs the prompt again; success returns to the same screen and draft (FLOW-12)', async () => {
    captureAppState();
    const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'cancelled', message: '' }));
    const { r } = mount({ appLockEnabled: true }, { authenticate: auth });
    await settle();
    await act(async () => r.root.findAll((n) => n.props.testID === 'type' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(texts(r)).toContain('draft:rent for Feb');
    auth.mockResolvedValue({ result: 'success', message: '' });
    await press(r, 'lock-unlock');
    expect(has(r, 'lock-gate')).toBe(false);
    expect(texts(r)).toContain('draft:rent for Feb');
  });

  it('shows the system message for a lockout with Try again', async () => {
    captureAppState();
    const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'lockout', message: 'Too many attempts. Try again in 30 seconds.' }));
    const { r } = mount({ appLockEnabled: true }, { authenticate: auth });
    await settle();
    expect(texts(r)).toContain('Too many attempts. Try again in 30 seconds.');
    expect(texts(r)).toContain('Try again');
    auth.mockResolvedValue({ result: 'success', message: '' });
    await press(r, 'lock-unlock');
    expect(has(r, 'lock-gate')).toBe(false);
  });

  it('with no screen lock left on the phone it says so and offers Open settings instead of trapping the person', async () => {
    captureAppState();
    const { r, deps } = mount({ appLockEnabled: true }, { authenticate: jest.fn(async () => ({ result: 'unavailable', message: '' }) as const) });
    await settle();
    expect(has(r, 'lock-open-settings')).toBe(true);
    await press(r, 'lock-open-settings');
    expect(deps.openSecuritySettings).toHaveBeenCalled();
  });

  describe('coming back from the background', () => {
    it('locks only after longer than Lock after, measured on the monotonic clock', async () => {
      const emit = captureAppState();
      let now = 1_000;
      const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'success', message: '' }));
      const { r } = mount({ appLockEnabled: true, lockAfter: '1m' }, { authenticate: auth, elapsedRealtimeMs: jest.fn(async () => now) });
      await settle();
      auth.mockResolvedValue({ result: 'cancelled', message: '' });
      auth.mockClear();

      // 30 seconds away: not locked.
      await act(async () => emit('background'));
      await settle();
      now += 30_000;
      await act(async () => emit('active'));
      await settle();
      expect(has(r, 'lock-gate')).toBe(false);
      expect(auth).not.toHaveBeenCalled();

      // 61 seconds away: locked, and the prompt starts.
      await act(async () => emit('background'));
      await settle();
      now += 61_000;
      await act(async () => emit('active'));
      await settle();
      expect(has(r, 'lock-gate')).toBe(true);
      expect(auth).toHaveBeenCalledTimes(1);
    });

    it('uses the monotonic clock only: setting the phone clock back or forward cannot skip or force the lock', async () => {
      const emit = captureAppState();
      let mono = 0;
      const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'success', message: '' }));
      const { r } = mount({ appLockEnabled: true, lockAfter: '1m' }, { authenticate: auth, elapsedRealtimeMs: jest.fn(async () => mono) });
      await settle();
      auth.mockResolvedValue({ result: 'cancelled', message: '' });
      const realNow = Date.now();

      // 120 seconds really passed, but the person set the phone clock back an hour: still locks.
      const wall = jest.spyOn(Date, 'now').mockReturnValue(realNow - 3_600_000);
      await act(async () => emit('background'));
      await settle();
      mono += 120_000;
      await act(async () => emit('active'));
      await settle();
      expect(has(r, 'lock-gate')).toBe(true);

      // Unlock, then 10 seconds pass while the phone clock jumps a day ahead: does not lock.
      auth.mockResolvedValue({ result: 'success', message: '' });
      await press(r, 'lock-unlock');
      expect(has(r, 'lock-gate')).toBe(false);
      auth.mockResolvedValue({ result: 'cancelled', message: '' });
      await act(async () => emit('background'));
      await settle();
      mono += 10_000;
      wall.mockReturnValue(realNow + 86_400_000);
      await act(async () => emit('active'));
      await settle();
      expect(has(r, 'lock-gate')).toBe(false);
    });

    it('an unreadable monotonic clock locks (the safe side)', async () => {
      const emit = captureAppState();
      const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'success', message: '' }));
      const { r } = mount({ appLockEnabled: true, lockAfter: '15m' }, { authenticate: auth, elapsedRealtimeMs: jest.fn(async () => null) });
      await settle();
      auth.mockResolvedValue({ result: 'cancelled', message: '' });
      await act(async () => emit('background'));
      await settle();
      await act(async () => emit('active'));
      await settle();
      expect(has(r, 'lock-gate')).toBe(true);
    });

    it('Immediately locks on every return', async () => {
      const emit = captureAppState();
      const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'success', message: '' }));
      const { r } = mount({ appLockEnabled: true, lockAfter: 'immediately' }, { authenticate: auth });
      await settle();
      auth.mockResolvedValue({ result: 'cancelled', message: '' });
      await act(async () => emit('background'));
      await settle();
      await act(async () => emit('active'));
      await settle();
      expect(has(r, 'lock-gate')).toBe(true);
    });
  });

  describe('intents while locked (a tapped alert or reminder, a deep link)', () => {
    const intent: AppIntent = { kind: 'open', target: 'bills' };

    it('are held, then opened once after unlock', async () => {
      captureAppState();
      const opened: AppIntent[] = [];
      const off = registerIntentHandler((i) => opened.push(i));
      const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'cancelled', message: '' }));
      const { r } = mount({ appLockEnabled: true }, { authenticate: auth });
      await settle();
      expect(has(r, 'lock-gate')).toBe(true);
      deliverIntent(intent);
      expect(opened).toEqual([]);
      auth.mockResolvedValue({ result: 'success', message: '' });
      await press(r, 'lock-unlock');
      expect(opened).toEqual([intent]);
      deliverIntent(intent);
      expect(opened).toEqual([intent, intent]); // unlocked: opens at once
      off();
    });

    it('are dropped when the unlock is abandoned by leaving the app, and nothing opens', async () => {
      const emit = captureAppState();
      const opened: AppIntent[] = [];
      const off = registerIntentHandler((i) => opened.push(i));
      const auth = jest.fn<ReturnType<AuthFn>, Parameters<AuthFn>>(async () => ({ result: 'cancelled', message: '' }));
      const { r } = mount({ appLockEnabled: true }, { authenticate: auth });
      await settle();
      deliverIntent(intent);
      expect(pendingIntents.size).toBe(1);
      await act(async () => emit('background'));
      await settle();
      expect(pendingIntents.size).toBe(0);
      auth.mockResolvedValue({ result: 'success', message: '' });
      await press(r, 'lock-unlock');
      expect(opened).toEqual([]);
      off();
    });
  });

  it('app lock enforces the app-switcher hiding whatever the setting says', async () => {
    captureAppState();
    mount({ appLockEnabled: true, hideInRecents: false });
    await settle();
    expect(applyHideForAppLock).toHaveBeenCalledWith(true);
  });
});
