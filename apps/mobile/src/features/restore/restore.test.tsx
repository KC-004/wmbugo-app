import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { BackupManifest, ByteSource } from '@wmbugo/core';
import { createQueryClient } from '../../shared/queryClient';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { useLockStore } from '../../shared/state/lockStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { RestoreFlow } from './RestoreFlow';
import { RestoreNoticeHost } from './RestoreNoticeHost';
import type { RestoreApi } from './restoreApi';

jest.mock('../../adapters/appLock', () => ({ authenticate: jest.fn(async () => ({ result: 'success', message: '' })) }));
jest.mock('../../adapters/startApp', () => ({
  getServices: jest.fn(),
  systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' },
  takeRestoreOutcome: jest.fn(() => 'none'),
}));

import { authenticate } from '../../adapters/appLock';
import { takeRestoreOutcome } from '../../adapters/startApp';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
  useLockStore.setState({ enabled: false, locked: false });
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  (authenticate as jest.Mock).mockClear();
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = (r: ReactTestRenderer, id: string, text: string) => act(() => host(r, id).props.onChangeText(text));
const disabled = (r: ReactTestRenderer, id: string) => Boolean(r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0]!.props.accessibilityState.disabled);

const MANIFEST: BackupManifest = {
  formatVersion: 1,
  schemaVersion: 20,
  appId: 'app.wmbugo',
  appVersion: '1.0',
  createdAt: { utcMs: Date.UTC(2026, 10, 3, 13, 14, 0), timezoneId: 'Asia/Singapore' },
  counts: { entries: 1284, accounts: 6, photos: 42 },
  accountBalances: [],
  entries: [],
  payloadChecksum: '00'.repeat(32),
  archiveKey: '00'.repeat(32),
};

const SOURCE: ByteSource = { size: 1000, read: async () => new Uint8Array(0) };

function fakeApi(over: Partial<RestoreApi> = {}): { api: RestoreApi; calls: string[] } {
  const calls: string[] = [];
  const api: RestoreApi = {
    pick: jest.fn(async () => (calls.push('pick'), { source: SOURCE, close: async () => void calls.push('close') })),
    inspect: jest.fn(async () => ({ ok: true as const, value: { size: 1000 } })),
    openManifest: jest.fn(async () => ({ ok: true as const, value: MANIFEST })),
    thisPhone: jest.fn(async () => ({ entries: 12, accounts: 2, photos: 0 })),
    lowSpace: jest.fn(async () => false),
    restore: jest.fn(async () => ({ ok: true as const, value: { manifest: MANIFEST } })),
    finish: jest.fn(async () => void calls.push('finish')),
    timezoneId: jest.fn(async () => 'Asia/Singapore'),
    ...over,
  };
  return { api, calls };
}

async function mount(api: RestoreApi, extra: { onExit?: () => void; onBusyChange?: (b: boolean) => void } = {}) {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <RestoreFlow api={api} onExit={extra.onExit ?? jest.fn()} {...(extra.onBusyChange ? { onBusyChange: extra.onBusyChange } : {})} />
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

const toConfirm = async (api: RestoreApi) => {
  const r = await mount(api);
  type(r, 'restore-pass', 'the passphrase');
  await press(r, 'restore-open');
  return r;
};

describe('Restore from a backup (Story 8.9)', () => {
  it('opens the system file picker at once; cancelling it leaves the flow', async () => {
    const onExit = jest.fn();
    await mount(fakeApi({ pick: jest.fn(async () => null) }).api, { onExit });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('a file that is not a wmbugo backup says so at once and changes nothing', async () => {
    const f = fakeApi({ inspect: jest.fn(async () => ({ ok: false as const, code: 'NOT_A_WMBUGO_BACKUP' as const })) });
    const r = await mount(f.api);
    expect(texts(r)).toContain("This isn't a wmbugo backup. Nothing on this phone changed.");
    expect(f.api.openManifest).not.toHaveBeenCalled();
    expect(f.api.restore).not.toHaveBeenCalled();
    expect(f.calls).toContain('close');
  });

  it('asks for the passphrase with one field (autoComplete password), a Show toggle and Open backup', async () => {
    const r = await mount(fakeApi().api);
    expect(host(r, 'restore-pass').props.autoComplete).toBe('password');
    expect(host(r, 'restore-pass').props.secureTextEntry).toBe(true);
    expect(host(r, 'restore-pass-show').props.accessibilityLabel).toBe('Show passphrase, toggle');
    expect(texts(r)).toContain('Open backup');
    expect(has(r, 'restore-confirm')).toBe(false);
  });

  it('a wrong passphrase shows the message under the field, keeps what was typed, and moves focus back to it', async () => {
    const f = fakeApi({ openManifest: jest.fn(async () => ({ ok: false as const, code: 'WRONG_PASSPHRASE' as const })) });
    const r = await mount(f.api);
    type(r, 'restore-pass', 'not it');
    await press(r, 'restore-open');
    expect(texts(r)).toContain("That passphrase doesn't open this backup. Nothing on this phone changed.");
    expect(host(r, 'restore-pass').props.value).toBe('not it');
    expect(has(r, 'restore-checking')).toBe(false);
    // Typing again clears the message.
    type(r, 'restore-pass', 'not it either');
    expect(has(r, 'restore-wrong')).toBe(false);
  });

  it('shows Checking your backup… while it reads the manifest', async () => {
    let finish!: (v: { ok: true; value: BackupManifest }) => void;
    const f = fakeApi({ openManifest: jest.fn(() => new Promise((res) => (finish = res as never))) });
    const r = await mount(f.api);
    type(r, 'restore-pass', 'x');
    await act(async () => void r.root.findAll((n) => n.props.testID === 'restore-open' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(texts(r)).toContain('Checking your backup…');
    await act(async () => finish({ ok: true, value: MANIFEST }));
    await settle();
    expect(has(r, 'restore-confirm')).toBe(true);
  });

  it('a damaged file and a newer backup say what happened and that nothing on this phone changed', async () => {
    const damaged = await toConfirm(fakeApi({ openManifest: jest.fn(async () => ({ ok: false as const, code: 'BACKUP_DAMAGED' as const })) }).api);
    expect(texts(damaged)).toContain("This backup file is damaged, so it can't be restored. Nothing on this phone changed.");
    const newer = await toConfirm(fakeApi({ openManifest: jest.fn(async () => ({ ok: false as const, code: 'BACKUP_TOO_NEW' as const })) }).api);
    expect(texts(newer)).toContain('This backup was made by a newer version of wmbugo. Update wmbugo, then try again. Nothing on this phone changed.');
  });

  describe('the confirmation', () => {
    it('shows the backup beside this phone now, the safety line, and the back-up-first link', async () => {
      const r = await toConfirm(fakeApi().api);
      const all = texts(r);
      expect(all).toEqual(expect.arrayContaining(['Backup', 'This phone now', 'Made 3 Nov 2026, 9:14 pm', '1,284 entries · 6 accounts · 42 photos', '12 entries · 2 accounts · 0 photos', 'If something goes wrong during restore, nothing on this phone changes.', 'Back up this phone first']));
      expect(all.join(' ')).not.toMatch(/safety copy|we keep|typed|type the word/i); // no promise of a kept copy, no typed-word confirmation
    });

    it('from Welcome it says Nothing yet and offers no back-up-first link', async () => {
      const r = await toConfirm(fakeApi({ thisPhone: jest.fn(async () => null) }).api);
      expect(texts(r)).toContain('Nothing yet');
      expect(has(r, 'restore-backup-first-link')).toBe(false);
    });

    it('Restore stays disabled until the checkbox is ticked, and the checkbox announces its state', async () => {
      const r = await toConfirm(fakeApi().api);
      expect(disabled(r, 'restore-go')).toBe(true);
      const box = () => r.root.findAll((n) => n.props.testID === 'restore-understand' && n.props.accessibilityRole === 'checkbox')[0]!;
      expect(box().props.accessibilityLabel).toBe("I understand this replaces what's on this phone now");
      expect(box().props.accessibilityState).toEqual({ checked: false });
      await press(r, 'restore-understand');
      expect(box().props.accessibilityState).toEqual({ checked: true });
      expect(disabled(r, 'restore-go')).toBe(false);
      await press(r, 'restore-understand');
      expect(disabled(r, 'restore-go')).toBe(true);
    });

    it('with too little free space it adds the warning and a second checkbox, and Restore needs both', async () => {
      const r = await toConfirm(fakeApi({ lowSpace: jest.fn(async () => true) }).api);
      expect(texts(r)).toContain("There isn't room to keep a copy of this phone's data while restoring.");
      expect(texts(r)).toContain('Restore without that copy');
      await press(r, 'restore-understand');
      expect(disabled(r, 'restore-go')).toBe(true);
      await press(r, 'restore-without-copy');
      expect(disabled(r, 'restore-go')).toBe(false);
    });

    it('Back up this phone first opens the backup screen and returns to the same confirmation with the selection kept', async () => {
      const f = fakeApi();
      const r = await toConfirm(f.api);
      await press(r, 'restore-understand');
      await press(r, 'restore-backup-first-link');
      expect(has(r, 'backup-form')).toBe(true);
      await press(r, 'restore-backup-back');
      expect(has(r, 'restore-confirm')).toBe(true);
      expect(f.api.pick).toHaveBeenCalledTimes(1); // the file was not picked again
      expect(f.api.openManifest).toHaveBeenCalledTimes(1);
    });
  });

  describe('restoring', () => {
    it('passes the re-authentication guard first (app lock on); cancelling keeps the confirmation as it was', async () => {
      useLockStore.setState({ enabled: true });
      (authenticate as jest.Mock).mockResolvedValueOnce({ result: 'cancelled', message: '' });
      const f = fakeApi();
      const r = await toConfirm(f.api);
      await press(r, 'restore-understand');
      await press(r, 'restore-go');
      expect(authenticate).toHaveBeenCalledWith("Confirm it's you");
      expect(f.api.restore).not.toHaveBeenCalled();
      expect(has(r, 'restore-confirm')).toBe(true);
      await press(r, 'restore-go'); // the prompt succeeds this time
      expect(f.api.restore).toHaveBeenCalledTimes(1);
    });

    it('with app lock off the guard does not ask', async () => {
      const f = fakeApi();
      const r = await toConfirm(f.api);
      await press(r, 'restore-understand');
      await press(r, 'restore-go');
      expect(authenticate).not.toHaveBeenCalled();
      expect(f.api.restore).toHaveBeenCalledWith(SOURCE, 'the passphrase', { withoutSafetyCopy: false });
    });

    it('shows Restoring… with no Cancel, then restarts the app on success', async () => {
      let done!: (v: { ok: true; value: { manifest: BackupManifest } }) => void;
      const busy: boolean[] = [];
      const f = fakeApi({ restore: jest.fn(() => new Promise((res) => (done = res as never))) });
      const r = await mount(f.api, { onBusyChange: (b) => busy.push(b) });
      type(r, 'restore-pass', 'the passphrase');
      await press(r, 'restore-open');
      await press(r, 'restore-understand');
      await act(async () => void r.root.findAll((n) => n.props.testID === 'restore-go' && typeof n.props.onPress === 'function')[0]!.props.onPress());
      expect(texts(r)).toContain('Restoring…');
      expect(r.root.findAll((n) => /cancel/i.test(String(n.props.testID ?? '')))).toHaveLength(0);
      expect(busy).toEqual([true, false, true]); // reading the manifest, then the restore
      await act(async () => done({ ok: true, value: { manifest: MANIFEST } }));
      await settle();
      expect(f.calls).toContain('finish');
    });

    it('without a safety copy is sent only when both boxes are ticked', async () => {
      const f = fakeApi({ lowSpace: jest.fn(async () => true) });
      const r = await toConfirm(f.api);
      await press(r, 'restore-understand');
      await press(r, 'restore-without-copy');
      await press(r, 'restore-go');
      expect(f.api.restore).toHaveBeenCalledWith(SOURCE, 'the passphrase', { withoutSafetyCopy: true });
    });

    it('a failed restore says the phone is as it was before and offers Close', async () => {
      const onExit = jest.fn();
      const f = fakeApi({ restore: jest.fn(async () => ({ ok: false as const, code: 'RESTORE_FAILED' as const })) });
      const r = await mount(f.api, { onExit });
      type(r, 'restore-pass', 'the passphrase');
      await press(r, 'restore-open');
      await press(r, 'restore-understand');
      await press(r, 'restore-go');
      expect(texts(r)).toContain("The restore didn't finish. Your phone is as it was before.");
      await press(r, 'restore-close');
      expect(onExit).toHaveBeenCalled();
      expect(f.calls).not.toContain('finish');
    });
  });
});

describe('the notice after a restart (Story 8.8, 8.9)', () => {
  const mountHost = async (read?: () => Promise<string | null>) => {
    const qc = createQueryClient();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <RestoreNoticeHost {...(read ? { readNotice: read } : {})} />
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await settle();
    return r;
  };

  it('says Restored from your 3 Nov backup after a restore that held', async () => {
    (takeRestoreOutcome as jest.Mock).mockReturnValueOnce('restored');
    const r = await mountHost(async () => '3 Nov');
    expect(texts(r)).toContain('Restored from your 3 Nov backup');
  });

  it('says the phone is as it was before when the restored data failed its start checks', async () => {
    (takeRestoreOutcome as jest.Mock).mockReturnValueOnce('restore-failed');
    const r = await mountHost();
    expect(texts(r)).toContain("The restore didn't finish. Your phone is as it was before.");
  });

  it('says nothing after a normal start', async () => {
    (takeRestoreOutcome as jest.Mock).mockReturnValueOnce('none');
    const r = await mountHost();
    expect(texts(r).join(' ')).not.toMatch(/Restored|restore/);
  });
});
