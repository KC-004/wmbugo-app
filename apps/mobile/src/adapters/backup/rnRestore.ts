import { ANDROID_DATABASE_PATH } from '@op-engineering/op-sqlite';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  ACCOUNT_LIST_SQL,
  balanceOf,
  loadMigrations,
  mapAccountRows,
  runMigrations,
  type EntryTarget,
  type RestoreDb,
  type RestoreFs,
  type RestoreLayout,
  type SqlDatabase,
} from '@wmbugo/core';
import migrations from '../../../drizzle/migrations';
import { PRIVATE_DIR } from '../files/rnFileStore';
import { RECEIPTS_DIR } from '../files/receiptFiles';
import { keychainKeyStore } from '../storage/keychainKeyStore';
import { createOpSqliteOpener } from '../storage/opSqliteOpener';
import { toBase64 } from './base64';
import { openEncryptedPhoto } from './backupFiles';

/** Where the live database and its photos are, and where a restore works. */
export const RESTORE_LAYOUT: RestoreLayout = {
  dbPath: `${ANDROID_DATABASE_PATH}/wmbugo.db`,
  attachmentsDir: RECEIPTS_DIR,
  stagingDir: `${PRIVATE_DIR}/staging`,
  stagingDb: `${PRIVATE_DIR}/staging/wmbugo.db`,
  stagingAttachmentsDir: `${PRIVATE_DIR}/staging/receipts`,
  safetyDir: `${PRIVATE_DIR}/safety-restore`,
  journalPath: `${PRIVATE_DIR}/restore.journal`,
};

const RAW_NAME = 'archive.db';
const RAW_PATH = `${RESTORE_LAYOUT.stagingDir}/${RAW_NAME}`;
const STAGED_NAME = 'wmbugo.db';

/** The app-private file operations a restore needs, on the file system library. */
export const rnRestoreFs: RestoreFs = {
  exists: (path) => RNFS.exists(path),
  rename: (from, to) => RNFS.moveFile(from, to),
  async remove(path) {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  },
  makeDir: (path) => RNFS.mkdir(path),
  async readText(path) {
    return (await RNFS.exists(path)) ? RNFS.readFile(path, 'utf8') : null;
  },
  async writeText(path, text) {
    // Written beside the file and renamed over it, so a kill never leaves half a journal.
    const temp = `${path}.tmp`;
    await RNFS.writeFile(temp, text, 'utf8');
    if (await RNFS.exists(path)) await RNFS.unlink(path);
    await RNFS.moveFile(temp, path);
  },
  async freeBytes() {
    return Number((await RNFS.getFSInfo()).freeSpace);
  },
};

async function sizeOf(path: string): Promise<number> {
  if (!(await RNFS.exists(path))) return 0;
  const s = await RNFS.stat(path);
  if (!s.isDirectory()) return Number(s.size);
  let total = 0;
  for (const f of await RNFS.readDir(path)) total += await sizeOf(f.path);
  return total;
}

async function deviceKey(): Promise<string> {
  const k = await keychainKeyStore.getKey();
  if (!k) throw new Error('No key');
  return k;
}

/** A staged database file opened with a key: the archive key for the raw export, this device's key for the finished one. */
async function openStaged(name: string, keyHex: string): Promise<SqlDatabase> {
  return createOpSqliteOpener(name, RESTORE_LAYOUT.stagingDir).open(keyHex);
}

/**
 * The phone's side of a restore (Story 8.8). The decrypted database arrives in staging as the SQLCipher export keyed with the
 * archive key; it is migrated forward on its own connection, then exported again into a database keyed with this device's key.
 * Photos are encrypted with the device file key as they arrive. Nothing here touches the live data: that is the swap's job.
 */
export function createRnRestoreDb(live: SqlDatabase | null): RestoreDb {
  return {
    async openEntry(name): Promise<EntryTarget> {
      if (name === 'db') {
        let first = true;
        return {
          async write(chunk) {
            const b64 = toBase64(chunk);
            if (first) await RNFS.writeFile(RAW_PATH, b64, 'base64');
            else await RNFS.appendFile(RAW_PATH, b64, 'base64');
            first = false;
          },
          async close() {
            if (first) await RNFS.writeFile(RAW_PATH, '', 'utf8');
          },
        };
      }
      const id = name.slice('attachments/'.length);
      const photo = await openEncryptedPhoto(`${RESTORE_LAYOUT.stagingAttachmentsDir}/${id}.enc`, await deviceKey());
      return { write: (c) => photo.write(c), close: () => photo.close() };
    },

    async migrateAndRekey(archiveKeyHex) {
      let archive: SqlDatabase | null = null;
      try {
        archive = await openStaged(RAW_NAME, archiveKeyHex);
        const bundle = loadMigrations(migrations);
        if (!bundle.ok) return { ok: false, code: 'BACKUP_DAMAGED' };
        // Forward only: a backup from an older schema is migrated; a newer one was refused before this point.
        const r = await runMigrations(archive, bundle.value, () => Date.now());
        if (!r.ok) return { ok: false, code: r.code === 'DATABASE_NEWER_THAN_APP' ? 'BACKUP_TOO_NEW' : 'BACKUP_DAMAGED' };
        // Re-key: export into a database keyed with this device's key. Keys are bound as parameters, never written in SQL text.
        await archive.query('ATTACH DATABASE ? AS final KEY ?', [RESTORE_LAYOUT.stagingDb, await deviceKey()]);
        try {
          await archive.query("SELECT sqlcipher_export('final')");
        } finally {
          await archive.query('DETACH DATABASE final');
        }
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, code: 'BACKUP_DAMAGED' };
      } finally {
        await archive?.close().catch(() => undefined);
        await RNFS.unlink(RAW_PATH).catch(() => undefined);
      }
    },

    async carryDeviceSettings() {
      // This phone keeps its own app lock, Lock after and hide-in-recents choices: they come from the live database, not the backup.
      // In safe mode with an unreadable database there is no live database to read them from.
      if (live === null) return;
      const rows = await live.query("SELECT key, value_json, version, updated_at FROM settings WHERE key LIKE 'device.%'");
      const staged = await openStaged(STAGED_NAME, await deviceKey());
      try {
        for (const r of rows) {
          await staged.query(
            'INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at',
            [String(r[0]), String(r[1]), Number(r[2]), Number(r[3])],
          );
        }
        await staged.query("DELETE FROM settings WHERE key LIKE 'device.%' AND key NOT IN (" + (rows.length === 0 ? "''" : rows.map(() => '?').join(',')) + ')', rows.map((r) => String(r[0])));
      } finally {
        await staged.close().catch(() => undefined);
      }
    },

    async verify() {
      const staged = await openStaged(STAGED_NAME, await deviceKey());
      try {
        const quick = await staged.query('PRAGMA quick_check');
        const quickCheckOk = quick.length === 1 && String(quick[0]![0]) === 'ok';
        // The writer's invariants are checked per transaction; on a whole database the equivalents are foreign keys and one profile.
        const fk = await staged.query('PRAGMA foreign_key_check');
        const profiles = Number((await staged.query('SELECT COUNT(*) FROM profile'))[0]?.[0] ?? 0);
        const balances = new Map<string, number>();
        for (const a of mapAccountRows(await staged.query(ACCOUNT_LIST_SQL))) {
          const b = balanceOf(a);
          if (b.kind === 'known') balances.set(a.id, b.minor);
        }
        // Exactly one profile: a backup with none would drop the person into onboarding over restored data.
        return { quickCheckOk, invariantsOk: fk.length === 0 && profiles === 1, balances };
      } finally {
        await staged.close().catch(() => undefined);
      }
    },

    async currentDataBytes() {
      return (await sizeOf(RESTORE_LAYOUT.dbPath)) + (await sizeOf(RESTORE_LAYOUT.attachmentsDir));
    },

    /** Closes the live connection (folding the write-ahead log into the file) right before the swap moves the file. */
    async prepareForSwap() {
      // If the log cannot be folded into the file, nothing is closed or moved: the swap would otherwise leave recent writes behind
      // in a -wal file that is then deleted.
      await live?.query('PRAGMA wal_checkpoint(TRUNCATE)');
      await live?.close().catch(() => undefined);
      for (const suffix of ['-wal', '-shm']) await RNFS.unlink(`${RESTORE_LAYOUT.dbPath}${suffix}`).catch(() => undefined);
    },
  };
}

/** The start checks for a freshly swapped database: it opens, `quick_check` passes, and the first query returns (Story 8.8). */
export async function restoredDatabaseOpens(): Promise<boolean> {
  let db: SqlDatabase | null = null;
  try {
    // The opener creates a new empty database when the file is missing, and an empty database passes quick_check.
    if (!(await RNFS.exists(RESTORE_LAYOUT.dbPath))) return false;
    db = await createOpSqliteOpener().open(await deviceKey());
    const quick = await db.query('PRAGMA quick_check');
    if (!(quick.length === 1 && String(quick[0]![0]) === 'ok')) return false;
    await db.query('SELECT COUNT(*) FROM sqlite_master');
    return true;
  } catch {
    return false;
  } finally {
    await db?.close().catch(() => undefined);
  }
}
