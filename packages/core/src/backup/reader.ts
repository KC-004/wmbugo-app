import { SECRETSTREAM_ABYTES, SECRETSTREAM_HEADER_BYTES, type Crypto, type SecretStreamPull } from '../ports/crypto';
import { err, ok, type Result } from '../shared/result';
import type { ByteSink } from './writer';
import { payloadChecksum } from './writer';
import {
  FORMAT_VERSION,
  FRAME_BYTES,
  HEADER_BYTES,
  KDF_LIMITS,
  KEY_BYTES,
  MAGIC,
  MANIFEST_NAME,
  MAX_FILE_BYTES,
  MAX_MANIFEST_BYTES,
  SALT_BYTES,
  VERIFIER_BYTES,
  VERIFIER_CONTEXT,
  concat,
  equalBytes,
  fromHex,
  isAllowedEntryName,
  parseManifest,
  passphraseBytes,
  readU32,
  readU64,
  toHex,
  utf8Decode,
  utf8Encode,
  type BackupManifest,
  type BackupReadError,
} from './format';

/** A readable backup file: random access by offset, so a document or a file can sit behind it. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Where one decrypted entry goes while it is extracted (staging). `close` is called once the entry is complete and verified. */
export interface EntryTarget extends ByteSink {
  close?(): Promise<void>;
}

export interface OpenOptions {
  /** The newest schema version this app understands; a backup above it is refused (`BACKUP_TOO_NEW`). */
  readonly appSchemaVersion: number;
}

const BAD: BackupReadError = 'BACKUP_DAMAGED';

/** Reads the decrypted stream sequentially, one authenticated chunk at a time. */
class PlainReader {
  private buf: Uint8Array = new Uint8Array(0);
  private offset = HEADER_BYTES;
  private finished = false;
  /** Ciphertext bytes consumed so far. */
  constructor(
    private readonly source: ByteSource,
    private readonly pull: SecretStreamPull,
  ) {}

  get consumedCipherBytes(): number {
    return this.offset;
  }

  /** Bytes the file can still hold at most (ciphertext left, minus the tag of each chunk). A declared size above it is a lie. */
  get remainingUpperBound(): number {
    const left = this.source.size - this.offset;
    return this.buf.length + Math.max(0, left - Math.ceil(left / FRAME_BYTES) * SECRETSTREAM_ABYTES);
  }

  private async nextChunk(): Promise<boolean> {
    if (this.finished) return false;
    const left = this.source.size - this.offset;
    if (left <= SECRETSTREAM_ABYTES - 1) throw new Error(BAD); // the stream ended without its FINAL chunk
    const last = left <= FRAME_BYTES;
    const frame = await this.source.read(this.offset, last ? left : FRAME_BYTES);
    if (frame.length !== (last ? left : FRAME_BYTES)) throw new Error(BAD);
    const r = this.pull.pull(frame);
    if (r === null) throw new Error(BAD);
    if (r.final !== last) throw new Error(BAD); // FINAL anywhere but on the last chunk, or no FINAL at the end
    this.offset += frame.length;
    this.buf = this.buf.length === 0 ? r.message : concat([this.buf, r.message]);
    if (last) this.finished = true;
    return true;
  }

  /** Exactly `n` bytes, or throws when the stream ends first. */
  async take(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) if (!(await this.nextChunk())) throw new Error(BAD);
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** True when no plaintext is left. */
  async atEnd(): Promise<boolean> {
    if (this.buf.length > 0) return false;
    if (this.finished) return true;
    while (this.buf.length === 0 && !this.finished) await this.nextChunk();
    return this.buf.length === 0;
  }
}

interface Opened {
  readonly reader: PlainReader;
  readonly manifest: BackupManifest;
}

interface EntryHeader {
  readonly name: string;
  readonly size: number;
  readonly sha256: Uint8Array;
}

async function openStream(crypto: Crypto, source: ByteSource, passphrase: string, options: OpenOptions): Promise<Result<Opened, BackupReadError>> {
  if (source.size > MAX_FILE_BYTES) return err('FILE_TOO_LARGE');
  if (source.size < HEADER_BYTES) return err('NOT_A_WMBUGO_BACKUP');
  const head = await source.read(0, HEADER_BYTES);
  if (head.length !== HEADER_BYTES) return err('NOT_A_WMBUGO_BACKUP');
  if (!equalBytes(head.subarray(0, 8), utf8Encode(MAGIC))) return err('NOT_A_WMBUGO_BACKUP');
  if (readU32(head, 8) !== FORMAT_VERSION) return err('NOT_A_WMBUGO_BACKUP');
  const ops = readU32(head, 12);
  const mem = readU32(head, 16);
  if (ops < KDF_LIMITS.minOps || ops > KDF_LIMITS.maxOps || mem < KDF_LIMITS.minMem || mem > KDF_LIMITS.maxMem || mem % 1024 !== 0) return err(BAD);
  const salt = head.subarray(20, 20 + SALT_BYTES);
  const verifier = head.subarray(20 + SALT_BYTES, 20 + SALT_BYTES + VERIFIER_BYTES);
  const streamHeader = head.subarray(HEADER_BYTES - SECRETSTREAM_HEADER_BYTES);
  const key = await crypto.argon2id(passphraseBytes(passphrase), salt, ops, mem, KEY_BYTES);
  const expected = crypto.sha256(concat([VERIFIER_CONTEXT, key])).subarray(0, VERIFIER_BYTES);
  if (!equalBytes(expected, verifier)) return err('WRONG_PASSPHRASE');
  const reader = new PlainReader(source, crypto.secretStreamPull(key, streamHeader));
  try {
    const first = await readHeaderAndData(reader, true);
    if (first.header.name !== MANIFEST_NAME || first.header.size > MAX_MANIFEST_BYTES) return err(BAD);
    if (!equalBytes(crypto.sha256(first.data!), first.header.sha256)) return err(BAD);
    const text = utf8Decode(first.data!);
    const manifest = text === null ? null : parseManifest(text);
    if (!manifest || manifest.formatVersion !== FORMAT_VERSION) return err(BAD);
    if (manifest.schemaVersion > options.appSchemaVersion) return err('BACKUP_TOO_NEW');
    return ok({ reader, manifest });
  } catch {
    return err(BAD);
  }
}

/** Reads one entry header and, when `data` is true, its whole body (only the manifest is read this way). */
async function readHeaderAndData(r: PlainReader, data: boolean): Promise<{ header: EntryHeader; data: Uint8Array | null }> {
  const lenBytes = await r.take(2);
  const nameLen = (lenBytes[0]! << 8) | lenBytes[1]!;
  if (nameLen === 0 || nameLen > 256) throw new Error(BAD);
  const nameText = utf8Decode(await r.take(nameLen));
  if (nameText === null || !isAllowedEntryName(nameText)) throw new Error(BAD);
  const size = readU64(await r.take(8), 0);
  if (!Number.isSafeInteger(size)) throw new Error(BAD);
  const sha256 = await r.take(32);
  const header = { name: nameText, size, sha256: new Uint8Array(sha256) };
  if (!data) return { header, data: null };
  if (size > MAX_MANIFEST_BYTES || size > r.remainingUpperBound) throw new Error(BAD);
  return { header, data: new Uint8Array(await r.take(size)) };
}

/**
 * Opens a backup and returns its manifest, decrypting only the manifest: a preview never extracts the rest (Story 8.6).
 * Typed errors, no plaintext on a wrong passphrase.
 */
export async function readManifest(crypto: Crypto, source: ByteSource, passphrase: string, options: OpenOptions): Promise<Result<BackupManifest, BackupReadError>> {
  const opened = await openStream(crypto, source, passphrase, options);
  return opened.ok ? ok(opened.value.manifest) : opened;
}

/**
 * Verifies the whole payload and hands each entry to `open(name)` as it is decrypted (into staging, never outside what the caller
 * injects). Every entry is checked against the manifest: allowed name, no duplicate, declared size, SHA-256; the stream must end
 * exactly after the last manifest entry, and the payload checksum must match. Any failure is `BACKUP_DAMAGED`; the caller discards staging.
 */
export async function extractBackup(
  crypto: Crypto,
  source: ByteSource,
  passphrase: string,
  options: OpenOptions,
  open: (name: string, size: number) => Promise<EntryTarget>,
): Promise<Result<BackupManifest, BackupReadError>> {
  const opened = await openStream(crypto, source, passphrase, options);
  if (!opened.ok) return opened;
  const { reader, manifest } = opened.value;
  try {
    const declared = new Map(manifest.entries.map((e) => [e.name, e]));
    const seen = new Set<string>();
    const order: { name: string; size: number; sha256: Uint8Array }[] = [];
    let total = 0;
    const declaredTotal = manifest.entries.reduce((n, e) => n + e.size, 0);
    while (!(await reader.atEnd())) {
      const { header } = await readHeaderAndData(reader, false);
      const want = declared.get(header.name);
      if (!want || seen.has(header.name)) return err(BAD); // not in the manifest, or a duplicate
      if (header.size !== want.size || toHex(header.sha256) !== want.sha256) return err(BAD);
      if (header.size > reader.remainingUpperBound) return err(BAD); // a declared size larger than what is left
      total += header.size;
      if (total > declaredTotal) return err(BAD);
      seen.add(header.name);
      const target = await open(header.name, header.size);
      const hash = crypto.sha256Stream();
      let left = header.size;
      while (left > 0) {
        const piece = await reader.take(Math.min(left, 64 * 1024));
        hash.update(piece);
        await target.write(piece);
        left -= piece.length;
      }
      if (toHex(hash.final()) !== want.sha256) return err(BAD);
      await target.close?.();
      order.push({ name: header.name, size: header.size, sha256: fromHex(want.sha256)! });
    }
    if (seen.size !== declared.size) return err(BAD); // an entry the manifest lists is missing
    const sorted = manifest.entries.map((e) => ({ name: e.name, size: e.size, sha256: fromHex(e.sha256)! }));
    if (order.some((o, i) => o.name !== sorted[i]!.name)) return err(BAD); // entries out of manifest order
    if (toHex(payloadChecksum(crypto, order)) !== manifest.payloadChecksum) return err(BAD);
    return ok(manifest);
  } catch {
    return err(BAD);
  }
}

/**
 * Looks only at a file's header (Story 8.9): is it a wmbugo backup at all? Nothing is derived or decrypted, so it is instant and
 * works before any passphrase is typed. `FILE_TOO_LARGE` comes first, as for a full read.
 */
export async function inspectBackupHeader(source: ByteSource): Promise<Result<{ readonly size: number }, 'NOT_A_WMBUGO_BACKUP' | 'FILE_TOO_LARGE'>> {
  if (source.size > MAX_FILE_BYTES) return err('FILE_TOO_LARGE');
  if (source.size < HEADER_BYTES) return err('NOT_A_WMBUGO_BACKUP');
  try {
    const head = await source.read(0, 12);
    if (head.length < 12 || !equalBytes(head.subarray(0, 8), utf8Encode(MAGIC)) || readU32(head, 8) !== FORMAT_VERSION) return err('NOT_A_WMBUGO_BACKUP');
    return ok({ size: source.size });
  } catch {
    return err('NOT_A_WMBUGO_BACKUP');
  }
}
