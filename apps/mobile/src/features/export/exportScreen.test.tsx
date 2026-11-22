import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../../shared/queryClient';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ExportScreen, exportedText } from './ExportScreen';
import type { ExportApi, ExportContext, ExportOutcome, ExportRequest, ExportRunHooks } from './exportApi';

jest.mock('lottie-react-native', () => ({ __esModule: true, default: () => null }));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Europe/London' } }));
jest.mock('../../adapters/backup/backupFiles', () => ({ createCsvDocument: jest.fn() }));
jest.mock('../../shared/reauth', () => ({ requireReauth: jest.fn(async () => true) }));

import { requireReauth } from '../../shared/reauth';

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  (requireReauth as jest.Mock).mockReset().mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = async (r: ReactTestRenderer, id: string, text: string) => {
  await act(async () => host(r, id).props.onChangeText(text));
};
const selected = (r: ReactTestRenderer, id: string) => Boolean(r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0]?.props.accessibilityState.selected);

const CTX: ExportContext = {
  accounts: [
    { id: 'a1', name: 'Monzo Current', archived: false },
    { id: 'a2', name: 'Amex', archived: false },
    { id: 'a3', name: 'Old savings', archived: true },
  ],
  today: '2026-11-08',
  timezoneId: 'Europe/London',
  currency: 'GBP',
  exponent: 2,
  firstEntryDate: '2026-01-01',
  profile: { rule: { kind: 'first' }, firstDay: 'mon' },
};

function fakeApi(outcome: ExportOutcome | ((req: ExportRequest, hooks: ExportRunHooks) => Promise<ExportOutcome>) = { kind: 'saved', export: 'transactions', count: 1284 }) {
  const run = jest.fn(async (req: ExportRequest, hooks: ExportRunHooks) => (typeof outcome === 'function' ? outcome(req, hooks) : outcome));
  const api: ExportApi = { context: jest.fn(async () => CTX), run };
  return { api, run };
}

async function mount(api: ExportApi, props: { initialKind?: 'transactions' | 'accounts'; initialChoice?: 'all_time' } = {}) {
  const onBusyChange = jest.fn();
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <ExportScreen api={api} onBusyChange={onBusyChange} {...props} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, onBusyChange };
}

describe('Export CSV (Story 9.9)', () => {
  it('opens on Transactions and All time with every account, account numbers off, and one Export button', async () => {
    const m = await mount(fakeApi().api);
    expect(selected(m.r, 'export-kind-transactions')).toBe(true);
    expect(selected(m.r, 'export-period-all_time')).toBe(true);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['What to export', 'Transactions', 'Account summary', 'Period', 'This period', 'Last period', 'This year', 'All time', 'Custom range', 'Accounts', 'All accounts', 'Include account numbers (last 4 digits)', 'Export']));
    expect(m.r.root.findAll((n) => n.props.testID === 'export-numbers' && n.props.value === false).length).toBeGreaterThan(0);
  });

  it('Account summary defaults to This period', async () => {
    const m = await mount(fakeApi().api);
    await press(m.r, 'export-kind-accounts');
    expect(selected(m.r, 'export-period-this_period')).toBe(true);
    await press(m.r, 'export-kind-transactions');
    expect(selected(m.r, 'export-period-all_time')).toBe(true);
  });

  it('Export asks first that the file will not be encrypted; Cancel writes nothing', async () => {
    const f = fakeApi();
    const m = await mount(f.api);
    await press(m.r, 'export-button');
    expect(texts(m.r)).toEqual(expect.arrayContaining(["This file won't be encrypted. Anyone who opens it can read these entries."]));
    expect(f.run).not.toHaveBeenCalled();
    await press(m.r, 'export-confirm-cancel');
    expect(f.run).not.toHaveBeenCalled();
    expect(requireReauth).not.toHaveBeenCalled();
  });

  it('confirming asks the re-authentication guard, then exports with the choices made, and the toast says how many', async () => {
    const f = fakeApi();
    const m = await mount(f.api);
    await act(async () => m.r.root.findAll((n) => n.props.testID === 'export-numbers' && typeof n.props.onValueChange === 'function')[0]!.props.onValueChange(true));
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(requireReauth).toHaveBeenCalledTimes(1);
    expect(f.run).toHaveBeenCalledWith({ kind: 'transactions', choice: 'all_time', accountIds: null, includeNumbers: true }, expect.any(Object));
    expect(texts(m.r)).toContain('Exported 1,284 entries');
    expect(m.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('when the person does not pass the re-authentication nothing is written', async () => {
    (requireReauth as jest.Mock).mockResolvedValue(false);
    const f = fakeApi();
    const m = await mount(f.api);
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(f.run).not.toHaveBeenCalled();
    expect(has(m.r, 'export-screen')).toBe(true);
  });

  it('a custom range needs two dates in order, and passes them on when they are', async () => {
    const f = fakeApi();
    const m = await mount(f.api);
    await press(m.r, 'export-period-custom');
    await press(m.r, 'export-button');
    expect(texts(m.r)).toContain('Enter two dates like 2026-01-31, the first not after the second.');
    expect(has(m.r, 'export-confirm')).toBe(false);
    await type(m.r, 'export-from', '2026-03-01');
    await type(m.r, 'export-to', '2026-02-01');
    await press(m.r, 'export-button');
    expect(has(m.r, 'export-confirm')).toBe(false);
    await type(m.r, 'export-to', '2026-03-31');
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ choice: 'custom', custom: { start: '2026-03-01', end: '2026-03-31' } }), expect.any(Object));
  });

  it('accounts can be chosen one by one; none chosen is not allowed', async () => {
    const f = fakeApi();
    const m = await mount(f.api);
    await press(m.r, 'export-all-accounts');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Monzo Current', 'Amex', 'Old savings · Archived']));
    await press(m.r, 'export-button');
    expect(texts(m.r)).toContain('Choose at least one account.');
    await press(m.r, 'export-account-a2');
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['a2'] }), expect.any(Object));
  });

  it('shows the coin loader with the count while it writes, and Cancel asks it to stop; a cancelled export says nothing was saved', async () => {
    let seen!: ExportRunHooks;
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const f = fakeApi(async (_req, hooks) => {
      seen = hooks;
      hooks.onProgress(4000, 10000);
      await gate;
      return { kind: 'cancelled' };
    });
    const m = await mount(f.api);
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(has(m.r, 'long-task-loader')).toBe(true);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Exporting…', '4,000 of 10,000 entries']));
    expect(m.onBusyChange).toHaveBeenCalledWith(true);
    expect(seen.isCancelled()).toBe(false);
    await press(m.r, 'export-cancel');
    expect(seen.isCancelled()).toBe(true);
    release();
    await settle();
    expect(texts(m.r)).toContain('Export cancelled. Nothing was saved.');
    expect(has(m.r, 'export-screen')).toBe(true);
  });

  it('a failed save says so with Try again, which asks to confirm again; closing the save dialog is not a failure', async () => {
    const f = fakeApi({ kind: 'failed' });
    const m = await mount(f.api);
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(texts(m.r)).toContain("Couldn't save the file. Nothing on this phone changed.");
    await press(m.r, 'export-retry');
    expect(texts(m.r)).toContain("This file won't be encrypted. Anyone who opens it can read these entries.");
    const closed = await mount(fakeApi({ kind: 'dialog_cancelled' }).api);
    await press(closed.r, 'export-button');
    await press(closed.r, 'export-confirm');
    expect(has(closed.r, 'export-failed')).toBe(false);
    expect(texts(closed.r).some((t) => t.startsWith('Exported'))).toBe(false);
  });

  it('the account summary shows no entry count and says how many accounts it wrote', async () => {
    const f = fakeApi(async (_r, hooks) => {
      hooks.onProgress(6, 6);
      return { kind: 'saved', export: 'accounts', count: 6 };
    });
    const m = await mount(f.api, { initialKind: 'accounts' });
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(texts(m.r)).toContain('Exported 6 accounts');
  });

  it('opens on Transactions and All time when asked to, as from the currency explanation', async () => {
    const m = await mount(fakeApi().api, { initialKind: 'transactions', initialChoice: 'all_time' });
    expect(selected(m.r, 'export-period-all_time')).toBe(true);
  });

  it('leaving the screen while Confirm it is you is open writes nothing, and a second confirm does not start a second export (Epic 9 review)', async () => {
    let allow!: (ok: boolean) => void;
    (requireReauth as jest.Mock).mockImplementation(() => new Promise<boolean>((res) => (allow = res)));
    const f = fakeApi();
    const m = await mount(f.api);
    await press(m.r, 'export-button');
    const confirm = m.r.root.findAll((n) => n.props.testID === 'export-confirm' && typeof n.props.onPress === 'function')[0]!;
    await act(async () => {
      confirm.props.onPress();
      confirm.props.onPress();
    });
    expect(requireReauth).toHaveBeenCalledTimes(1);
    act(() => m.r.unmount());
    live.splice(live.indexOf(m.r), 1);
    await act(async () => allow(true));
    await settle();
    expect(f.run).not.toHaveBeenCalled();
  });

  it('Last period with no earlier period says so, not that two dates are needed', async () => {
    const f = fakeApi({ kind: 'invalid_period', code: 'NO_PERIOD' });
    const m = await mount(f.api);
    await press(m.r, 'export-period-last_period');
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(texts(m.r)).toContain('There is no earlier period to export yet.');
    expect(texts(m.r)).not.toContain('Enter two dates like 2026-01-31, the first not after the second.');
  });

  it('dates typed with a stray space are accepted and trimmed', async () => {
    const f = fakeApi();
    const m = await mount(f.api);
    await press(m.r, 'export-period-custom');
    await type(m.r, 'export-from', ' 2026-03-01 ');
    await type(m.r, 'export-to', '2026-03-31\n');
    await press(m.r, 'export-button');
    await press(m.r, 'export-confirm');
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ custom: { start: '2026-03-01', end: '2026-03-31' } }), expect.any(Object));
  });

  it('the account summary confirm says balances, not entries', async () => {
    const m = await mount(fakeApi().api, { initialKind: 'accounts' });
    await press(m.r, 'export-button');
    expect(texts(m.r)).toContain("This file won't be encrypted. Anyone who opens it can read these balances.");
  });

  it('the toast wording for one and many', () => {
    expect(exportedText('transactions', 1)).toBe('Exported 1 entry');
    expect(exportedText('transactions', 12345)).toBe('Exported 12,345 entries');
    expect(exportedText('accounts', 1)).toBe('Exported 1 account');
    expect(exportedText('accounts', 6)).toBe('Exported 6 accounts');
  });
});
