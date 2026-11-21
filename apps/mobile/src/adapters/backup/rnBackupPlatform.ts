import * as RNFS from '@dr.pogodin/react-native-fs';
import { ATTACHMENT_IDS_SQL, type BackupEntrySource, type BackupPlatform, type Crypto, type SqlDatabase } from '@wmbugo/core';
import { PRIVATE_DIR } from '../files/rnFileStore';
import { filePath as receiptPath } from '../files/receiptFiles';
import { keychainKeyStore } from '../storage/keychainKeyStore';
import { fromBase64 } from './base64';
import { createBackupDocument, streamDecrypted } from './backupFiles';

/** Staging for a backup in progress: app-private, and its only content is the SQLCipher export keyed with the archive key. */
export const STAGING_DIR = `${PRIVATE_DIR}/staging`;
const CHUNK = 64 * 1024;

/** Reads a file in order, 64 KiB at a time. */
async function* readFile(path: string, size: number): AsyncGenerator<Uint8Array> {
  for (let pos = 0; pos < size; pos += CHUNK) {
    yield fromBase64(await RNFS.read(path, Math.min(CHUNK, size - pos), pos, 'base64'));
  }
}

async function digestOf(crypto: Crypto, parts: AsyncIterable<Uint8Array>): Promise<{ sha256: Uint8Array; size: number }> {
  const hash = crypto.sha256Stream();
  let size = 0;
  for await (const p of parts) {
    hash.update(p);
    size += p.length;
  }
  return { sha256: hash.final(), size };
}

/**
 * Deletes anything left in staging by an interrupted backup or restore: at the next start (Story 8.7). Staging holds only
 * encrypted databases, but it is never kept.
 */
export async function sweepStaging(): Promise<void> {
  try {
    if (await RNFS.exists(STAGING_DIR)) for (const f of await RNFS.readDir(STAGING_DIR)) await RNFS.unlink(f.path).catch(() => undefined);
  } catch {
    /* nothing to sweep */
  }
}

/**
 * The phone's side of a backup. The database is exported with SQLCipher (`sqlcipher_export`) into a staging database keyed with
 * the archive key, so the staged file is encrypted and is not a plain SQLite file. Photos are decrypted with the device file key
 * and streamed in memory; they never exist in plain form on disk. The save dialog is Android's (no storage permission).
 */
export function createRnBackupPlatform(db: SqlDatabase, crypto: Crypto): BackupPlatform {
  let skipped = 0;
  return {
    photosSkipped: () => skipped,
    async exportDatabase(archiveKeyHex) {
      await RNFS.mkdir(STAGING_DIR);
      const path = `${STAGING_DIR}/export-${Date.now()}.db`;
      const cleanup = async () => {
        for (const p of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) await RNFS.unlink(p).catch(() => undefined);
      };
      try {
        // The archive key is bound as a parameter, so it never appears in SQL text.
        await db.query('ATTACH DATABASE ? AS backup KEY ?', [path, archiveKeyHex]);
        try {
          await db.query("SELECT sqlcipher_export('backup')");
        } finally {
          await db.query('DETACH DATABASE backup');
        }
        const size = Number((await RNFS.stat(path)).size);
        const { sha256 } = await digestOf(crypto, readFile(path, size));
        const entry: BackupEntrySource = { name: 'db', size, sha256, read: () => readFile(path, size) };
        return { entry, cleanup };
      } catch (e) {
        await cleanup();
        throw e;
      }
    },

    async photos(isCancelled) {
      skipped = 0;
      const key = await keychainKeyStore.getKey();
      if (!key) throw new Error('No key');
      const ids = (await db.query(ATTACHMENT_IDS_SQL)).map((r) => String(r[0]));
      const out: BackupEntrySource[] = [];
      for (const id of ids) {
        if (isCancelled?.()) throw new Error('cancelled');
        const path = receiptPath(id);
        // A row whose file is missing has nothing to back up. It is counted, so the person is told.
        if (!(await RNFS.exists(path))) {
          skipped += 1;
          continue;
        }
        // One pass for the size and SHA-256 (the manifest lists both), another to stream it into the backup.
        try {
          const { sha256, size } = await digestOf(crypto, streamDecrypted(path, key));
          out.push({ name: `attachments/${id}`, size, sha256, read: () => streamDecrypted(path, key) });
        } catch {
          skipped += 1; // damaged or unreadable: one bad receipt must not stop every backup
        }
      }
      return out;
    },

    createDocument: (suggestedName) => createBackupDocument(suggestedName),
  };
}
