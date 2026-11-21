import * as fc from 'fast-check';
import sodium from 'libsodium-wrappers-sumo';
import type { Crypto } from '../ports/crypto';
import { createSodiumCrypto } from '../testing/sodiumCrypto';
import { DB_NAME } from './format';
import { extractBackup, type ByteSource } from './reader';
import { createPureCrypto, secretStreamPull, secretStreamPush } from './secretstream';
import { writeBackup, type ByteSink } from './writer';

let ref: Crypto;
let pure: Crypto;
beforeAll(async () => {
  ref = await createSodiumCrypto();
  pure = createPureCrypto({ randomBytes: ref.randomBytes, argon2id: ref.argon2id });
});

const rand = (n: number) => sodium.randombytes_buf(n);

describe('pure secretstream is libsodium-compatible (Story 8.6)', () => {
  it('libsodium decrypts what the pure implementation encrypts, and the reverse, for any chunks', async () => {
    await fc.assert(
      fc.property(fc.array(fc.uint8Array({ minLength: 0, maxLength: 300 }), { minLength: 1, maxLength: 8 }), (messages) => {
        const key = rand(32);
        // pure -> libsodium
        const p = secretStreamPush(key, rand);
        const lib = ref.secretStreamPull(key, p.header);
        messages.forEach((m, i) => {
          const final = i === messages.length - 1;
          const out = lib.pull(p.push(m, final));
          if (!out || out.final !== final || Buffer.compare(Buffer.from(out.message), Buffer.from(m)) !== 0) throw new Error('pure -> libsodium mismatch');
        });
        // libsodium -> pure
        const l = ref.secretStreamPush(key);
        const pp = secretStreamPull(key, l.header);
        messages.forEach((m, i) => {
          const final = i === messages.length - 1;
          const out = pp.pull(l.push(m, final));
          if (!out || out.final !== final || Buffer.compare(Buffer.from(out.message), Buffer.from(m)) !== 0) throw new Error('libsodium -> pure mismatch');
        });
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('round-trips 200 chunks of every small size through libsodium', () => {
    const key = rand(32);
    const p = secretStreamPush(key, rand);
    // libsodium with the same header: init_pull on our header gives matching decryption of each chunk; compare ciphertext by
    // encrypting with libsodium using a state forced to the same header is not exposed, so check the round trip over many chunks.
    const lib = ref.secretStreamPull(key, p.header);
    for (let i = 0; i < 200; i++) {
      const m = rand(i % 70);
      const c = p.push(m, i === 199);
      expect(c.length).toBe(m.length + 17);
      expect(lib.pull(c)?.message).toEqual(m);
    }
  });

  it('rejects a tampered chunk, a reordered chunk, a replayed chunk and a wrong key', () => {
    const key = rand(32);
    const p = secretStreamPush(key, rand);
    const c1 = p.push(rand(40), false);
    const c2 = p.push(rand(40), true);
    const flip = (c: Uint8Array, at: number) => {
      const x = new Uint8Array(c);
      x[at] = x[at]! ^ 1;
      return x;
    };
    for (const at of [0, 5, c1.length - 1]) expect(secretStreamPull(key, p.header).pull(flip(c1, at))).toBeNull();
    const reordered = secretStreamPull(key, p.header);
    expect(reordered.pull(c2)).toBeNull();
    const replay = secretStreamPull(key, p.header);
    expect(replay.pull(c1)).not.toBeNull();
    expect(replay.pull(c1)).toBeNull();
    expect(secretStreamPull(rand(32), p.header).pull(c1)).toBeNull();
    expect(secretStreamPull(key, p.header).pull(new Uint8Array(5))).toBeNull();
  });

  it('tags the last chunk FINAL and no earlier one', () => {
    const key = rand(32);
    const p = secretStreamPush(key, rand);
    const pull = secretStreamPull(key, p.header);
    expect(pull.pull(p.push(new Uint8Array(3), false))?.final).toBe(false);
    expect(pull.pull(p.push(new Uint8Array(0), true))?.final).toBe(true);
  });
});

describe('a backup written with one crypto opens with the other', () => {
  const sink = () => {
    const parts: Uint8Array[] = [];
    const s: ByteSink = { write: async (c) => void parts.push(new Uint8Array(c)) };
    return { s, bytes: () => Buffer.concat(parts) };
  };
  const input = (c: Crypto, db: Uint8Array) => ({
    passphrase: 'a long enough passphrase',
    schemaVersion: 3,
    appId: 'app.wmbugo',
    appVersion: '1.0',
    createdAt: { utcMs: 5, timezoneId: 'UTC' },
    counts: { entries: 0, accounts: 0, photos: 0 },
    accountBalances: [],
    archiveKey: new Uint8Array(32).fill(7),
    entries: [{ name: DB_NAME, size: db.length, sha256: c.sha256(db), async *read() { yield db; } }],
    kdf: { opslimit: 1, memlimit: 8192 },
  });
  const read = async (c: Crypto, bytes: Uint8Array) => {
    const got: Uint8Array[] = [];
    const src: ByteSource = { size: bytes.length, read: async (o, n) => bytes.subarray(o, o + n) };
    const r = await extractBackup(c, src, 'a long enough passphrase', { appSchemaVersion: 3 }, async () => ({ write: async (x) => void got.push(new Uint8Array(x)) }));
    return { ok: r.ok, data: Buffer.concat(got) };
  };

  it('pure writes, libsodium reads; libsodium writes, pure reads (across several chunks)', async () => {
    const db = rand(200_000);
    const a = sink();
    expect((await writeBackup(pure, input(pure, db), a.s)).ok).toBe(true);
    const fromPure = await read(ref, a.bytes());
    expect(fromPure.ok).toBe(true);
    expect(fromPure.data.equals(Buffer.from(db))).toBe(true);

    const b = sink();
    expect((await writeBackup(ref, input(ref, db), b.s)).ok).toBe(true);
    const fromRef = await read(pure, b.bytes());
    expect(fromRef.ok).toBe(true);
    expect(fromRef.data.equals(Buffer.from(db))).toBe(true);
  }, 60_000);
});
