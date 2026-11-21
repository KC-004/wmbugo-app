import { memoryFiles } from '../../testing/memoryRnfs';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
jest.mock('@dr.pogodin/react-native-fs', () => require('../../testing/memoryRnfs').rnfsModule);
jest.mock('../files/rnFileStore', () => ({ PRIVATE_DIR: '/data/files/private' }));
jest.mock('../files/receiptFiles', () => ({ filePath: (id: string) => `/data/files/receipts/${id}.enc` }));
jest.mock('../storage/keychainKeyStore', () => ({ keychainKeyStore: { getKey: jest.fn(async () => 'c'.repeat(64)) } }));
const mockStream = jest.fn();
jest.mock('./backupFiles', () => ({ createBackupDocument: jest.fn(), streamDecrypted: (...a: unknown[]) => mockStream(...a) }));

import type { Crypto, SqlDatabase } from '@wmbugo/core';
import { createRnBackupPlatform, STAGING_DIR, sweepStaging } from './rnBackupPlatform';

const crypto = {
  sha256Stream: () => ({ update: () => undefined, final: () => new Uint8Array(32) }),
} as unknown as Crypto;

function db(rows: unknown[][] = [], onQuery?: (sql: string) => void): SqlDatabase & { calls: { sql: string; params?: readonly unknown[] }[] } {
  const calls: { sql: string; params?: readonly unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, params });
      onQuery?.(sql);
      return sql.includes('attachment') ? rows : [];
    }),
  } as never;
}

async function* bytes(...parts: number[][]) {
  for (const p of parts) yield new Uint8Array(p);
}

beforeEach(() => {
  memoryFiles.reset();
  mockStream.mockReset();
});

describe('exportDatabase: the staged export is keyed with the archive key and never left behind', () => {
  it('binds the archive key as a parameter, detaches, and cleanup removes the file and its companions', async () => {
    const d = db();
    const p = createRnBackupPlatform(d, crypto);
    // The export "creates" the staged file.
    (d.query as jest.Mock).mockImplementation(async (sql: string, params?: readonly unknown[]) => {
      d.calls.push({ sql, params });
      if (sql.startsWith('ATTACH')) memoryFiles.files.set(params![0] as string, 'xx');
      return [];
    });
    const staged = await p.exportDatabase('a'.repeat(64));
    const attach = d.calls.find((c) => c.sql.startsWith('ATTACH'))!;
    expect(attach.sql).toBe('ATTACH DATABASE ? AS backup KEY ?');
    expect(attach.params![1]).toBe('a'.repeat(64));
    expect(d.calls.map((c) => c.sql).join(' ')).not.toContain('a'.repeat(64));
    expect(d.calls.some((c) => c.sql === 'DETACH DATABASE backup')).toBe(true);
    expect(staged.entry.name).toBe('db');
    const path = attach.params![0] as string;
    memoryFiles.files.set(`${path}-wal`, 'w');
    memoryFiles.files.set(`${path}-journal`, 'j');
    await staged.cleanup();
    expect(memoryFiles.files.has(path)).toBe(false);
    expect(memoryFiles.files.has(`${path}-wal`)).toBe(false);
    expect(memoryFiles.files.has(`${path}-journal`)).toBe(false);
  });

  it('a failing export still detaches and removes whatever it staged, then reports the failure', async () => {
    const d = db();
    (d.query as jest.Mock).mockImplementation(async (sql: string, params?: readonly unknown[]) => {
      d.calls.push({ sql, params });
      if (sql.startsWith('ATTACH')) memoryFiles.files.set(params![0] as string, 'partial');
      if (sql.includes('sqlcipher_export')) throw new Error('disk full');
      return [];
    });
    await expect(createRnBackupPlatform(d, crypto).exportDatabase('a'.repeat(64))).rejects.toThrow('disk full');
    expect(d.calls.some((c) => c.sql === 'DETACH DATABASE backup')).toBe(true);
    expect([...memoryFiles.files.keys()].filter((k) => k.startsWith(STAGING_DIR))).toEqual([]);
  });
});

describe('photos: one bad receipt does not stop every backup, and the person is told how many were left out', () => {
  const ids = ['0192a3b4-aaaa-7bbb-8ccc-000000000001', '0192a3b4-aaaa-7bbb-8ccc-000000000002', '0192a3b4-aaaa-7bbb-8ccc-000000000003'];
  const path = (id: string) => `/data/files/receipts/${id}.enc`;

  it('includes readable photos, skips a missing file and one that cannot be decrypted, and counts both', async () => {
    memoryFiles.files.set(path(ids[0]!), 'a');
    memoryFiles.files.set(path(ids[2]!), 'c'); // ids[1] has no file
    mockStream.mockImplementation((p: string) => {
      if (p === path(ids[2]!)) throw new Error('bad tag');
      return bytes([1, 2, 3]);
    });
    const p = createRnBackupPlatform(db(ids.map((i) => [i])), crypto);
    const out = await p.photos();
    expect(out.map((e) => e.name)).toEqual([`attachments/${ids[0]}`]);
    expect(out[0]!.size).toBe(3);
    expect(p.photosSkipped!()).toBe(2);
  });

  it('the skipped count starts again for each backup', async () => {
    const p = createRnBackupPlatform(db([[ids[0]!]]), crypto);
    await p.photos(); // no file: skipped
    expect(p.photosSkipped!()).toBe(1);
    memoryFiles.files.set(path(ids[0]!), 'a');
    mockStream.mockImplementation(() => bytes([9]));
    await p.photos();
    expect(p.photosSkipped!()).toBe(0);
  });

  it('stops between photos when cancelled', async () => {
    for (const i of ids) memoryFiles.files.set(path(i), 'x');
    mockStream.mockImplementation(() => bytes([1]));
    let calls = 0;
    const p = createRnBackupPlatform(db(ids.map((i) => [i])), crypto);
    await expect(p.photos(() => ++calls > 1)).rejects.toThrow('cancelled');
  });
});

describe('sweepStaging', () => {
  it('removes everything an interrupted backup or restore left in staging, and nothing outside it', async () => {
    memoryFiles.files.set(`${STAGING_DIR}/export-1.db`, 'x');
    memoryFiles.files.set(`${STAGING_DIR}/export-1.db-wal`, 'x');
    memoryFiles.files.set('/data/files/private/logs/wmbugo.log', 'keep');
    await sweepStaging();
    expect([...memoryFiles.files.keys()]).toEqual(['/data/files/private/logs/wmbugo.log']);
  });
});
