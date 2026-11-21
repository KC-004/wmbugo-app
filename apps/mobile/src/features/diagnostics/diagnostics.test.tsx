import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { buildDiagnosticsText, type DiagnosticsStatus } from '@wmbugo/core';
import { clearDiagnosticsRegistry, registerDiagnosticsSection, registerParser } from '../../shared/diagnosticsRegistry';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { DiagnosticsExportScreen, DiagnosticsScreen } from './DiagnosticsScreen';
import type { DiagnosticsApi } from './diagnosticsApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'UTC' } }));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  clearDiagnosticsRegistry();
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
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const disabled = (r: ReactTestRenderer, id: string) => Boolean(r.root.findAll((n) => n.props.testID === id && n.props.accessibilityState)[0]!.props.accessibilityState.disabled);

const STATUS: DiagnosticsStatus = {
  app: '1.0.0 (nosms)',
  schemaVersion: 26,
  storage: { dbBytes: 12.4 * 1024 * 1024, photoBytes: 38.1 * 1024 * 1024, logBytes: 0.6 * 1024 * 1024, freeBytes: 9.2 * 1024 ** 3 },
  notifications: 'allowed',
  biometrics: 'available',
  appLock: false,
  lastBackup: '3 Nov',
  crashes: { count: 1, lastDate: '7 Nov' },
  safeMode: 'Off',
};
const REPORT = buildDiagnosticsText({ status: STATUS, logLines: ['{"t":1,"level":"info","event":"startup.ready","fields":{"route":"home"}}'], crashes: [] });

function fakeApi(over: Partial<DiagnosticsApi> = {}): DiagnosticsApi {
  return { status: async () => STATUS, report: async () => REPORT, save: jest.fn(async () => 'saved' as const), ...over };
}

async function mount(node: React.ReactElement) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<ThemeProvider>{node}</ThemeProvider>);
  });
  live.push(r);
  await settle();
  return r;
}

describe('Diagnostics screen (Story 8.10)', () => {
  it('lists the status: version and flavor, schema, storage, permissions, app lock, last backup, crash records, safe mode', async () => {
    const r = await mount(<DiagnosticsScreen api={fakeApi()} onExport={jest.fn()} />);
    const all = texts(r);
    expect(all).toEqual(
      expect.arrayContaining([
        '1.0.0 (nosms)',
        '26',
        'Entries and settings 12.4 MB · Photos 38.1 MB · Log 0.6 MB · Free 9.2 GB',
        'Notifications: allowed · Biometrics: available',
        'Off',
        '3 Nov',
        '1 recorded, 7 Nov',
      ]),
    );
    expect(host(r, 'diag-Safe mode').props.accessibilityLabel).toBe('Safe mode: Off');
    expect(host(r, 'diag-Crash records').props.accessibilityLabel).toBe('Crash records: 1 recorded, 7 Nov');
  });

  it('works without the database: unreadable values say Not available', async () => {
    const unreadable: DiagnosticsStatus = { ...STATUS, schemaVersion: null, lastBackup: null, safeMode: null, crashes: null, storage: { dbBytes: null, photoBytes: null, logBytes: null, freeBytes: null }, appLock: null, notifications: null, biometrics: null, app: null };
    const r = await mount(<DiagnosticsScreen api={fakeApi({ status: async () => unreadable })} onExport={jest.fn()} />);
    expect(host(r, 'diag-Database schema').props.accessibilityLabel).toBe('Database schema: Not available');
    expect(host(r, 'diag-Last backup').props.accessibilityLabel).toBe('Last backup: Not available');
    expect(host(r, 'diag-Safe mode').props.accessibilityLabel).toBe('Safe mode: Not available');
  });

  it('the Check a parser section is absent when no parser is registered', async () => {
    const r = await mount(<DiagnosticsScreen api={fakeApi()} onExport={jest.fn()} />);
    expect(has(r, 'diag-parsers')).toBe(false);
    expect(texts(r)).not.toContain('Check a parser');
  });

  it('a registered parser appears and runs only on typed sample text, which is not kept anywhere else', async () => {
    const seen: string[] = [];
    registerParser({ id: 'upi', label: 'UPI payment', run: (s) => (seen.push(s), `parsed ${s.length} characters`) });
    const r = await mount(<DiagnosticsScreen api={fakeApi()} onExport={jest.fn()} />);
    expect(texts(r)).toContain('Check a parser');
    expect(texts(r)).toContain('UPI payment');
    act(() => host(r, 'parser-sample-upi').props.onChangeText('Paid 500 to a@b'));
    expect(seen).toEqual([]); // typing alone runs nothing
    await press(r, 'parser-run-upi');
    expect(seen).toEqual(['Paid 500 to a@b']);
    expect(texts(r)).toContain('parsed 15 characters');
  });

  it('a registered section (the Background capture slot) is shown with its title', async () => {
    registerDiagnosticsSection({ id: 'bg-capture', title: 'Background capture', render: () => <Text>OEM help</Text> });
    const r = await mount(<DiagnosticsScreen api={fakeApi()} onExport={jest.fn()} />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Background capture', 'OEM help']));
  });

  it('Export diagnostics asks to open the preview and does nothing else', async () => {
    const onExport = jest.fn();
    const api = fakeApi();
    const r = await mount(<DiagnosticsScreen api={api} onExport={onExport} />);
    await press(r, 'diagnostics-export');
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
  });
});

describe('Export preview and consent (Story 8.10)', () => {
  it('shows the full text that would be saved, in a scrollable monospace view', async () => {
    const r = await mount(<DiagnosticsExportScreen api={fakeApi()} />);
    const view = host(r, 'diagnostics-preview-text');
    expect(view.type).toBe('RCTScrollView');
    const monospace = r.root.findAll((n) => n.type === Text && JSON.stringify(n.props.style).includes('monospace'));
    expect(monospace.length).toBeGreaterThan(0);
    expect(texts(r)).toContain(REPORT);
    expect(REPORT).toContain('== Status ==');
    expect(REPORT).toContain('== Log (last 500 lines, redacted) ==');
    expect(REPORT).toContain('== Crash records (redacted) ==');
  });

  it('export cannot proceed without the tick: Save file is disabled, and pressing it saves nothing', async () => {
    const api = fakeApi();
    const r = await mount(<DiagnosticsExportScreen api={api} />);
    expect(disabled(r, 'diagnostics-save')).toBe(true);
    await press(r, 'diagnostics-save');
    expect(api.save).not.toHaveBeenCalled();
    const box = r.root.findAll((n) => n.props.testID === 'diagnostics-consent' && n.props.accessibilityRole === 'checkbox')[0]!;
    expect(box.props.accessibilityLabel).toBe("I've looked at this and I'm OK sharing it");
    await press(r, 'diagnostics-consent');
    expect(disabled(r, 'diagnostics-save')).toBe(false);
  });

  it('after consent Save file saves exactly the previewed text', async () => {
    const api = fakeApi();
    const r = await mount(<DiagnosticsExportScreen api={api} />);
    await press(r, 'diagnostics-consent');
    await press(r, 'diagnostics-save');
    expect(api.save).toHaveBeenCalledTimes(1);
    expect((api.save as jest.Mock).mock.calls[0]![0]).toBe(REPORT);
    expect(has(r, 'diagnostics-saved')).toBe(true);
  });

  it('cancelling the save dialog writes nothing and changes nothing; a failure says nothing was saved', async () => {
    const cancel = fakeApi({ save: jest.fn(async () => 'cancelled' as const) });
    const r = await mount(<DiagnosticsExportScreen api={cancel} />);
    await press(r, 'diagnostics-consent');
    await press(r, 'diagnostics-save');
    expect(has(r, 'diagnostics-saved')).toBe(false);
    expect(has(r, 'diagnostics-failed')).toBe(false);
    const fail = fakeApi({ save: jest.fn(async () => 'failed' as const) });
    const r2 = await mount(<DiagnosticsExportScreen api={fail} />);
    await press(r2, 'diagnostics-consent');
    await press(r2, 'diagnostics-save');
    expect(texts(r2)).toContain("Couldn't save the file. Nothing was saved.");
  });

  it('Save stays disabled while the report is still being read', async () => {
    const r = await mount(<DiagnosticsExportScreen api={fakeApi({ report: () => new Promise(() => undefined) })} />);
    await press(r, 'diagnostics-consent');
    expect(disabled(r, 'diagnostics-save')).toBe(true);
  });
});
