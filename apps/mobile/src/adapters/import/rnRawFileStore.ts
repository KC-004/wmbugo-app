import * as RNFS from '@dr.pogodin/react-native-fs';
import type { RawFileStore, SqlDatabase } from '@wmbugo/core';
import { openEncryptedPhoto, streamDecrypted } from '../backup/backupFiles';
import { PRIVATE_DIR } from '../files/rnFileStore';
import { keychainKeyStore } from '../storage/keychainKeyStore';

/** Where the encrypted copies of imported files live: app-private, never in a backup, removed by Erase everything. */
export const IMPORTS_DIR = `${PRIVATE_DIR}/imports`;

const CHUNK = 64 * 1024;

async function deviceKey(): Promise<string> {
  const k = await keychainKeyStore.getKey();
  if (!k) throw new Error('No key');
  return k;
}

/** The copies the database still points at. */
export const RAW_PATHS_SQL = 'SELECT raw_path FROM import_batch WHERE raw_path IS NOT NULL';

/**
 * Deletes copies no import refers to: the app was killed between writing the encrypted file and committing the import row (AD-9).
 * Runs at app start only, when no import can be running. Returns how many files it deleted.
 */
export async function sweepImportOrphans(db: Pick<SqlDatabase, 'query'>, dir: string = IMPORTS_DIR): Promise<number> {
  if (!(await RNFS.exists(dir))) return 0;
  const known = new Set((await db.query(RAW_PATHS_SQL)).map((r) => String(r[0])));
  let removed = 0;
  for (const f of await RNFS.readDir(dir)) {
    if (f.isDirectory() || known.has(f.path)) continue;
    await RNFS.unlink(f.path).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

/**
 * The raw copy of an imported file (AD-9), encrypted with the device file key by the same native writer receipt photos use. Nothing
 * plain touches the disk; a failed write leaves no file behind.
 */
export const rnRawFileStore: RawFileStore = {
  async save(name, bytes) {
    await RNFS.mkdir(IMPORTS_DIR);
    const path = `${IMPORTS_DIR}/${name}`;
    const out = await openEncryptedPhoto(path, await deviceKey());
    try {
      for (let at = 0; at < bytes.length; at += CHUNK) await out.write(bytes.subarray(at, Math.min(at + CHUNK, bytes.length)));
      await out.close();
    } catch (e) {
      await out.abort().catch(() => undefined);
      throw e;
    }
    return path;
  },
  async read(path) {
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const c of streamDecrypted(path, await deviceKey())) {
      parts.push(c);
      total += c.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  },
  async remove(path) {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  },
};
