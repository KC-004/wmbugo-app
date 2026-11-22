import { memoryFiles } from '../../testing/memoryRnfs';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('@dr.pogodin/react-native-fs', () => require('../../testing/memoryRnfs').rnfsModule);
jest.mock('@op-engineering/op-sqlite', () => ({ ANDROID_DATABASE_PATH: '/data/databases' }));
jest.mock('../files/rnFileStore', () => ({ PRIVATE_DIR: '/data/files/private' }));
jest.mock('../files/receiptFiles', () => ({ RECEIPTS_DIR: '/data/files/receipts' }));
jest.mock('../storage/keychainKeyStore', () => ({ deleteDatabaseKey: jest.fn(async () => undefined), keychainKeyStore: { getKey: jest.fn() } }));
jest.mock('../../../drizzle/migrations', () => ({ __esModule: true, default: { journal: { entries: [] }, migrations: {} } }));
const mockNotifier: { available: boolean; cancelAll?: jest.Mock } = { available: true, cancelAll: jest.fn(async () => undefined) };
jest.mock('../notifier', () => ({
  get appNotifier() {
    return mockNotifier;
  },
}));

import { RESTORE_LAYOUT } from './rnRestore';
import { ERASE_LAYOUT, eraseDeps, interruptedEraseDeps, rnEraseFs } from './rnErase';

beforeEach(() => {
  memoryFiles.reset();
  mockNotifier.available = true;
  mockNotifier.cancelAll = jest.fn(async () => undefined);
});

describe('ERASE_LAYOUT lists everything wmbugo keeps in private storage', () => {
  it('covers the database, photos, staging, the safety copy, the journal, logs and crash records, and the marker', () => {
    expect(ERASE_LAYOUT.dbPath).toBe(RESTORE_LAYOUT.dbPath);
    expect(ERASE_LAYOUT.attachmentsDir).toBe('/data/files/receipts');
    expect(ERASE_LAYOUT.stagingDir).toBe(RESTORE_LAYOUT.stagingDir);
    expect(ERASE_LAYOUT.safetyDir).toBe(RESTORE_LAYOUT.safetyDir);
    expect(ERASE_LAYOUT.journalPath).toBe(RESTORE_LAYOUT.journalPath);
    expect(ERASE_LAYOUT.logsDir).toBe('/data/files/private/logs');
    expect(ERASE_LAYOUT.crashesDir).toBe('/data/files/private/crashes');
    expect(ERASE_LAYOUT.markerPath).toBe('/data/files/private/erase.marker');
    expect(ERASE_LAYOUT.otherPaths).toEqual(expect.arrayContaining(['/data/files/private/restore-notice.txt', '/data/files/private/safety', '/data/files/private/imports']));
  });

  it('lists no path twice, and nothing outside the app\'s own directories', () => {
    const all = [ERASE_LAYOUT.dbPath, ERASE_LAYOUT.attachmentsDir, ERASE_LAYOUT.stagingDir, ERASE_LAYOUT.safetyDir, ERASE_LAYOUT.journalPath, ERASE_LAYOUT.logsDir, ERASE_LAYOUT.crashesDir, ...ERASE_LAYOUT.otherPaths];
    expect(new Set(all).size).toBe(all.length);
    for (const p of all) expect(p.startsWith('/data/')).toBe(true);
  });
});

describe('the erase file system and notifications', () => {
  it('remove of something that is not there is not an error (an erase may run twice), and writeText writes the marker', async () => {
    await expect(rnEraseFs.remove('/data/files/private/nope')).resolves.toBeUndefined();
    await rnEraseFs.writeText('/data/files/private/erase.marker', 'erase');
    expect(await rnEraseFs.exists('/data/files/private/erase.marker')).toBe(true);
    await rnEraseFs.remove('/data/files/private/erase.marker');
    expect(await rnEraseFs.exists('/data/files/private/erase.marker')).toBe(false);
  });

  it('cancels every notification when the notifier can; when the notifier is not available there is nothing to cancel', async () => {
    await interruptedEraseDeps().cancelNotifications();
    expect(mockNotifier.cancelAll).toHaveBeenCalledTimes(1);
    mockNotifier.available = false;
    mockNotifier.cancelAll = undefined;
    await expect(interruptedEraseDeps().cancelNotifications()).resolves.toBeUndefined();
  });

  it('an available notifier that cannot cancel fails the erase instead of leaving reminders that fire against deleted data', async () => {
    mockNotifier.cancelAll = undefined;
    await expect(interruptedEraseDeps().cancelNotifications()).rejects.toThrow('cannot cancel');
  });

  it('the live database is closed through the deps, and a start that finds the marker has no database to close', async () => {
    const close = jest.fn(async () => undefined);
    await eraseDeps({ close } as never, { enter: () => undefined, exit: () => undefined }).closeDatabase();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(interruptedEraseDeps().closeDatabase()).resolves.toBeUndefined();
  });
});
