import type { Crypto } from '../ports/crypto';
import { err, ok, type Result } from '../shared/result';
import {
  CHUNK_BYTES,
  DB_NAME,
  DEFAULT_KDF,
  FORMAT_VERSION,
  KEY_BYTES,
  KDF_LIMITS,
  MAGIC,
  MANIFEST_NAME,
  MAX_FILE_BYTES,
  MAX_MANIFEST_BYTES,
  SALT_BYTES,
  VERIFIER_BYTES,
  VERIFIER_CONTEXT,
  concat,
  isAllowedEntryName,
  passphraseBytes,
  toHex,
  u16,
  u32,
  u64,
  utf8Encode,
  type BackupManifest,
} from './format';

/** Where encrypted bytes go: an injected handle (the chosen document), never a path the module picks (Story 8.6). */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
}

/** One payload entry (the database or a photo): its name, exact size and SHA-256, and a way to read its bytes in order. */
export interface BackupEntrySource {
  readonly name: string;
  readonly size: number;
  readonly sha256: Uint8Array;
  read(): AsyncIterable<Uint8Array>;
}

export interface BackupInput {
  readonly passphrase: string;
  readonly schemaVersion: number;
  readonly appId: string;
  readonly appVersion: string;
  readonly createdAt: { readonly utcMs: number; readonly timezoneId: string };
  readonly counts: { readonly entries: number; readonly accounts: number; readonly photos: number };
  readonly accountBalances: readonly { readonly accountId: string; readonly balanceMinor: number }[];
  /** The random 256-bit key of the SQLCipher database in the `db` entry (32 bytes). It travels only inside the encrypted manifest. */
  readonly archiveKey: Uint8Array;
  /** `db` first, then the photos. */
  readonly entries: readonly BackupEntrySource[];
  /** Argon2id parameters; the production default is opslimit 3 and 64 MiB. Tests use small ones. */
  readonly kdf?: { readonly opslimit: number; readonly memlimit: number };
}

export type BackupWriteError = 'PASSPHRASE_EMPTY' | 'ENTRIES_INVALID' | 'ENTRY_MISMATCH' | 'WRITE_FAILED' | 'KDF_INVALID' | 'FILE_TOO_LARGE';

/** Splits the plaintext stream into 64 KiB chunks and encrypts each; the last one is tagged FINAL. */
class ChunkWriter {
  private pending: Uint8Array = new Uint8Array(0);
  bytesWritten = 0;
  constructor(
    private readonly sink: ByteSink,
    private readonly push: (message: Uint8Array, final: boolean) => Uint8Array,
  ) {}

  async write(data: Uint8Array): Promise<void> {
    this.pending = this.pending.length === 0 ? data : concat([this.pending, data]);
    // Keep at least one byte back, so the last chunk can be tagged FINAL on close.
    while (this.pending.length > CHUNK_BYTES) {
      const chunk = this.push(this.pending.subarray(0, CHUNK_BYTES), false);
      this.pending = this.pending.subarray(CHUNK_BYTES);
      this.bytesWritten += chunk.length;
      await this.sink.write(chunk);
    }
    // What is kept back must not alias the caller's buffer: a source that reuses its read buffer would change it before it is sent.
    if (this.pending.length > 0 && this.pending.buffer === data.buffer) this.pending = this.pending.slice();
  }

  async close(): Promise<void> {
    const chunk = this.push(this.pending, true);
    this.pending = new Uint8Array(0);
    this.bytesWritten += chunk.length;
    await this.sink.write(chunk);
  }
}

function entryHeader(name: string, size: number, sha256: Uint8Array): Uint8Array {
  const n = utf8Encode(name);
  return concat([u16(n.length), n, u64(size), sha256]);
}

/** SHA-256 over name, size and digest of every payload entry in order: the manifest's checksum over the whole payload. */
export function payloadChecksum(crypto: Crypto, entries: readonly { name: string; size: number; sha256: Uint8Array }[]): Uint8Array {
  return crypto.sha256(concat(entries.map((e) => entryHeader(e.name, e.size, e.sha256))));
}

/**
 * Writes an encrypted backup to `sink`. Only encrypted bytes reach the sink; the passphrase-derived key never leaves this
 * function. If anything fails the caller deletes the partial output (the file is not valid without its FINAL chunk).
 */
export async function writeBackup(crypto: Crypto, input: BackupInput, sink: ByteSink): Promise<Result<{ bytes: number }, BackupWriteError>> {
  if (input.passphrase.length === 0) return err('PASSPHRASE_EMPTY');
  const kdf = input.kdf ?? DEFAULT_KDF;
  if (kdf.opslimit < KDF_LIMITS.minOps || kdf.opslimit > KDF_LIMITS.maxOps || kdf.memlimit < KDF_LIMITS.minMem || kdf.memlimit > KDF_LIMITS.maxMem || kdf.memlimit % 1024 !== 0) return err('KDF_INVALID');
  if (input.archiveKey.length !== KEY_BYTES) return err('ENTRIES_INVALID');
  const names = new Set<string>();
  for (const [i, e] of input.entries.entries()) {
    if (!isAllowedEntryName(e.name) || e.name === MANIFEST_NAME || names.has(e.name) || e.sha256.length !== 32 || !Number.isSafeInteger(e.size) || e.size < 0) return err('ENTRIES_INVALID');
    if ((i === 0) !== (e.name === DB_NAME)) return err('ENTRIES_INVALID'); // the database is first, and there is exactly one
    names.add(e.name);
  }
  if (input.entries.length === 0) return err('ENTRIES_INVALID');
  // The count the manifest states is the number of photo entries: the reader checks it, so the writer must not produce otherwise.
  if (input.counts.photos !== input.entries.length - 1) return err('ENTRIES_INVALID');
  // A backup its own reader would refuse is not written: found now, not when the person needs it.
  const declaredBytes = input.entries.reduce((n, e) => n + e.size, 0);
  if (declaredBytes > MAX_FILE_BYTES) return err('FILE_TOO_LARGE');

  const manifest: BackupManifest = {
    formatVersion: FORMAT_VERSION,
    schemaVersion: input.schemaVersion,
    appId: input.appId,
    appVersion: input.appVersion,
    createdAt: input.createdAt,
    counts: input.counts,
    accountBalances: input.accountBalances,
    entries: input.entries.map((e) => ({ name: e.name, size: e.size, sha256: toHex(e.sha256) })),
    payloadChecksum: toHex(payloadChecksum(crypto, input.entries)),
    archiveKey: toHex(input.archiveKey),
  };
  const manifestBytes = utf8Encode(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) return err('FILE_TOO_LARGE');

  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await crypto.argon2id(passphraseBytes(input.passphrase), salt, kdf.opslimit, kdf.memlimit, KEY_BYTES);
  const verifier = crypto.sha256(concat([VERIFIER_CONTEXT, key])).subarray(0, VERIFIER_BYTES);
  const stream = crypto.secretStreamPush(key);
  const header = concat([utf8Encode(MAGIC), u32(FORMAT_VERSION), u32(kdf.opslimit), u32(kdf.memlimit), salt, verifier, stream.header]);

  try {
    await sink.write(header);
    const out = new ChunkWriter(sink, stream.push);
    await out.write(entryHeader(MANIFEST_NAME, manifestBytes.length, crypto.sha256(manifestBytes)));
    await out.write(manifestBytes);
    for (const e of input.entries) {
      await out.write(entryHeader(e.name, e.size, e.sha256));
      const hash = crypto.sha256Stream();
      let seen = 0;
      for await (const piece of e.read()) {
        seen += piece.length;
        if (seen > e.size) return err('ENTRY_MISMATCH');
        hash.update(piece);
        await out.write(piece);
      }
      // The declared size and digest are in the manifest; the bytes must match them exactly.
      if (seen !== e.size || toHex(hash.final()) !== toHex(e.sha256)) return err('ENTRY_MISMATCH');
    }
    await out.close();
    return ok({ bytes: header.length + out.bytesWritten });
  } catch {
    return err('WRITE_FAILED');
  }
}
