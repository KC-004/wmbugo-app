import { extractBackup, writeBackup, type BackupInput } from '@wmbugo/core';

// The native binding is replaced by libsodium's own WebAssembly build in tests; the adapter only forwards to it.
jest.mock('react-native-libsodium', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
  const s = require('libsodium-wrappers-sumo');
  return { __esModule: true, default: s };
});

import sodium from 'react-native-libsodium';
import { createRnCrypto } from './rnCrypto';

beforeAll(async () => {
  await (sodium as unknown as { ready: Promise<void> }).ready;
});

describe('rnCrypto (Story 8.6)', () => {
  it('forwards Argon2id and random bytes to libsodium, and the backup round-trips through the pure secretstream', async () => {
    const crypto = createRnCrypto();
    expect(crypto.randomBytes(16)).toHaveLength(16);
    const k1 = await crypto.argon2id(new Uint8Array([1, 2, 3]), new Uint8Array(16), 1, 8192, 32);
    const k2 = await crypto.argon2id(new Uint8Array([1, 2, 3]), new Uint8Array(16), 1, 8192, 32);
    expect(k1).toHaveLength(32);
    expect(k1).toEqual(k2);

    const db = crypto.randomBytes(150_000);
    const input: BackupInput = {
      passphrase: 'a long enough passphrase',
      schemaVersion: 1,
      appId: 'app.wmbugo',
      appVersion: '1.0',
      createdAt: { utcMs: 1, timezoneId: 'UTC' },
      counts: { entries: 0, accounts: 0, photos: 0 },
      accountBalances: [],
      archiveKey: new Uint8Array(32).fill(1),
      entries: [{ name: 'db', size: db.length, sha256: crypto.sha256(db), async *read() { yield db; } }],
      kdf: { opslimit: 1, memlimit: 8192 },
    };
    const parts: Uint8Array[] = [];
    expect((await writeBackup(crypto, input, { write: async (c) => void parts.push(new Uint8Array(c)) })).ok).toBe(true);
    const file = Buffer.concat(parts);
    const got: Uint8Array[] = [];
    const r = await extractBackup(crypto, { size: file.length, read: async (o, n) => file.subarray(o, o + n) }, 'a long enough passphrase', { appSchemaVersion: 1 }, async () => ({ write: async (c) => void got.push(new Uint8Array(c)) }));
    expect(r.ok).toBe(true);
    expect(Buffer.concat(got).equals(Buffer.from(db))).toBe(true);
  }, 60_000);
});
