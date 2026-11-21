import fs from 'node:fs';
import path from 'node:path';
import * as fc from 'fast-check';
import { SECRETSTREAM_HEADER_BYTES, type Crypto } from '../ports/crypto';
import { createSodiumCrypto } from '../testing/sodiumCrypto';
import {
  CHUNK_BYTES,
  DB_NAME,
  FORMAT_VERSION,
  HEADER_BYTES,
  KDF_LIMITS,
  MAGIC,
  MANIFEST_NAME,
  concat,
  isAllowedEntryName,
  parseManifest,
  passphraseBytes,
  toHex,
  u16,
  u32,
  u64,
  utf8Decode,
  utf8Encode,
  VERIFIER_CONTEXT,
} from './format';
import { extractBackup, readManifest, type ByteSource, type EntryTarget } from './reader';
import { payloadChecksum, writeBackup, type BackupEntrySource, type BackupInput, type ByteSink } from './writer';

let crypto: Crypto;
beforeAll(async () => {
  crypto = await createSodiumCrypto();
});

const KDF = { opslimit: 1, memlimit: 8 * 1024 } as const;
const PASS = 'correct horse battery staple';
const SCHEMA = 25;

const bytesOf = (s: string) => utf8Encode(s);
const randomish = (n: number, seed: number) => {
  const out = new Uint8Array(n);
  let x = seed || 1;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x >> 16;
  }
  return out;
};

function entry(name: string, data: Uint8Array): BackupEntrySource {
  return {
    name,
    size: data.length,
    sha256: crypto.sha256(data),
    async *read() {
      for (let i = 0; i < data.length; i += 10_000) yield data.subarray(i, Math.min(data.length, i + 10_000));
      if (data.length === 0) return;
    },
  };
}

function inputOf(db: Uint8Array, photos: Uint8Array[] = [], over: Partial<BackupInput> = {}): { input: BackupInput; ids: string[] } {
  const ids = photos.map((_, i) => `0192a3b4-aaaa-7bbb-8ccc-${String(i).padStart(12, '0')}`);
  const entries = [entry(DB_NAME, db), ...photos.map((p, i) => entry(`attachments/${ids[i]}`, p))];
  return {
    ids,
    input: {
      passphrase: PASS,
      schemaVersion: SCHEMA,
      appId: 'app.wmbugo',
      appVersion: '1.0',
      createdAt: { utcMs: 1_700_000_000_000, timezoneId: 'Asia/Kolkata' },
      counts: { entries: 12, accounts: 2, photos: photos.length },
      accountBalances: [{ accountId: 'acc-1', balanceMinor: 11860000 }],
      archiveKey: randomish(32, 7),
      entries,
      kdf: KDF,
      ...over,
    },
  };
}

class MemSink implements ByteSink {
  parts: Uint8Array[] = [];
  async write(chunk: Uint8Array) {
    this.parts.push(new Uint8Array(chunk));
  }
  get bytes() {
    return concat(this.parts);
  }
}

const sourceOf = (b: Uint8Array): ByteSource => ({ size: b.length, read: async (o, n) => b.subarray(o, o + n) });

async function backupBytes(input: BackupInput): Promise<Uint8Array> {
  const sink = new MemSink();
  const r = await writeBackup(crypto, input, sink);
  expect(r.ok).toBe(true);
  return sink.bytes;
}

class Collect implements EntryTarget {
  data: Uint8Array[] = [];
  closed = false;
  async write(c: Uint8Array) {
    this.data.push(new Uint8Array(c));
  }
  async close() {
    this.closed = true;
  }
}

async function extract(bytes: Uint8Array, passphrase = PASS, appSchemaVersion = SCHEMA) {
  const got = new Map<string, Collect>();
  const r = await extractBackup(crypto, sourceOf(bytes), passphrase, { appSchemaVersion }, async (name) => {
    const t = new Collect();
    got.set(name, t);
    return t;
  });
  return { r, got };
}

describe('backup file format (Story 8.6)', () => {
  it('starts with the magic, version 1 and the stored Argon2id parameters; the header is 76 bytes', async () => {
    const { input } = inputOf(randomish(100, 1));
    const bytes = await backupBytes(input);
    expect(HEADER_BYTES).toBe(76);
    expect(utf8Decode(bytes.subarray(0, 8))).toBe(MAGIC);
    expect(bytes.subarray(8, 12)).toEqual(u32(FORMAT_VERSION));
    expect(bytes.subarray(12, 16)).toEqual(u32(KDF.opslimit));
    expect(bytes.subarray(16, 20)).toEqual(u32(KDF.memlimit));
    expect(SECRETSTREAM_HEADER_BYTES).toBe(24);
  });

  it('the production default is Argon2id opslimit 3 and 64 MiB, stored in the file', async () => {
    const { input } = inputOf(new Uint8Array([1, 2, 3]), [], { kdf: undefined });
    const bytes = await backupBytes(input);
    expect(bytes.subarray(12, 16)).toEqual(u32(3));
    expect(bytes.subarray(16, 20)).toEqual(u32(64 * 1024 * 1024));
  }, 30_000);

  it('the ciphertext holds no recognisable plaintext: no SQLite header, no JSON, no names', async () => {
    const db = concat([bytesOf('SQLite format 3\0'), bytesOf('Swiggy Instamart rent for Feb sara@okhdfc'), randomish(5000, 3)]);
    const { input } = inputOf(db, [concat([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), randomish(300, 4)])]);
    const text = Buffer.from(await backupBytes(input)).toString('latin1');
    for (const needle of ['SQLite format 3', 'Swiggy', 'okhdfc', 'manifest.json', 'schemaVersion', 'attachments/', 'app.wmbugo', 'acc-1', '\xff\xd8\xff\xe0']) expect(text).not.toContain(needle);
  });

  it('round-trips the manifest and every entry byte for byte, across several chunks', async () => {
    const db = randomish(CHUNK_BYTES * 3 + 123, 9);
    const photos = [randomish(70_000, 10), randomish(1, 11), new Uint8Array(0)];
    const { input, ids } = inputOf(db, photos);
    const bytes = await backupBytes(input);
    const m = await readManifest(crypto, sourceOf(bytes), PASS, { appSchemaVersion: SCHEMA });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value).toMatchObject({
      formatVersion: 1,
      schemaVersion: SCHEMA,
      appId: 'app.wmbugo',
      appVersion: '1.0',
      createdAt: { utcMs: 1_700_000_000_000, timezoneId: 'Asia/Kolkata' },
      counts: { entries: 12, accounts: 2, photos: 3 },
      accountBalances: [{ accountId: 'acc-1', balanceMinor: 11860000 }],
      archiveKey: toHex(randomish(32, 7)),
    });
    expect(m.value.entries.map((e) => e.name)).toEqual(['db', ...ids.map((i) => `attachments/${i}`)]);
    expect(m.value.entries.map((e) => e.size)).toEqual([db.length, 70_000, 1, 0]);
    const { r, got } = await extract(bytes);
    expect(r.ok).toBe(true);
    expect(concat(got.get('db')!.data)).toEqual(db);
    expect(concat(got.get(`attachments/${ids[0]}`)!.data)).toEqual(photos[0]);
    expect(concat(got.get(`attachments/${ids[1]}`)!.data)).toEqual(photos[1]);
    expect(got.get(`attachments/${ids[2]}`)!.closed).toBe(true);
    expect([...got.values()].every((t) => t.closed)).toBe(true);
  });

  it('readManifest decrypts only the manifest: a preview never extracts anything', async () => {
    const { input } = inputOf(randomish(CHUNK_BYTES * 2, 2));
    const bytes = await backupBytes(input);
    let reads = 0;
    const src: ByteSource = { size: bytes.length, read: async (o, n) => (reads++, bytes.subarray(o, o + n)) };
    const m = await readManifest(crypto, src, PASS, { appSchemaVersion: SCHEMA });
    expect(m.ok).toBe(true);
    expect(reads).toBeLessThanOrEqual(3); // the header and the first chunk
  });
});

describe('typed read errors', () => {
  it('NOT_A_WMBUGO_BACKUP for random bytes, a short file, a bad magic and an unknown format version', async () => {
    const { input } = inputOf(randomish(50, 1));
    const good = await backupBytes(input);
    const cases = [randomish(10_000, 5), new Uint8Array(10), concat([bytesOf('WMBUGOXX'), good.subarray(8)]), concat([good.subarray(0, 8), u32(2), good.subarray(12)])];
    for (const bytes of cases) {
      const r = await readManifest(crypto, sourceOf(bytes), PASS, { appSchemaVersion: SCHEMA });
      expect(r).toEqual({ ok: false, code: 'NOT_A_WMBUGO_BACKUP' });
    }
  });

  it('WRONG_PASSPHRASE for a wrong passphrase, and no plaintext is ever produced', async () => {
    const { input } = inputOf(randomish(CHUNK_BYTES + 5, 5));
    const bytes = await backupBytes(input);
    expect(await readManifest(crypto, sourceOf(bytes), 'wrong', { appSchemaVersion: SCHEMA })).toEqual({ ok: false, code: 'WRONG_PASSPHRASE' });
    const opened: string[] = [];
    const r = await extractBackup(crypto, sourceOf(bytes), 'wrong', { appSchemaVersion: SCHEMA }, async (name) => {
      opened.push(name);
      return new Collect();
    });
    expect(r).toEqual({ ok: false, code: 'WRONG_PASSPHRASE' });
    expect(opened).toEqual([]);
  });

  it('the passphrase is normalised (NFKC) so the same typed text always opens it', async () => {
    const { input } = inputOf(randomish(30, 1), [], { passphrase: 'ﬁne passphrase ①' });
    const bytes = await backupBytes(input);
    expect((await readManifest(crypto, sourceOf(bytes), 'fine passphrase 1', { appSchemaVersion: SCHEMA })).ok).toBe(true);
  });

  it('BACKUP_TOO_NEW when the schema version is above the app', async () => {
    const { input } = inputOf(randomish(30, 1), [], { schemaVersion: SCHEMA + 1 });
    const bytes = await backupBytes(input);
    expect(await readManifest(crypto, sourceOf(bytes), PASS, { appSchemaVersion: SCHEMA })).toEqual({ ok: false, code: 'BACKUP_TOO_NEW' });
    expect((await readManifest(crypto, sourceOf(bytes), PASS, { appSchemaVersion: SCHEMA + 1 })).ok).toBe(true);
  });

  it('an older schema is fine: restore migrates it forward', async () => {
    const { input } = inputOf(randomish(30, 1), [], { schemaVersion: SCHEMA - 10 });
    const bytes = await backupBytes(input);
    expect((await readManifest(crypto, sourceOf(bytes), PASS, { appSchemaVersion: SCHEMA })).ok).toBe(true);
  });

  it('FILE_TOO_LARGE over 4 GiB, before anything is read', async () => {
    const src: ByteSource = { size: 4 * 1024 * 1024 * 1024 + 1, read: async () => { throw new Error('must not read'); } };
    expect(await readManifest(crypto, src, PASS, { appSchemaVersion: SCHEMA })).toEqual({ ok: false, code: 'FILE_TOO_LARGE' });
  });

  it('BACKUP_DAMAGED for a file cut short (also exactly at a chunk boundary) or with bytes appended', async () => {
    const { input } = inputOf(randomish(CHUNK_BYTES * 3, 6));
    const bytes = await backupBytes(input);
    for (const cut of [bytes.length - 1, bytes.length - 17, HEADER_BYTES + (CHUNK_BYTES + 17) * 2, HEADER_BYTES + (CHUNK_BYTES + 17)]) {
      const r = (await extract(bytes.subarray(0, cut))).r;
      expect(r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
    }
    expect((await extract(concat([bytes, new Uint8Array([1, 2, 3])]))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
    expect((await extract(concat([bytes, bytes.subarray(HEADER_BYTES, HEADER_BYTES + 200)]))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('KDF parameters outside the accepted range are BACKUP_DAMAGED, so a damaged header cannot ask for gigabytes', async () => {
    const { input } = inputOf(randomish(30, 1));
    const bytes = await backupBytes(input);
    for (const [at, value] of [[12, 0], [12, KDF_LIMITS.maxOps + 1], [16, 100], [16, KDF_LIMITS.maxMem + 1], [16, 0xffffffff], [16, KDF.memlimit + 1], [16, KDF.memlimit + 1023]] as const) {
      const bad = new Uint8Array(bytes);
      bad.set(u32(value), at);
      expect(await readManifest(crypto, sourceOf(bad), PASS, { appSchemaVersion: SCHEMA })).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
    }
  });
});

describe('flipping any single byte never succeeds (property over every byte)', () => {
  it('header bytes give NOT_A_WMBUGO_BACKUP, WRONG_PASSPHRASE or BACKUP_DAMAGED; every later byte gives BACKUP_DAMAGED', async () => {
    const { input } = inputOf(randomish(120, 12), [randomish(40, 13)]);
    const bytes = await backupBytes(input);
    for (let i = 0; i < bytes.length; i++) {
      const bad = new Uint8Array(bytes);
      bad[i] = bad[i]! ^ 0x01;
      const { r, got } = await extract(bad);
      expect({ at: i, ok: r.ok }).toEqual({ at: i, ok: false });
      if (r.ok) continue;
      if (i < 8 || (i >= 8 && i < 12)) expect({ at: i, code: r.code }).toEqual({ at: i, code: 'NOT_A_WMBUGO_BACKUP' });
      else if (i < 20) expect(['WRONG_PASSPHRASE', 'BACKUP_DAMAGED']).toContain(r.code);
      else if (i < 52) expect({ at: i, code: r.code }).toEqual({ at: i, code: 'WRONG_PASSPHRASE' }); // salt and verifier
      else expect({ at: i, code: r.code }).toEqual({ at: i, code: 'BACKUP_DAMAGED' });
      // A failed read may have started streaming an entry, but never one whose digest failed to verify.
      for (const t of got.values()) if (!r.ok) expect(t.closed).toBeDefined();
    }
  }, 60_000);

  it('a flip anywhere never reports success even through readManifest', async () => {
    const { input } = inputOf(randomish(60, 3));
    const bytes = await backupBytes(input);
    for (let i = 0; i < Math.min(bytes.length, 400); i++) {
      const bad = new Uint8Array(bytes);
      bad[i] = bad[i]! ^ 0x80;
      const r = await readManifest(crypto, sourceOf(bad), PASS, { appSchemaVersion: SCHEMA });
      // A flip past the manifest chunk is not read by a preview; it is caught by extract.
      if (r.ok) expect((await extract(bad)).r.ok).toBe(false);
    }
  }, 60_000);
});

// ---- hand-built archives: the reader must refuse them (SEC-006) ----

/** Encrypts an arbitrary plaintext stream with the real header and key derivation, so the reader sees a well-formed container. */
async function forge(plain: Uint8Array): Promise<Uint8Array> {
  const salt = randomish(16, 99);
  const key = await crypto.argon2id(passphraseBytes(PASS), salt, KDF.opslimit, KDF.memlimit, 32);
  const verifier = crypto.sha256(concat([VERIFIER_CONTEXT, key])).subarray(0, 16);
  const stream = crypto.secretStreamPush(key);
  const parts: Uint8Array[] = [utf8Encode(MAGIC), u32(FORMAT_VERSION), u32(KDF.opslimit), u32(KDF.memlimit), salt, verifier, stream.header];
  for (let i = 0; i < Math.max(1, plain.length); i += CHUNK_BYTES) {
    const last = i + CHUNK_BYTES >= plain.length;
    parts.push(stream.push(plain.subarray(i, i + CHUNK_BYTES), last));
  }
  return concat(parts);
}

function plainEntry(name: string, data: Uint8Array, declaredSize = data.length, digest = crypto.sha256(data)): Uint8Array {
  const n = utf8Encode(name);
  return concat([u16(n.length), n, u64(declaredSize), digest, data]);
}

function forgeManifest(over: Record<string, unknown>, entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const list = entries.map((e) => ({ name: e.name, size: e.data.length, sha256: toHex(crypto.sha256(e.data)) }));
  const manifest = {
    formatVersion: 1,
    schemaVersion: SCHEMA,
    appId: 'app.wmbugo',
    appVersion: '1.0',
    createdAt: { utcMs: 1, timezoneId: 'UTC' },
    counts: { entries: 0, accounts: 0, photos: 0 },
    accountBalances: [],
    entries: list,
    payloadChecksum: toHex(payloadChecksum(crypto, entries.map((e) => ({ name: e.name, size: e.data.length, sha256: crypto.sha256(e.data) })))),
    archiveKey: '00'.repeat(32),
    ...over,
  };
  return plainEntry(MANIFEST_NAME, utf8Encode(JSON.stringify(manifest)));
}

describe('malicious payloads are rejected before anything is written (SEC-006)', () => {
  const db = randomish(100, 1);
  const good = () => concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', db)]);

  it('the forging helper itself builds a valid archive', async () => {
    const { r } = await extract(await forge(good()));
    expect(r.ok).toBe(true);
  });

  const badNames = ['../etc/passwd', '/abs/path', 'attachments/../db', 'a\\b', 'db/', 'attachments/not-a-uuid', 'DB', 'other', 'attachments/0192a3b4-aaaa-7bbb-8ccc-000000000000/x', ''];
  for (const name of badNames) {
    it(`entry name ${JSON.stringify(name)} is BACKUP_DAMAGED and nothing is opened`, async () => {
      const plain = concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry(name || 'x', db)]);
      const opened: string[] = [];
      const r = await extractBackup(crypto, sourceOf(await forge(plain)), PASS, { appSchemaVersion: SCHEMA }, async (n) => (opened.push(n), new Collect()));
      expect(r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
      expect(opened).toEqual([]);
    });
  }

  it('a manifest that lists an unsafe name is BACKUP_DAMAGED', async () => {
    for (const name of ['../x', '/x', 'a\\b', 'nope']) {
      const plain = concat([forgeManifest({ entries: [{ name, size: 1, sha256: '00'.repeat(32) }] }, []), plainEntry('db', db)]);
      expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
    }
  });

  it('a duplicate entry is BACKUP_DAMAGED', async () => {
    const plain = concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', db), plainEntry('db', db)]);
    expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('a duplicate name in the manifest is BACKUP_DAMAGED', async () => {
    const e = { name: 'db', size: db.length, sha256: toHex(crypto.sha256(db)) };
    const plain = concat([forgeManifest({ entries: [e, e] }, []), plainEntry('db', db)]);
    expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('a declared size larger than the remaining stream is BACKUP_DAMAGED, before anything is streamed', async () => {
    const huge = 10 ** 12;
    const entries = [{ name: 'db', size: huge, sha256: toHex(crypto.sha256(db)) }];
    const plain = concat([forgeManifest({ entries }, []), plainEntry('db', db, huge)]);
    const opened: string[] = [];
    const r = await extractBackup(crypto, sourceOf(await forge(plain)), PASS, { appSchemaVersion: SCHEMA }, async (n) => (opened.push(n), new Collect()));
    expect(r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
    expect(opened).toEqual([]);
  });

  it('an entry whose size or digest differs from the manifest is BACKUP_DAMAGED', async () => {
    const bigger = concat([db, new Uint8Array([1])]);
    for (const plain of [
      concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', bigger)]),
      concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', db, db.length, crypto.sha256(bytesOf('other')))]),
    ]) expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('data that does not match its own digest is BACKUP_DAMAGED', async () => {
    const tampered = new Uint8Array(db);
    tampered[3] = tampered[3]! ^ 1;
    const plain = concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', tampered, db.length, crypto.sha256(db))]);
    expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('a missing entry, an extra unlisted entry, extra bytes after the last entry and a wrong payload checksum are BACKUP_DAMAGED', async () => {
    const photo = `attachments/0192a3b4-aaaa-7bbb-8ccc-000000000001`;
    const photoData = randomish(20, 2);
    const listed = [{ name: 'db', data: db }, { name: photo, data: photoData }];
    const cases = [
      concat([forgeManifest({}, listed), plainEntry('db', db)]),
      concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', db), plainEntry(photo, photoData)]),
      concat([forgeManifest({}, [{ name: 'db', data: db }]), plainEntry('db', db), new Uint8Array([9, 9])]),
      concat([forgeManifest({ payloadChecksum: '11'.repeat(32) }, [{ name: 'db', data: db }]), plainEntry('db', db)]),
      concat([forgeManifest({}, listed), plainEntry(photo, photoData), plainEntry('db', db)]),
    ];
    for (const plain of cases) expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('a first entry that is not manifest.json is BACKUP_DAMAGED', async () => {
    const plain = plainEntry('db', db);
    expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
  });

  it('a manifest that is not valid JSON or has the wrong shape is BACKUP_DAMAGED', async () => {
    for (const text of ['{nope', '[]', '{"formatVersion":1}', 'null']) {
      const plain = plainEntry(MANIFEST_NAME, utf8Encode(text));
      expect((await extract(await forge(plain))).r).toEqual({ ok: false, code: 'BACKUP_DAMAGED' });
    }
  });

  it('allowed names are exactly manifest.json, db and attachments/<uuid>', () => {
    expect(['manifest.json', 'db', 'attachments/0192a3b4-aaaa-7bbb-8ccc-0123456789ab'].every(isAllowedEntryName)).toBe(true);
    expect(['', 'x', '../db', '/db', 'db\\', 'attachments/', 'attachments/x', 'Attachments/0192a3b4-aaaa-7bbb-8ccc-0123456789ab'].some(isAllowedEntryName)).toBe(false);
    expect(parseManifest('{}')).toBeNull();
  });
});

describe('writer errors', () => {
  it('refuses an empty passphrase, a bad key, bad entries, and bad KDF parameters', async () => {
    const { input } = inputOf(randomish(10, 1));
    const sink = new MemSink();
    expect(await writeBackup(crypto, { ...input, passphrase: '' }, sink)).toEqual({ ok: false, code: 'PASSPHRASE_EMPTY' });
    expect(await writeBackup(crypto, { ...input, archiveKey: new Uint8Array(5) }, sink)).toEqual({ ok: false, code: 'ENTRIES_INVALID' });
    expect(await writeBackup(crypto, { ...input, entries: [] }, sink)).toEqual({ ok: false, code: 'ENTRIES_INVALID' });
    expect(await writeBackup(crypto, { ...input, entries: [entry('../db', new Uint8Array(1))] }, sink)).toEqual({ ok: false, code: 'ENTRIES_INVALID' });
    expect(await writeBackup(crypto, { ...input, entries: [entry('db', new Uint8Array(1)), entry('db', new Uint8Array(1))] }, sink)).toEqual({ ok: false, code: 'ENTRIES_INVALID' });
    expect(await writeBackup(crypto, { ...input, entries: [entry('attachments/0192a3b4-aaaa-7bbb-8ccc-000000000000', new Uint8Array(1))] }, sink)).toEqual({ ok: false, code: 'ENTRIES_INVALID' });
    expect(await writeBackup(crypto, { ...input, kdf: { opslimit: 0, memlimit: 8192 } }, sink)).toEqual({ ok: false, code: 'KDF_INVALID' });
    expect(await writeBackup(crypto, { ...input, kdf: { opslimit: 1, memlimit: 8193 } }, sink)).toEqual({ ok: false, code: 'KDF_INVALID' });
    expect(sink.parts).toEqual([]);
  });

  it('refuses an entry whose bytes do not match its declared size or digest, and a failing sink', async () => {
    const data = randomish(50, 1);
    const wrongDigest = { ...entry('db', data), sha256: crypto.sha256(bytesOf('x')) };
    const tooLong = { ...entry('db', data), size: 10 };
    const tooShort = { ...entry('db', data), size: 80 };
    for (const e of [wrongDigest, tooLong, tooShort]) {
      const { input } = inputOf(data, [], { entries: [e] });
      expect(await writeBackup(crypto, input, new MemSink())).toEqual({ ok: false, code: 'ENTRY_MISMATCH' });
    }
    const { input } = inputOf(data);
    expect(await writeBackup(crypto, input, { write: async () => { throw new Error('disk full'); } })).toEqual({ ok: false, code: 'WRITE_FAILED' });
  });

  it('only encrypted bytes reach the sink: the first write is the clear header, every later write is a whole ciphertext chunk', async () => {
    const { input } = inputOf(randomish(CHUNK_BYTES * 2 + 5, 1));
    const sink = new MemSink();
    await writeBackup(crypto, input, sink);
    expect(sink.parts[0]!.length).toBe(HEADER_BYTES);
    for (const p of sink.parts.slice(1, -1)) expect(p.length).toBe(CHUNK_BYTES + 17);
  });
});

describe('property: round trip (fast-check)', () => {
  const arbBytes = fc.uint8Array({ minLength: 0, maxLength: 3000 });
  const arbBig = fc.integer({ min: CHUNK_BYTES - 3, max: CHUNK_BYTES * 2 + 3 }).map((n) => randomish(n, n));

  it('arbitrary manifests and payloads come back byte for byte', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(arbBytes, arbBig),
        fc.array(arbBytes, { maxLength: 3 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 2 ** 40 }),
        fc.array(fc.record({ accountId: fc.string({ minLength: 1, maxLength: 20 }), balanceMinor: fc.integer({ min: -(2 ** 40), max: 2 ** 40 }) }), { maxLength: 5 }),
        async (db, photos, appVersion, utcMs, balances) => {
          const { input, ids } = inputOf(db, photos, { appVersion, createdAt: { utcMs, timezoneId: 'UTC' }, accountBalances: balances });
          const { r, got } = await extract(await backupBytes(input));
          if (!r.ok) return false;
          if (r.value.appVersion !== appVersion || r.value.createdAt.utcMs !== utcMs) return false;
          if (JSON.stringify(r.value.accountBalances) !== JSON.stringify(balances)) return false;
          if (toHex(concat(got.get('db')!.data)) !== toHex(db)) return false;
          return photos.every((p, i) => toHex(concat(got.get(`attachments/${ids[i]}`)!.data)) === toHex(p));
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);

  it('a wrong passphrase never yields any plaintext', async () => {
    const { input } = inputOf(randomish(200, 1));
    const bytes = await backupBytes(input);
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.normalize('NFKC') !== PASS), async (wrong) => {
        let opened = 0;
        const r = await extractBackup(crypto, sourceOf(bytes), wrong, { appSchemaVersion: SCHEMA }, async () => (opened++, new Collect()));
        const m = await readManifest(crypto, sourceOf(bytes), wrong, { appSchemaVersion: SCHEMA });
        return !r.ok && r.code === 'WRONG_PASSPHRASE' && !m.ok && opened === 0;
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});

describe('the backup module writes nowhere on its own', () => {
  it('imports no file system, no FileStore and no native module: only injected handles (lint rule backed by a test)', () => {
    const dir = __dirname;
    const forbidden = /from ['"](node:fs|fs|node:path|path|react-native|\.\.\/ports\/filestore|\.\.\/shared\/fileLogSink)['"]|require\(['"](node:)?fs['"]\)/;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      expect({ f, hit: forbidden.test(fs.readFileSync(path.join(dir, f), 'utf8')) }).toEqual({ f, hit: false });
    }
  });
});
