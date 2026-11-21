import { SECRETSTREAM_ABYTES, SECRETSTREAM_HEADER_BYTES } from '../ports/crypto';

/**
 * The wmbugo backup file (Story 8.6, AD-10, BKP-001):
 *
 *   header (76 bytes, in the clear)
 *     magic `WMBUGOBK` (8) | format version u32 (4) | Argon2id opslimit u32 (4) | memlimit u32 (4)
 *     | salt (16) | passphrase verifier (16) | secretstream header (24)
 *   then 64 KiB chunks of XChaCha20-Poly1305 secretstream ciphertext, the last one tagged FINAL.
 *
 * The decrypted stream is a list of entries: `manifest.json`, then `db`, then `attachments/<uuid>`. Each entry is
 *   name length u16 | name | size u64 | SHA-256 (32) | data
 */
export const MAGIC = 'WMBUGOBK';
export const FORMAT_VERSION = 1;
export const SALT_BYTES = 16;
export const VERIFIER_BYTES = 16;
export const KEY_BYTES = 32;
export const CHUNK_BYTES = 64 * 1024;
export const FRAME_BYTES = CHUNK_BYTES + SECRETSTREAM_ABYTES;
export const HEADER_BYTES = 8 + 4 + 4 + 4 + SALT_BYTES + VERIFIER_BYTES + SECRETSTREAM_HEADER_BYTES;
/** A file larger than this is refused (`FILE_TOO_LARGE`). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
/** The manifest is small; anything larger is not a manifest. */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

/** The production Argon2id parameters: opslimit 3, memlimit 64 MiB. They are stored in the file so they can change later. */
export const DEFAULT_KDF = { opslimit: 3, memlimit: 64 * 1024 * 1024 } as const;
/**
 * What a reader accepts: a damaged parameter cannot ask for gigabytes of memory. The memory limit must be a whole number of KiB,
 * because Argon2 rounds it down to KiB: a stray bit below that would change nothing and a flipped byte would go unnoticed.
 */
export const KDF_LIMITS = { minOps: 1, maxOps: 16, minMem: 8 * 1024, maxMem: 256 * 1024 * 1024 } as const;

export const MANIFEST_NAME = 'manifest.json';
export const DB_NAME = 'db';
const ATTACHMENT_NAME = /^attachments\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Only `manifest.json`, `db` and `attachments/<uuid>` may appear. No path, no `..`, no backslash, no duplicates (SEC-006). */
export function isAllowedEntryName(name: string): boolean {
  return name === MANIFEST_NAME || name === DB_NAME || ATTACHMENT_NAME.test(name);
}

export interface BackupManifest {
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly appId: string;
  readonly appVersion: string;
  readonly createdAt: { readonly utcMs: number; readonly timezoneId: string };
  readonly counts: { readonly entries: number; readonly accounts: number; readonly photos: number };
  /** Each account's derived balance in minor units on the source device; a restore recomputes and compares. */
  readonly accountBalances: readonly { readonly accountId: string; readonly balanceMinor: number }[];
  /** Every other entry of the payload: name, size and SHA-256 (hex). */
  readonly entries: readonly { readonly name: string; readonly size: number; readonly sha256: string }[];
  /** SHA-256 (hex) over the name, size and digest of every entry after the manifest, in order. */
  readonly payloadChecksum: string;
  /** The random 256-bit key (hex) of the SQLCipher database in the `db` entry. It exists only inside this encrypted manifest. */
  readonly archiveKey: string;
}

/** `STORAGE_FAILED`: the file is fine but the phone could not write what it read (a full disk): not a damaged backup. */
export type BackupReadError = 'NOT_A_WMBUGO_BACKUP' | 'WRONG_PASSPHRASE' | 'BACKUP_DAMAGED' | 'BACKUP_TOO_NEW' | 'FILE_TOO_LARGE' | 'STORAGE_FAILED';

/** The most photos and bytes a manifest may declare: the file itself cannot exceed `MAX_FILE_BYTES`. */
const MAX_ENTRIES = 200_000;

// ---- byte helpers (no Buffer, no TextEncoder: core runs in Hermes and Node) ----

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function readU32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

/** Sizes are at most 2^53; stored as two big-endian u32 halves. */
export function u64(n: number): Uint8Array {
  return concat([u32(Math.floor(n / 4294967296)), u32(n % 4294967296)]);
}

export function readU64(b: Uint8Array, at: number): number {
  return readU32(b, at) * 4294967296 + readU32(b, at + 4);
}

export function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 255, n & 255]);
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
}

export function fromHex(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/** Strict UTF-8 decoding: null for a byte sequence that is not valid UTF-8. */
export function utf8Decode(b: Uint8Array): string | null {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i]!;
    let cp: number;
    let n: number;
    if (x < 0x80) [cp, n] = [x, 1];
    else if (x >= 0xc2 && x < 0xe0) [cp, n] = [x & 31, 2];
    else if (x >= 0xe0 && x < 0xf0) [cp, n] = [x & 15, 3];
    else if (x >= 0xf0 && x < 0xf5) [cp, n] = [x & 7, 4];
    else return null;
    if (i + n > b.length) return null;
    for (let k = 1; k < n; k++) {
      const c = b[i + k]!;
      if ((c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 63);
    }
    if ((n === 3 && cp < 0x800) || (n === 4 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    s += String.fromCodePoint(cp);
    i += n;
  }
  return s;
}

/** The passphrase as bytes: Unicode NFKC, then UTF-8, so the same typed passphrase always derives the same key. */
export function passphraseBytes(passphrase: string): Uint8Array {
  return utf8Encode(passphrase.normalize('NFKC'));
}

export const VERIFIER_CONTEXT = utf8Encode('wmbugo-backup-verifier-v1');

/** Parses and validates a manifest; null when it is not one. */
export function parseManifest(json: string): BackupManifest | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
  const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200;
  const hex = (x: unknown, bytes: number): x is string => typeof x === 'string' && x.length === bytes * 2 && !/[^0-9a-f]/.test(x);
  if (!num(m.formatVersion) || !num(m.schemaVersion) || !str(m.appId) || !str(m.appVersion)) return null;
  const at = m.createdAt as Record<string, unknown> | undefined;
  const counts = m.counts as Record<string, unknown> | undefined;
  if (!at || !num(at.utcMs) || !str(at.timezoneId) || !counts || !num(counts.entries) || !num(counts.accounts) || !num(counts.photos)) return null;
  if (!Array.isArray(m.accountBalances) || !Array.isArray(m.entries)) return null;
  for (const b of m.accountBalances as unknown[]) {
    const r = b as Record<string, unknown> | null;
    if (!r || !str(r.accountId) || typeof r.balanceMinor !== 'number' || !Number.isSafeInteger(r.balanceMinor)) return null;
  }
  const entryList = m.entries as unknown[];
  if (entryList.length === 0 || entryList.length > MAX_ENTRIES) return null;
  const names = new Set<string>();
  let declared = 0;
  for (const e of entryList) {
    const r = e as Record<string, unknown> | null;
    if (!r || typeof r.name !== 'string' || !isAllowedEntryName(r.name) || r.name === MANIFEST_NAME || names.has(r.name) || !num(r.size) || !hex(r.sha256, 32)) return null;
    names.add(r.name);
    declared += r.size as number;
  }
  // The database comes first and is always there: a backup without one has nothing to restore.
  if ((entryList[0] as Record<string, unknown>).name !== DB_NAME) return null;
  // The declared sizes cannot add up to more than a file may hold, and the photo count is the number of photo entries.
  if (!Number.isSafeInteger(declared) || declared > MAX_FILE_BYTES) return null;
  if (counts.photos !== entryList.length - 1) return null;
  if (!hex(m.payloadChecksum, 32) || !hex(m.archiveKey, KEY_BYTES)) return null;
  return m as unknown as BackupManifest;
}
