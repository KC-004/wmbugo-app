import { ANDROID_DATABASE_PATH, open } from '@op-engineering/op-sqlite';
import type { DatabaseOpener, SqlDatabase, SqlParam, SqlTransaction } from '@wmbugo/core';
import { copyFile, ensureDir, fileExists, PRIVATE_DIR } from '../files/rnFileStore';

const DB_NAME = 'wmbugo.db';
const SAFETY_DIR = `${PRIVATE_DIR}/safety`;

/**
 * op-sqlite with SQLCipher (flag in apps/mobile/package.json). All statements
 * go through executeRaw / executeBatch: Drizzle's own op-sqlite driver does not
 * work with op-sqlite 19 (see docs/decisions/S1-storage-migrations.md).
 */
export function createOpSqliteOpener(name: string = DB_NAME): DatabaseOpener {
  return {
  exists: () => fileExists(`${ANDROID_DATABASE_PATH}/${name}`),

  async open(keyHex: string): Promise<SqlDatabase> {
    const db = open({ name, encryptionKey: keyHex });
    // Foreign keys are off by default in SQLite and are per connection: the ledger relies on them.
    db.executeSync('PRAGMA foreign_keys = ON');
    return {
      async cipherVersion() {
        const r = await db.executeRaw('PRAGMA cipher_version');
        const v = r.rawRows[0]?.[0];
        return typeof v === 'string' ? v : null;
      },
      async query(sql, params = []) {
        const r = await db.executeRaw(sql, [...params]);
        return r.rawRows as SqlParam[][];
      },
      async executeBatch(statements) {
        await db.executeBatch(statements.map((s) => [s.sql, [...(s.params ?? [])]] as [string, SqlParam[]]));
      },
      async transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T> {
        // op-sqlite queues every other statement on this connection until the transaction ends,
        // so readers never see a half-written state. Its rows are objects; keep column order.
        let result!: T;
        await db.transaction(async (tx) => {
          result = await fn({
            query: async (sql, params = []) => {
              const r = await tx.execute(sql, [...params]);
              return r.rows.map((row) => Object.values(row) as SqlParam[]);
            },
            execute: async (sql, params = []) => {
              await tx.execute(sql, [...params]);
            },
          });
        });
        return result;
      },
      async safetyCopy(label) {
        // Fold the write-ahead log into the main file so the copy is complete.
        await db.executeRaw('PRAGMA wal_checkpoint(TRUNCATE)');
        await ensureDir(SAFETY_DIR);
        // The copy is the encrypted file as-is: same key, no plaintext on disk.
        await copyFile(db.getDbPath(), `${SAFETY_DIR}/${name}.${label}`);
      },
      async close() {
        db.close();
      },
    };
  },
  };
}

export const opSqliteOpener: DatabaseOpener = createOpSqliteOpener();
