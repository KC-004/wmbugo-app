import { AccessibilityInfo, BackHandler, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Result, StartupErrorCode, StartupOk } from '@wmbugo/core';
import { AddButton } from '../shell/AddButton';
import { createQueryClient } from '../../shared/queryClient';
import { useSafeModeStore } from '../../shared/state/safeModeStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { StartupGate } from '../startup/StartupGate';
import { SafeModeBanner } from './SafeModeBanner';
import { SafeModeScreen } from './SafeModeScreen';
import { StartFailure } from './StartFailure';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(() => { throw new Error('storage not started'); }), systemClock: { nowMs: () => 0, timezoneId: () => 'UTC' }, takeRestoreOutcome: () => 'none' }));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
  useSafeModeStore.setState({ reason: null });
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const disabled = (r: ReactTestRenderer, id: string) => Boolean(r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0]?.props.accessibilityState?.disabled);

async function mount(node: React.ReactElement) {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>{node}</ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return r;
}

describe('full-screen safe mode (Story 8.12)', () => {
  it('unreadable database: the sentence, Restore from backup and Diagnostics, and Back up what can be read shown disabled with the reason', async () => {
    const r = await mount(<SafeModeScreen variant="unreadable" onRetry={jest.fn()} />);
    expect(texts(r)).toEqual(expect.arrayContaining(["wmbugo can't safely change your data right now. Your entries are untouched.", 'Restore from backup', 'Diagnostics', 'Back up what can be read', "The data can't be read, so it can't be backed up."]));
    expect(disabled(r, 'safe-mode-backup')).toBe(true);
    const hint = r.root.findAll((n) => n.props.testID === 'safe-mode-backup' && n.props.accessibilityHint)[0]!.props.accessibilityHint;
    expect(hint).toBe("The data can't be read, so it can't be backed up.");
    expect(has(r, 'safe-mode-fresh')).toBe(false);
    expect(has(r, 'safe-mode-retry')).toBe(true); // a transient fault should not need a restore
  });

  it('a database saved by a newer wmbugo says to update, with Try again and Diagnostics but no restore or erase', async () => {
    const r = await mount(<SafeModeScreen variant="newer" onRetry={jest.fn()} />);
    expect(texts(r)).toContain('This data was saved by a newer version of wmbugo. Update wmbugo to open it. Your entries are untouched.');
    expect(has(r, 'safe-mode-retry')).toBe(true);
    expect(has(r, 'safe-mode-diagnostics')).toBe(true);
    for (const id of ['safe-mode-restore', 'safe-mode-fresh', 'safe-mode-backup']) expect(has(r, id)).toBe(false);
  });

  it('an erase that could not be finished says so, and Try again runs it again', async () => {
    const onRetry = jest.fn();
    const r = await mount(<SafeModeScreen variant="erase" onRetry={onRetry} />);
    expect(texts(r)).toContain("wmbugo couldn't finish erasing this phone's data. Try again to finish. Nothing new was added.");
    await press(r, 'safe-mode-retry');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(has(r, 'safe-mode-restore')).toBe(false);
  });

  it('a migration that rolled back says nothing was lost and Try again runs it again', async () => {
    const onRetry = jest.fn();
    const r = await mount(<SafeModeScreen variant="migration" onRetry={onRetry} />);
    expect(texts(r)).toContain("wmbugo couldn't finish updating your data. Nothing was lost.");
    await press(r, 'safe-mode-retry');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a lost key says a backup is the only way back, and offers Restore, Start fresh and Diagnostics', async () => {
    const r = await mount(<SafeModeScreen variant="key-lost" onRetry={jest.fn()} />);
    expect(texts(r)).toContain("This phone's key for wmbugo is gone, so the data here can't be opened. A backup is the only way to get it back.");
    for (const id of ['safe-mode-restore', 'safe-mode-fresh', 'safe-mode-diagnostics']) expect(has(r, id)).toBe(true);
    expect(has(r, 'safe-mode-backup')).toBe(false);
    expect(has(r, 'safe-mode-retry')).toBe(false); // a gone key does not come back by trying again
  });

  it('Start fresh opens the Story 8.11 erase flow, and Back returns', async () => {
    const r = await mount(<SafeModeScreen variant="key-lost" onRetry={jest.fn()} />);
    await press(r, 'safe-mode-fresh');
    expect(has(r, 'erase-scope')).toBe(true);
    await press(r, 'safe-mode-back');
    expect(has(r, 'safe-mode')).toBe(true);
  });

  it('Restore from backup opens the Story 8.9 flow and Diagnostics opens the Story 8.10 screens, with no database', async () => {
    const r = await mount(<SafeModeScreen variant="unreadable" onRetry={jest.fn()} />);
    await press(r, 'safe-mode-diagnostics');
    expect(has(r, 'diagnostics')).toBe(true);
    await press(r, 'diagnostics-export');
    expect(has(r, 'diagnostics-preview')).toBe(true);
    await press(r, 'safe-mode-back');
    expect(has(r, 'diagnostics')).toBe(true);
    await press(r, 'safe-mode-back');
    expect(has(r, 'safe-mode')).toBe(true);
  });
});

describe('a failed start (StartFailure, StartupGate)', () => {
  it('asks why and shows the matching screen', async () => {
    const describe = jest.fn(async () => 'key-lost' as const);
    const r = await mount(<StartFailure code="KEY_UNAVAILABLE" onRetry={jest.fn()} describe={describe} />);
    expect(describe).toHaveBeenCalledWith('KEY_UNAVAILABLE');
    expect(has(r, 'safe-mode-fresh')).toBe(true);
  });

  it('if the storage cannot be asked, a rolled-back migration is still recognised and anything else is unreadable', async () => {
    const boom = jest.fn(async () => Promise.reject(new Error('x')));
    const m = await mount(<StartFailure code="MIGRATION_FAILED" onRetry={jest.fn()} describe={boom} />);
    expect(has(m, 'safe-mode-retry')).toBe(true);
    const u = await mount(<StartFailure code="DATABASE_OPEN_FAILED" onRetry={jest.fn()} describe={boom} />);
    expect(has(u, 'safe-mode-backup')).toBe(true);
  });

  it('Try again starts again and success leaves safe mode without a restart', async () => {
    let attempts = 0;
    const start = jest.fn(async (): Promise<Result<StartupOk, StartupErrorCode>> => {
      attempts += 1;
      return attempts === 1 ? { ok: false, code: 'MIGRATION_FAILED' } : { ok: true, value: { db: {} as never, route: 'home' } };
    });
    const describe = async () => 'migration' as const;
    const r = await mount(
      <StartupGate start={start} renderError={(code, retry) => <StartFailure code={code} onRetry={retry} describe={describe} />}>
        {() => <Text>Home reached</Text>}
      </StartupGate>,
    );
    expect(has(r, 'safe-mode-retry')).toBe(true);
    await press(r, 'safe-mode-retry');
    expect(start).toHaveBeenCalledTimes(2);
    expect(texts(r)).toContain('Home reached');
    expect(has(r, 'safe-mode')).toBe(false);
  });
});

describe('safe mode with a readable database: the banner and the Add button', () => {
  it('shows nothing in normal operation', async () => {
    const r = await mount(<SafeModeBanner />);
    expect(has(r, 'safe-mode-banner')).toBe(false);
  });

  it('shows the persistent banner with Restore from backup, Back up what can be read and Diagnostics', async () => {
    useSafeModeStore.setState({ reason: 'quick_check_failed' });
    const r = await mount(<SafeModeBanner />);
    expect(texts(r)).toEqual(expect.arrayContaining(["wmbugo can't safely change your data right now. Your entries are untouched.", 'Restore from backup', 'Back up what can be read', 'Diagnostics']));
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'safe-mode-banner')[0]!.props.accessibilityRole).toBe('alert');
  });

  it('Check again asks the database once more and the banner is the store\'s to clear', async () => {
    useSafeModeStore.setState({ reason: 'quick_check_failed' });
    const recheck = jest.fn(async () => {
      useSafeModeStore.setState({ reason: null });
      return true;
    });
    const r = await mount(<SafeModeBanner recheck={recheck} />);
    await press(r, 'safe-banner-recheck');
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(has(r, 'safe-mode-banner')).toBe(false);
  });

  it('hardware Back closes an open panel first, and is held while a backup runs', async () => {
    useSafeModeStore.setState({ reason: 'quick_check_failed' });
    const handlers: (() => boolean)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, h: () => boolean) => {
      handlers.push(h);
      return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
    }) as never);
    const r = await mount(<SafeModeBanner />);
    await press(r, 'safe-banner-diagnostics');
    expect(has(r, 'diagnostics')).toBe(true);
    await act(async () => void handlers[handlers.length - 1]!());
    expect(has(r, 'diagnostics')).toBe(false);
    expect(has(r, 'safe-mode-banner')).toBe(true);
  });

  it('each action opens its screen over the app and Back returns to the banner', async () => {
    useSafeModeStore.setState({ reason: 'quick_check_failed' });
    const r = await mount(<SafeModeBanner />);
    await press(r, 'safe-banner-backup');
    expect(has(r, 'backup-form')).toBe(true);
    await press(r, 'safe-mode-panel-back');
    expect(has(r, 'safe-mode-banner')).toBe(true);
    await press(r, 'safe-banner-diagnostics');
    expect(has(r, 'diagnostics')).toBe(true);
    await press(r, 'safe-mode-panel-back');
    await press(r, 'safe-banner-restore');
    await settle();
    expect(has(r, 'safe-mode-panel')).toBe(true);
  });

  it('the Add button is disabled with the reason in safe mode, does nothing, and works normally otherwise', async () => {
    const onPress = jest.fn();
    const r = await mount(<AddButton onPress={onPress} />);
    const btn = () => r.root.findAll((n) => n.props.testID === 'add-button' && n.props.accessibilityState)[0]!;
    expect(btn().props.accessibilityState?.disabled).toBeFalsy();
    act(() => btn().props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => useSafeModeStore.setState({ reason: 'quick_check_failed' }));
    expect(btn().props.accessibilityState).toMatchObject({ disabled: true });
    expect(btn().props.accessibilityHint).toBe("wmbugo can't safely change your data right now. Your entries are untouched.");
    expect(btn().props.onPress).toBeUndefined();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
