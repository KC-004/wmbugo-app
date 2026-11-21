import { memoryFiles, state } from '../../testing/memoryRnfs';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('@dr.pogodin/react-native-fs', () => require('../../testing/memoryRnfs').rnfsModule);
jest.mock('@op-engineering/op-sqlite', () => ({ ANDROID_DATABASE_PATH: '/data/databases' }));
jest.mock('../files/rnFileStore', () => ({ PRIVATE_DIR: '/data/files/private' }));
jest.mock('../files/receiptFiles', () => ({ RECEIPTS_DIR: '/data/files/receipts' }));
jest.mock('../storage/keychainKeyStore', () => ({ keychainKeyStore: { getKey: jest.fn(async () => 'b'.repeat(64)) } }));
jest.mock('../../../drizzle/migrations', () => ({ __esModule: true, default: { journal: { entries: [] }, migrations: {} } }));
const mockOpen = jest.fn();
jest.mock('../storage/opSqliteOpener', () => ({ createOpSqliteOpener: () => ({ open: (...a: unknown[]) => mockOpen(...a) }) }));
const mockPhoto = { write: jest.fn(), close: jest.fn(), abort: jest.fn() };
jest.mock('./backupFiles', () => ({ openEncryptedPhoto: jest.fn(async () => mockPhoto) }));
const mockRunMigrations = jest.fn();
jest.mock('@wmbugo/core', () => ({
  ...jest.requireActual('@wmbugo/core'),
  loadMigrations: jest.fn(() => ({ ok: true, value: {} })),
  runMigrations: (...a: unknown[]) => mockRunMigrations(...a),
}));

import type { SqlDatabase } from '@wmbugo/core';
import { createRnRestoreDb, restoredDatabaseOpens, RESTORE_LAYOUT, rnRestoreFs } from './rnRestore';

type Handler = (sql: string, params?: readonly unknown[]) => unknown[][];
function fakeDb(handler: Handler = () => []): SqlDatabase & { calls: { sql: string; params?: readonly unknown[] }[]; close: jest.Mock } {
  const calls: { sql: string; params?: readonly unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, params });
      return handler(sql, params);
    }),
    close: jest.fn(async () => undefined),
  } as never;
}

beforeEach(() => {
  memoryFiles.reset();
  mockOpen.mockReset();
  mockRunMigrations.mockReset();
});

describe('verify: what stands between a staged database and the swap', () => {
  const stagedWith = (over: { quick?: string; fk?: unknown[][]; profiles?: number }) =>
    fakeDb((sql) => {
      if (sql.startsWith('PRAGMA quick_check')) return [[over.quick ?? 'ok']];
      if (sql.startsWith('PRAGMA foreign_key_check')) return over.fk ?? [];
      if (sql.includes('FROM profile')) return [[over.profiles ?? 1]];
      return [];
    });

  it('passes with quick_check ok, no foreign key problems and exactly one profile', async () => {
    mockOpen.mockResolvedValue(stagedWith({}));
    const r = await createRnRestoreDb(null).verify();
    expect(r.quickCheckOk).toBe(true);
    expect(r.invariantsOk).toBe(true);
  });

  it('fails the invariants for zero profiles, two profiles and foreign key problems; and fails quick_check when it says anything but ok', async () => {
    for (const over of [{ profiles: 0 }, { profiles: 2 }, { fk: [['t', 1, 'p', 0]] }]) {
      mockOpen.mockResolvedValue(stagedWith(over));
      expect((await createRnRestoreDb(null).verify()).invariantsOk).toBe(false);
    }
    mockOpen.mockResolvedValue(stagedWith({ quick: '*** in database main ***' }));
    expect((await createRnRestoreDb(null).verify()).quickCheckOk).toBe(false);
  });
});

describe('carryDeviceSettings: this phone keeps its own app lock, Lock after and hide-in-recents', () => {
  it('writes each live device.% row into the staged database and removes every other staged device.% row', async () => {
    const live = fakeDb((sql) => (sql.includes("LIKE 'device.%'") ? [['device.app_lock_enabled', 'true', 2, 10], ['device.lock_after', '"1m"', 1, 11]] : []));
    const staged = fakeDb();
    mockOpen.mockResolvedValue(staged);
    await createRnRestoreDb(live).carryDeviceSettings();
    const inserts = staged.calls.filter((c) => c.sql.startsWith('INSERT INTO settings'));
    expect(inserts.map((c) => c.params?.[0])).toEqual(['device.app_lock_enabled', 'device.lock_after']);
    const del = staged.calls.find((c) => c.sql.startsWith("DELETE FROM settings WHERE key LIKE 'device.%'"))!;
    expect(del.sql).toContain('NOT IN (?,?)');
    expect(del.params).toEqual(['device.app_lock_enabled', 'device.lock_after']);
    expect(staged.close).toHaveBeenCalled();
  });

  it('with no device settings on this phone, every staged device.% row is removed (the empty set must not delete nothing)', async () => {
    const live = fakeDb(() => []);
    const staged = fakeDb();
    mockOpen.mockResolvedValue(staged);
    await createRnRestoreDb(live).carryDeviceSettings();
    const del = staged.calls.find((c) => c.sql.startsWith('DELETE FROM settings'))!;
    expect(del.sql).toContain("NOT IN ('')");
    expect(del.params).toEqual([]);
  });

  it('with no live database (safe mode, nothing readable) nothing is opened or changed', async () => {
    await createRnRestoreDb(null).carryDeviceSettings();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe('prepareForSwap and the start checks', () => {
  it('folds the log into the file, closes the live connection and removes the -wal and -shm files', async () => {
    memoryFiles.files.set(`${RESTORE_LAYOUT.dbPath}-wal`, 'w');
    memoryFiles.files.set(`${RESTORE_LAYOUT.dbPath}-shm`, 's');
    const live = fakeDb();
    await createRnRestoreDb(live).prepareForSwap!();
    expect(live.calls[0]!.sql).toBe('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(live.close).toHaveBeenCalled();
    expect(memoryFiles.files.has(`${RESTORE_LAYOUT.dbPath}-wal`)).toBe(false);
    expect(memoryFiles.files.has(`${RESTORE_LAYOUT.dbPath}-shm`)).toBe(false);
  });

  it('if the log cannot be folded in, nothing is closed and nothing is deleted: the swap does not go ahead', async () => {
    memoryFiles.files.set(`${RESTORE_LAYOUT.dbPath}-wal`, 'recent writes');
    const live = fakeDb(() => {
      throw new Error('database is locked');
    });
    await expect(createRnRestoreDb(live).prepareForSwap!()).rejects.toThrow('locked');
    expect(live.close).not.toHaveBeenCalled();
    expect(memoryFiles.files.get(`${RESTORE_LAYOUT.dbPath}-wal`)).toBe('recent writes');
  });

  it('restoredDatabaseOpens is false when the database file is missing (an empty new one must not pass), and true only for quick_check ok', async () => {
    mockOpen.mockResolvedValue(fakeDb(() => [['ok']]));
    expect(await restoredDatabaseOpens()).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
    memoryFiles.files.set(RESTORE_LAYOUT.dbPath, 'db');
    expect(await restoredDatabaseOpens()).toBe(true);
    mockOpen.mockResolvedValue(fakeDb(() => [['*** in database main ***']]));
    expect(await restoredDatabaseOpens()).toBe(false);
    mockOpen.mockRejectedValue(new Error('file is not a database'));
    expect(await restoredDatabaseOpens()).toBe(false);
  });
});

describe('migrateAndRekey', () => {
  it('maps a database newer than the app to BACKUP_TOO_NEW, anything else that fails to BACKUP_DAMAGED, and always closes and removes the raw file', async () => {
    memoryFiles.files.set(`${RESTORE_LAYOUT.stagingDir}/archive.db`, 'raw');
    const archive = fakeDb();
    mockOpen.mockResolvedValue(archive);
    mockRunMigrations.mockResolvedValue({ ok: false, code: 'DATABASE_NEWER_THAN_APP' });
    expect(await createRnRestoreDb(null).migrateAndRekey('a'.repeat(64))).toEqual({ ok: false, code: 'BACKUP_TOO_NEW' });
    expect(archive.close).toHaveBeenCalled();
    expect(memoryFiles.files.has(`${RESTORE_LAYOUT.stagingDir}/archive.db`)).toBe(false);
    mockRunMigrations.mockResolvedValue({ ok: false, code: 'MIGRATION_FAILED' });
    expect(await createRnRestoreDb(null).migrateAndRekey('a'.repeat(64))).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('re-keys with the device key bound as a parameter, never written into the SQL text', async () => {
    const archive = fakeDb();
    mockOpen.mockResolvedValue(archive);
    mockRunMigrations.mockResolvedValue({ ok: true, value: undefined });
    expect(await createRnRestoreDb(null).migrateAndRekey('a'.repeat(64))).toEqual({ ok: true, value: undefined });
    const attach = archive.calls.find((c) => c.sql.startsWith('ATTACH DATABASE'))!;
    expect(attach.sql).toBe('ATTACH DATABASE ? AS final KEY ?');
    expect(attach.params).toEqual([RESTORE_LAYOUT.stagingDb, 'b'.repeat(64)]);
    expect(archive.calls.map((c) => c.sql).join(' ')).not.toContain('b'.repeat(64));
    expect(archive.calls.some((c) => c.sql.startsWith('DETACH DATABASE final'))).toBe(true);
  });

  it('detaches even when the export throws', async () => {
    const archive = fakeDb((sql) => {
      if (sql.includes('sqlcipher_export')) throw new Error('disk full');
      return [];
    });
    mockOpen.mockResolvedValue(archive);
    mockRunMigrations.mockResolvedValue({ ok: true, value: undefined });
    expect((await createRnRestoreDb(null).migrateAndRekey('a'.repeat(64))).ok).toBe(false);
    expect(archive.calls.some((c) => c.sql.startsWith('DETACH DATABASE final'))).toBe(true);
  });
});

describe('the restore file system', () => {
  it('writeText writes beside the file and moves over it, leaving no temporary file', async () => {
    memoryFiles.files.set('/p/journal', 'old');
    await rnRestoreFs.writeText('/p/journal', 'new');
    expect(memoryFiles.files.get('/p/journal')).toBe('new');
    expect(memoryFiles.files.has('/p/journal.tmp')).toBe(false);
  });

  it('a kill between the unlink and the move leaves the complete .tmp that recovery reads', async () => {
    memoryFiles.files.set('/p/journal', 'old');
    state.failOn = { op: 'moveFile', path: '/p/journal.tmp' };
    await expect(rnRestoreFs.writeText('/p/journal', 'new')).rejects.toThrow();
    expect(memoryFiles.files.has('/p/journal')).toBe(false);
    expect(memoryFiles.files.get('/p/journal.tmp')).toBe('new');
  });

  it('remove of something absent is not an error, readText of a missing file is null, and freeBytes reads the file system', async () => {
    await expect(rnRestoreFs.remove('/nope')).resolves.toBeUndefined();
    expect(await rnRestoreFs.readText('/nope')).toBeNull();
    state.freeSpace = 1234;
    expect(await rnRestoreFs.freeBytes()).toBe(1234);
  });
});

describe('openEntry: photos are encrypted as they arrive and a failed read lets the handle go', () => {
  it('a photo entry writes through the encrypted handle and passes abort on', async () => {
    const t = await createRnRestoreDb(null).openEntry('attachments/0192a3b4-aaaa-7bbb-8ccc-000000000001', 3);
    await t.write(new Uint8Array([1, 2, 3]));
    await t.close?.();
    await t.abort?.();
    expect(mockPhoto.write).toHaveBeenCalledTimes(1);
    expect(mockPhoto.close).toHaveBeenCalledTimes(1);
    expect(mockPhoto.abort).toHaveBeenCalledTimes(1);
  });
});
