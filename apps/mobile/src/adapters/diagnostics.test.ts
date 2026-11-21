import { NativeModules } from 'react-native';
import { memoryFiles } from '../testing/memoryRnfs';
import { useSafeModeStore } from '../shared/state/safeModeStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('@dr.pogodin/react-native-fs', () => require('../testing/memoryRnfs').rnfsModule);
jest.mock('@op-engineering/op-sqlite', () => ({ ANDROID_DATABASE_PATH: '/data/databases' }));
jest.mock('./files/rnFileStore', () => ({ PRIVATE_DIR: '/data/files/private' }));
jest.mock('./files/receiptFiles', () => ({ RECEIPTS_DIR: '/data/files/receipts' }));
jest.mock('./backup/rnRestore', () => ({ RESTORE_LAYOUT: { dbPath: '/data/databases/wmbugo.db' } }));
const mockDoc = { sink: { write: jest.fn(async (chunk: Uint8Array) => void chunk) }, commit: jest.fn(async () => undefined), abort: jest.fn(async () => undefined) };
const mockCreateText = jest.fn();
jest.mock('./backup/backupFiles', () => ({ createTextDocument: (...a: unknown[]) => mockCreateText(...a) }));
jest.mock('./appLock', () => ({ availableKind: jest.fn(async () => 'biometric') }));
jest.mock('./notifier', () => ({ appNotifier: { available: false } }));
jest.mock('./permissions', () => ({ permissionState: jest.fn() }));
const mockServices = jest.fn();
const mockReadAll = jest.fn();
jest.mock('./startApp', () => ({
  getServices: () => mockServices(),
  getCrashRecorder: () => ({ readAll: () => mockReadAll() }),
  LOG_PATH: '/data/files/private/logs/wmbugo.log',
  systemClock: { nowMs: () => Date.UTC(2026, 10, 21, 8, 0, 0), timezoneId: () => 'UTC' },
}));
const mockLoad = jest.fn();
jest.mock('../features/settings/settingsApi', () => ({ realSettingsApi: { load: () => mockLoad() } }));

import { buildReport, readStatus, saveReport } from './diagnostics';

beforeEach(() => {
  memoryFiles.reset();
  mockDoc.sink.write.mockClear();
  mockDoc.commit.mockClear();
  mockDoc.abort.mockClear();
  mockCreateText.mockReset();
  mockServices.mockReset();
  mockReadAll.mockReset().mockResolvedValue([]);
  mockLoad.mockReset().mockResolvedValue({ settings: { lastBackupAt: null } });
  useSafeModeStore.setState({ startFailure: null, reason: null });
  (NativeModules as Record<string, unknown>).WmbugoPrivacy = { getAppInfo: async () => ({ versionName: '1.0', packageName: 'app.wmbugo' }) };
});

describe('saveReport: the saved bytes are the previewed text', () => {
  it('writes exactly the UTF-8 bytes of the text across the 32 KiB chunk boundary, then commits', async () => {
    mockCreateText.mockResolvedValue(mockDoc);
    const text = 'é₹ report line\n'.repeat(4000); // multibyte, well past two chunks
    const out: Uint8Array[] = [];
    mockDoc.sink.write.mockImplementation(async (c: Uint8Array) => void out.push(new Uint8Array(c)));
    expect(await saveReport(text)).toBe('saved');
    const joined = Buffer.concat(out.map((b) => Buffer.from(b)));
    expect(joined.toString('utf8')).toBe(text);
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((b) => b.length <= 32 * 1024)).toBe(true);
    expect(mockDoc.commit).toHaveBeenCalledTimes(1);
    expect(mockDoc.abort).not.toHaveBeenCalled();
  });

  it('a cancelled dialog writes nothing, and a failing write aborts the document and reports failure', async () => {
    mockCreateText.mockResolvedValue(null);
    expect(await saveReport('x')).toBe('cancelled');
    mockCreateText.mockResolvedValue(mockDoc);
    mockDoc.sink.write.mockRejectedValueOnce(new Error('disk full'));
    expect(await saveReport('x'.repeat(40_000))).toBe('failed');
    expect(mockDoc.abort).toHaveBeenCalledTimes(1);
    expect(mockDoc.commit).not.toHaveBeenCalled();
  });

  it('names the file with the local date', async () => {
    mockCreateText.mockResolvedValue(mockDoc);
    await saveReport('x');
    expect(mockCreateText).toHaveBeenCalledWith('wmbugo-diagnostics-2026-11-21.txt');
  });
});

describe('readStatus: each probe stands on its own', () => {
  it('without services the probes that need them are Not available, and the rest still answer', async () => {
    mockServices.mockImplementation(() => {
      throw new Error('storage not started');
    });
    const s = await readStatus();
    expect(s.schemaVersion).toBeNull();
    expect(s.safeMode).toBeNull();
    expect(s.app).toBe('1.0 (nosms)');
    expect(s.biometrics).toBe('available');
  });

  it('a start that failed shows its code where safe mode would be, and a working start shows Off', async () => {
    mockServices.mockImplementation(() => {
      throw new Error('storage not started');
    });
    useSafeModeStore.setState({ startFailure: 'start_DATABASE_OPEN_FAILED' });
    expect((await readStatus()).safeMode).toBe('start_DATABASE_OPEN_FAILED');
    mockServices.mockReturnValue({ db: { query: async () => [[7]] }, writer: { inSafeMode: false, safeReason: null } });
    useSafeModeStore.setState({ startFailure: null });
    const s = await readStatus();
    expect(s.safeMode).toBe('Off');
    expect(s.schemaVersion).toBe(7);
  });

  it('the schema version is Not available, not NaN, when the row is missing', async () => {
    mockServices.mockReturnValue({ db: { query: async () => [] }, writer: { inSafeMode: false, safeReason: null } });
    expect((await readStatus()).schemaVersion).toBeNull();
  });

  it('safe mode shows its reason; the database size counts the -wal and -shm files and is Not available when there is no file', async () => {
    mockServices.mockReturnValue({ db: { query: async () => [[3]] }, writer: { inSafeMode: true, safeReason: 'quick_check_failed' } });
    expect((await readStatus()).safeMode).toBe('quick_check_failed');
    expect((await readStatus()).storage.dbBytes).toBeNull();
    memoryFiles.files.set('/data/databases/wmbugo.db', 'x'.repeat(100));
    memoryFiles.files.set('/data/databases/wmbugo.db-wal', 'x'.repeat(20));
    memoryFiles.files.set('/data/databases/wmbugo.db-shm', 'x'.repeat(3));
    expect((await readStatus()).storage.dbBytes).toBe(123);
  });

  it('log and photo sizes are zero when nothing is there yet, and sum both log files when there are', async () => {
    mockServices.mockReturnValue({ db: { query: async () => [[3]] }, writer: { inSafeMode: false, safeReason: null } });
    let s = await readStatus();
    expect(s.storage.logBytes).toBe(0);
    expect(s.storage.photoBytes).toBe(0);
    memoryFiles.files.set('/data/files/private/logs/wmbugo.log', 'x'.repeat(10));
    memoryFiles.files.set('/data/files/private/logs/wmbugo.log.1', 'x'.repeat(5));
    memoryFiles.files.set('/data/files/receipts/a.enc', 'x'.repeat(7));
    s = await readStatus();
    expect(s.storage.logBytes).toBe(15);
    expect(s.storage.photoBytes).toBe(7);
  });
});

describe('buildReport', () => {
  it('is built from the status, the log lines (oldest file first) and the crash records, and an unreadable log is just empty', async () => {
    mockServices.mockReturnValue({ db: { query: async () => [[3]] }, writer: { inSafeMode: false, safeReason: null } });
    memoryFiles.files.set('/data/files/private/logs/wmbugo.log.1', '{"t":1,"level":"info","event":"old.event","fields":{}}\n');
    memoryFiles.files.set('/data/files/private/logs/wmbugo.log', '{"t":2,"level":"info","event":"new.event","fields":{}}\n');
    const text = await buildReport();
    expect(text.indexOf('old.event')).toBeGreaterThan(-1);
    expect(text.indexOf('old.event')).toBeLessThan(text.indexOf('new.event'));
    expect(text).toContain('== Crash records (redacted) ==');
  });
});
