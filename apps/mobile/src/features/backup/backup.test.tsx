import { AccessibilityInfo, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { BackupDone } from '@wmbugo/core';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { BackupScreen } from './BackupScreen';
import type { BackupApi } from './backupApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'UTC' } }));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const type = (r: ReactTestRenderer, id: string, text: string) => act(() => host(r, id).props.onChangeText(text));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};

const DONE: BackupDone = { counts: { entries: 1284, accounts: 6, photos: 42 }, bytes: 1000, photosSkipped: 0, recorded: true };
const LONG = 'a passphrase long enough';

function mount(api: BackupApi, extra: { onBusyChange?: (b: boolean) => void; onDone?: () => void } = {}) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider>
        <BackupScreen api={api} {...extra} />
      </ThemeProvider>,
    );
  });
  live.push(r);
  return r;
}

describe('Back up screen (Story 8.7)', () => {
  it('explains the backup, offers Passphrase and Confirm passphrase, and says there is no recovery', () => {
    const r = mount({ run: jest.fn() });
    const all = texts(r);
    expect(all).toContain("A backup is one encrypted file with your entries, accounts, photos and settings. If this phone is lost or reset, it's the only way to get them back.");
    expect(all).toEqual(expect.arrayContaining(['Passphrase', 'Confirm passphrase', "We can't recover this. Without it, the backup can't be opened.", 'You choose where it goes. Saved to a cloud folder, it leaves this phone, still encrypted.']));
  });

  it('the fields allow paste and password managers (password-new), are hidden by default and the Show toggle is a labelled switch', () => {
    const r = mount({ run: jest.fn() });
    for (const id of ['backup-pass', 'backup-confirm']) {
      expect(host(r, id).props.autoComplete).toBe('password-new');
      expect(host(r, id).props.secureTextEntry).toBe(true);
    }
    const toggle = host(r, 'backup-pass-show');
    expect(toggle.props.accessibilityLabel).toBe('Show passphrase, toggle');
    expect(toggle.props.accessibilityRole).toBe('switch');
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
    act(() => r.root.findAll((n) => n.props.testID === 'backup-pass-show' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(host(r, 'backup-pass').props.secureTextEntry).toBe(false);
    expect(host(r, 'backup-confirm').props.secureTextEntry).toBe(false);
    expect(host(r, 'backup-pass-show').props.accessibilityState).toEqual({ checked: true });
  });

  it('a polite live region reads Use at least 12 characters, then Strong enough, and Passphrases don\'t match while they differ', () => {
    const r = mount({ run: jest.fn() });
    expect(texts(r)).toContain('Use at least 12 characters');
    type(r, 'backup-pass', 'short');
    expect(texts(r)).toContain('Use at least 12 characters');
    type(r, 'backup-pass', LONG);
    expect(texts(r)).toContain('Strong enough');
    expect(texts(r)).not.toContain('Use at least 12 characters');
    expect(has(r, 'backup-mismatch')).toBe(false);
    type(r, 'backup-confirm', 'a passphrase long enou');
    expect(texts(r)).toContain("Passphrases don't match");
    const live = r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLiveRegion === 'polite');
    expect(live.length).toBeGreaterThan(0);
  });

  it('Save backup stays disabled (with its reason) until both are satisfied, and does nothing before that', async () => {
    const run = jest.fn();
    const r = mount({ run });
    const btn = () => r.root.findAll((n) => n.props.testID === 'backup-save' && n.props.accessibilityState)[0]!;
    expect(btn().props.accessibilityState).toMatchObject({ disabled: true });
    type(r, 'backup-pass', LONG);
    expect(btn().props.accessibilityState).toMatchObject({ disabled: true });
    type(r, 'backup-confirm', LONG);
    expect(btn().props.accessibilityState?.disabled).toBeFalsy();
    await press(r, 'backup-save');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe(LONG);
  });

  it('shows a determinate progress view with Cancel while it runs, then Backup saved with the counts and the keep-safe line', async () => {
    let progress!: (f: number) => void;
    let finish!: (v: { ok: true; value: BackupDone }) => void;
    const busy: boolean[] = [];
    const run = jest.fn((_p: string, hooks: { onProgress: (f: number) => void }) => {
      progress = hooks.onProgress;
      return new Promise<{ ok: true; value: BackupDone }>((res) => (finish = res));
    });
    const r = mount({ run } as unknown as BackupApi, { onBusyChange: (b) => busy.push(b) });
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await act(async () => void r.root.findAll((n) => n.props.testID === 'backup-save' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(busy).toEqual([true]);
    act(() => progress(0.4));
    expect(texts(r)).toContain('Making your backup…');
    expect(host(r, 'backup-progress-bar').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '40%' })]));
    expect(r.root.findAll((n) => n.props.accessibilityRole === 'progressbar')[0]!.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
    expect(has(r, 'backup-cancel')).toBe(true);
    await act(async () => finish({ ok: true, value: DONE }));
    await settle();
    expect(busy).toEqual([true, false]);
    expect(texts(r)).toContain('Backup saved');
    expect(texts(r)).toContain('1,284 entries · 6 accounts · 42 photos');
    expect(texts(r)).toContain("Keep this file somewhere safe. Without the passphrase it can't be opened.");
  });

  it('Done returns to the Data page', async () => {
    const onDone = jest.fn();
    const r = mount({ run: jest.fn(async () => ({ ok: true as const, value: DONE })) } as unknown as BackupApi, { onDone });
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await press(r, 'backup-save');
    await press(r, 'backup-finish');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('cancelling the system dialog leaves the form as it was and writes nothing', async () => {
    const run = jest.fn(async () => ({ ok: false as const, code: 'DOCUMENT_CANCELLED' as const }));
    const r = mount({ run } as unknown as BackupApi);
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await press(r, 'backup-save');
    expect(has(r, 'backup-form')).toBe(true);
    expect(host(r, 'backup-pass').props.value).toBe(LONG);
    expect(has(r, 'backup-failed')).toBe(false);
  });

  it('a failure says Nothing on this phone changed, offers Try again, and keeps the passphrase fields', async () => {
    const run = jest.fn(async () => ({ ok: false as const, code: 'BACKUP_FAILED' as const }));
    const r = mount({ run } as unknown as BackupApi);
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await press(r, 'backup-save');
    expect(texts(r)).toContain("Couldn't save the backup. Nothing on this phone changed.");
    expect(texts(r)).toContain('Try again');
    expect(host(r, 'backup-pass').props.value).toBe(LONG);
    expect(host(r, 'backup-confirm').props.value).toBe(LONG);
    await press(r, 'backup-save');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a thrown error is a failure, not a crash', async () => {
    const run = jest.fn(async () => {
      throw new Error('native module missing');
    });
    const r = mount({ run } as unknown as BackupApi);
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await press(r, 'backup-save');
    expect(has(r, 'backup-failed')).toBe(true);
  });

  it('Cancel during the backup asks the api to stop and the form returns', async () => {
    let cancelledFn!: () => boolean;
    let progress!: (f: number) => void;
    const run = jest.fn(
      (_p: string, hooks: { onProgress: (f: number) => void; isCancelled: () => boolean }) =>
        new Promise((res) => {
          cancelledFn = hooks.isCancelled;
          progress = hooks.onProgress;
          const t = setInterval(() => {
            if (hooks.isCancelled()) {
              clearInterval(t);
              res({ ok: false, code: 'CANCELLED' });
            }
          }, 5);
        }),
    );
    const r = mount({ run } as unknown as BackupApi);
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await act(async () => void r.root.findAll((n) => n.props.testID === 'backup-save' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    act(() => progress(0.2));
    expect(cancelledFn()).toBe(false);
    await act(async () => r.root.findAll((n) => n.props.testID === 'backup-cancel' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    await act(async () => new Promise((res) => setTimeout(res, 30)));
    expect(cancelledFn()).toBe(true);
    expect(has(r, 'backup-form')).toBe(true);
    expect(has(r, 'backup-failed')).toBe(false);
    void TextInput;
  });
});

describe('Back up screen: the Epic 8 review changes', () => {
  it('twelve of the same character is not Strong enough: it asks for more different characters and keeps Save disabled', () => {
    const r = mount({ run: jest.fn() });
    type(r, 'backup-pass', 'aaaaaaaaaaaa');
    type(r, 'backup-confirm', 'aaaaaaaaaaaa');
    expect(texts(r)).toContain('Use more different characters');
    expect(texts(r)).not.toContain('Strong enough');
    const btn = r.root.findAll((n) => n.props.testID === 'backup-save' && n.props.accessibilityState)[0]!;
    expect(btn.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('shows the progress view with Cancel as soon as the system hands over a place, and says which photos were left out', async () => {
    let progress!: (f: number) => void;
    let finish!: (v: { ok: true; value: BackupDone }) => void;
    const run = jest.fn((_p: string, hooks: { onProgress: (f: number) => void }) => {
      progress = hooks.onProgress;
      return new Promise<{ ok: true; value: BackupDone }>((res) => (finish = res));
    });
    const r = mount({ run } as unknown as BackupApi);
    type(r, 'backup-pass', LONG);
    type(r, 'backup-confirm', LONG);
    await press(r, 'backup-save');
    expect(has(r, 'backup-progress')).toBe(false); // the dialog is open: the form stays
    await act(async () => progress(0));
    expect(has(r, 'backup-progress')).toBe(true);
    expect(has(r, 'backup-cancel')).toBe(true);
    await act(async () => finish({ ok: true, value: { ...DONE, photosSkipped: 2, recorded: false } }));
    await settle();
    expect(texts(r)).toContain("2 photos couldn't be read and are not in this backup.");
    expect(texts(r)).toContain("The backup is saved, but the date of your last backup couldn't be updated.");
  });
});
