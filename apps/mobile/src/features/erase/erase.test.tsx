import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../../shared/queryClient';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { useLockStore } from '../../shared/state/lockStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { EraseFlow } from './EraseFlow';
import type { EraseApi } from './eraseApi';

jest.mock('../../adapters/appLock', () => ({ authenticate: jest.fn(async () => ({ result: 'success', message: '' })) }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'UTC' }, takeRestoreOutcome: () => 'none' }));

import { authenticate } from '../../adapters/appLock';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
  useLockStore.setState({ enabled: false, locked: false });
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  (authenticate as jest.Mock).mockClear();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const disabled = (r: ReactTestRenderer, id: string) => Boolean(r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0]!.props.accessibilityState.disabled);

async function mount(api: EraseApi, extra: { onExit?: () => void; onBusyChange?: (b: boolean) => void } = {}) {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <EraseFlow api={api} onExit={extra.onExit ?? jest.fn()} {...(extra.onBusyChange ? { onBusyChange: extra.onBusyChange } : {})} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return r;
}

describe('Erase all data (Story 8.11)', () => {
  it('the first screen states the scope, that saved backup files are not touched, and that it cannot be undone', async () => {
    const r = await mount({ erase: jest.fn() });
    expect(texts(r)).toEqual(
      expect.arrayContaining([
        'This erases from this phone: all entries, accounts, budgets, bills, goals, categories, photos, settings and the app log.',
        "Backup files you saved elsewhere aren't touched. Delete them yourself if you want them gone.",
        "This can't be undone.",
        'Back up this phone first',
        'Continue',
      ]),
    );
  });

  it('Back up this phone first opens the backup screen and returns to the same first screen', async () => {
    const r = await mount({ erase: jest.fn() });
    await press(r, 'erase-backup-link');
    expect(has(r, 'backup-form')).toBe(true);
    await press(r, 'erase-backup-back');
    expect(has(r, 'erase-scope')).toBe(true);
  });

  it('Continue opens the confirmation: the checkbox enables the destructive Erase everything', async () => {
    const r = await mount({ erase: jest.fn() });
    await press(r, 'erase-continue');
    expect(has(r, 'erase-confirm')).toBe(true);
    expect(disabled(r, 'erase-go')).toBe(true);
    const box = r.root.findAll((n) => n.props.testID === 'erase-understand' && n.props.accessibilityRole === 'checkbox')[0]!;
    expect(box.props.accessibilityLabel).toBe('I understand everything on this phone will be erased');
    await press(r, 'erase-understand');
    expect(disabled(r, 'erase-go')).toBe(false);
    expect(texts(r)).toContain('Erase everything');
  });

  it('Cancel at either step changes nothing and erases nothing', async () => {
    const api: EraseApi = { erase: jest.fn() };
    const onExit = jest.fn();
    const r = await mount(api, { onExit });
    await press(r, 'erase-scope-cancel');
    expect(onExit).toHaveBeenCalledTimes(1);
    await press(r, 'erase-continue');
    await press(r, 'erase-cancel');
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(api.erase).not.toHaveBeenCalled();
  });

  it('pressing Erase everything without the tick does nothing', async () => {
    const api: EraseApi = { erase: jest.fn() };
    const r = await mount(api);
    await press(r, 'erase-continue');
    await press(r, 'erase-go');
    expect(api.erase).not.toHaveBeenCalled();
  });

  it('with app lock on, Confirm it is you is asked first; cancelling keeps the confirmation as it was', async () => {
    useLockStore.setState({ enabled: true });
    (authenticate as jest.Mock).mockResolvedValueOnce({ result: 'cancelled', message: '' });
    const api: EraseApi = { erase: jest.fn(async () => 'ok' as const) };
    const r = await mount(api);
    await press(r, 'erase-continue');
    await press(r, 'erase-understand');
    await press(r, 'erase-go');
    expect(authenticate).toHaveBeenCalledWith("Confirm it's you");
    expect(api.erase).not.toHaveBeenCalled();
    expect(has(r, 'erase-confirm')).toBe(true);
    await press(r, 'erase-go');
    expect(api.erase).toHaveBeenCalledTimes(1);
  });

  it('with app lock off nothing is asked, and the erase runs', async () => {
    const busy: boolean[] = [];
    const api: EraseApi = { erase: jest.fn(async () => 'ok' as const) };
    const r = await mount(api, { onBusyChange: (b) => busy.push(b) });
    await press(r, 'erase-continue');
    await press(r, 'erase-understand');
    await press(r, 'erase-go');
    expect(authenticate).not.toHaveBeenCalled();
    expect(api.erase).toHaveBeenCalledTimes(1);
    expect(has(r, 'erase-running')).toBe(true);
    expect(texts(r)).toContain('Erasing…');
    expect(busy).toEqual([true]); // the app restarts on Welcome; this screen is never left
  });

  it('a failed erase says the next start will finish it', async () => {
    const r = await mount({ erase: jest.fn(async () => 'failed' as const) });
    await press(r, 'erase-continue');
    await press(r, 'erase-understand');
    await press(r, 'erase-go');
    expect(texts(r)).toContain("Couldn't finish erasing. wmbugo will finish it when it opens next.");
  });

  it('a thrown error is a failure, not a crash', async () => {
    const r = await mount({ erase: jest.fn(async () => Promise.reject(new Error('x'))) });
    await press(r, 'erase-continue');
    await press(r, 'erase-understand');
    await press(r, 'erase-go');
    expect(has(r, 'erase-failed')).toBe(true);
  });
});
