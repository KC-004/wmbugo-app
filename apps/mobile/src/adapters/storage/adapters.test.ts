const mockSetGenericPassword = jest.fn();
const mockGetGenericPassword = jest.fn();
jest.mock('react-native-keychain', () => ({
  setGenericPassword: (...a: unknown[]) => mockSetGenericPassword(...a),
  getGenericPassword: (...a: unknown[]) => mockGetGenericPassword(...a),
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock' },
}));

const calls: string[] = [];
const mockExecuteRaw = jest.fn();
const mockExecuteBatch = jest.fn();
const mockTransaction = jest.fn();
const mockOpen = jest.fn();
jest.mock('@op-engineering/op-sqlite', () => ({ open: (...a: unknown[]) => mockOpen(...a), ANDROID_DATABASE_PATH: '/data/databases' }));
jest.mock('../files/rnFileStore', () => ({
  PRIVATE_DIR: '/data/files',
  ensureDir: jest.fn(async (p: string) => {
    calls.push(`mkdir ${p}`);
  }),
  fileExists: jest.fn(async (p: string) => p === '/data/databases/wmbugo.db'),
  copyFile: jest.fn(async (a: string, b: string) => {
    calls.push(`copy ${a} -> ${b}`);
  }),
}));

import { keychainKeyStore } from './keychainKeyStore';
import { opSqliteOpener } from './opSqliteOpener';
import { secureRandom } from './secureRandom';

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
  mockOpen.mockReturnValue({
    executeRaw: (...a: unknown[]) => {
      calls.push(`raw ${String(a[0])}`);
      return mockExecuteRaw(...a);
    },
    executeSync: (...a: unknown[]) => {
      calls.push(`sync ${String(a[0])}`);
    },
    executeBatch: (...a: unknown[]) => mockExecuteBatch(...a),
    transaction: (...a: unknown[]) => mockTransaction(...a),
    getDbPath: () => '/data/databases/wmbugo.db',
    close: jest.fn(),
  });
  mockExecuteRaw.mockResolvedValue({ rawRows: [['4.19.0 community']] });
});

describe('keychainKeyStore', () => {
  it('stores the key hardware-wrapped, with no authentication or biometric binding', async () => {
    mockSetGenericPassword.mockResolvedValue({ service: 's', storage: 'x' });
    expect(await keychainKeyStore.setKey('ab'.repeat(32))).toBe(true);
    const [, , options] = mockSetGenericPassword.mock.calls[0]!;
    expect(options).toEqual({
      service: 'app.wmbugo.database-key',
      storage: 'KeystoreAESGCM_NoAuth',
      accessible: 'AccessibleAfterFirstUnlock',
    });
    expect(options).not.toHaveProperty('accessControl');
  });

  it('reports a refused save', async () => {
    mockSetGenericPassword.mockResolvedValue(false);
    expect(await keychainKeyStore.setKey('ab'.repeat(32))).toBe(false);
  });

  it('returns null when there is no key and the key when there is', async () => {
    mockGetGenericPassword.mockResolvedValueOnce(false);
    expect(await keychainKeyStore.getKey()).toBeNull();
    mockGetGenericPassword.mockResolvedValueOnce({ password: 'k'.repeat(64) });
    expect(await keychainKeyStore.getKey()).toBe('k'.repeat(64));
  });
});

describe('opSqliteOpener', () => {
  it('looks for the database file in the Android databases directory', async () => {
    expect(await opSqliteOpener.exists()).toBe(true);
  });

  it('turns foreign keys on for the connection', async () => {
    await opSqliteOpener.open('00'.repeat(32));
    expect(calls).toContain('sync PRAGMA foreign_keys = ON');
  });

  it('opens the database with the key', async () => {
    await opSqliteOpener.open('cd'.repeat(32));
    expect(mockOpen).toHaveBeenCalledWith({ name: 'wmbugo.db', encryptionKey: 'cd'.repeat(32) });
  });

  it('reads cipher_version and treats a non-string as missing', async () => {
    const db = await opSqliteOpener.open('00'.repeat(32));
    expect(await db.cipherVersion()).toBe('4.19.0 community');
    mockExecuteRaw.mockResolvedValueOnce({ rawRows: [] });
    expect(await db.cipherVersion()).toBeNull();
  });

  it('maps batches to [sql, params] tuples', async () => {
    const db = await opSqliteOpener.open('00'.repeat(32));
    await db.executeBatch([{ sql: 'A' }, { sql: 'B ?', params: [1] }]);
    expect(mockExecuteBatch).toHaveBeenCalledWith([['A', []], ['B ?', [1]]]);
  });

  it('transaction runs fn inside the op-sqlite transaction, returns its value and keeps column order', async () => {
    const txExecute = jest.fn(async (sql: string) => (sql.startsWith('SELECT') ? { rows: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] } : { rows: [] }));
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({ execute: txExecute }));
    const db = await opSqliteOpener.open('00'.repeat(32));
    const out = await db.transaction(async (tx) => {
      await tx.execute('INSERT INTO t (a) VALUES (?)', [5]);
      return tx.query('SELECT id, v FROM t');
    });
    expect(out).toEqual([['a', 1], ['b', 2]]);
    expect(txExecute).toHaveBeenCalledWith('INSERT INTO t (a) VALUES (?)', [5]);
  });

  it('transaction rethrows so op-sqlite rolls back', async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({ execute: jest.fn() }));
    const db = await opSqliteOpener.open('00'.repeat(32));
    await expect(db.transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('safety copy checkpoints the log first, then copies the encrypted file to private storage', async () => {
    const db = await opSqliteOpener.open('00'.repeat(32));
    calls.length = 0;
    await db.safetyCopy('before-v2');
    expect(calls).toEqual([
      'raw PRAGMA wal_checkpoint(TRUNCATE)',
      'mkdir /data/files/safety',
      'copy /data/databases/wmbugo.db -> /data/files/safety/wmbugo.db.before-v2',
    ]);
  });
});

describe('secureRandom', () => {
  afterEach(() => {
    delete (globalThis as { crypto?: unknown }).crypto;
  });

  it('uses crypto.getRandomValues and returns the requested length', () => {
    (globalThis as { crypto?: unknown }).crypto = {
      getRandomValues: (a: Uint8Array) => a.fill(7),
    };
    expect(Array.from(secureRandom.bytes(4))).toEqual([7, 7, 7, 7]);
  });

  it('has no weak fallback: throws without a secure source', () => {
    delete (globalThis as { crypto?: unknown }).crypto;
    expect(() => secureRandom.bytes(32)).toThrow('no secure random source');
  });
});
