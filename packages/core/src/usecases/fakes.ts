import type { KeyStore } from '../ports/keystore';
import type { DatabaseOpener, SqlDatabase, SqlParam, SqlStatement } from '../ports/storage';
import { createRedactingLogger, type LogEntry } from '../shared/logger';

/**
 * In-memory SqlDatabase for tests. It understands only the statements the
 * startup and migration code issues, and applies a batch atomically: a
 * statement starting with FAIL (or a CREATE of an existing table) throws and
 * leaves the state untouched, like a SQLite transaction rollback.
 */
export class FakeSqlDatabase implements SqlDatabase {
  tables = new Set<string>();
  migrationRows: { version: number; tag: string; checksum: string; applied_at: number }[] = [];
  profileRows = 0;
  cipher: string | null = '4.19.0 community';
  writes = 0;
  safetyCopies: string[] = [];
  failSafetyCopy = false;
  closed = false;

  cipherVersion(): Promise<string | null> {
    return Promise.resolve(this.cipher);
  }

  throwOnQuery = false;

  query(sql: string, params: readonly SqlParam[] = []): Promise<SqlParam[][]> {
    if (this.throwOnQuery) return Promise.reject(new Error('file is not a database'));
    if (sql.includes('FROM sqlite_master')) {
      const name = params[0] ?? /name = '([a-z_]+)'/.exec(sql)?.[1];
      return Promise.resolve(this.tables.has(String(name)) ? [[1]] : []);
    }
    if (sql.startsWith('SELECT version, checksum FROM schema_migration')) {
      return Promise.resolve(this.migrationRows.map((r) => [r.version, r.checksum]));
    }
    if (sql.startsWith('SELECT 1 FROM profile')) return Promise.resolve(this.profileRows > 0 ? [[1]] : []);
    return Promise.reject(new Error(`FakeSqlDatabase: unsupported query ${sql}`));
  }

  executeBatch(statements: readonly SqlStatement[]): Promise<void> {
    const tables = new Set(this.tables);
    const rows = [...this.migrationRows];
    for (const s of statements) {
      if (s.sql.startsWith('FAIL')) return Promise.reject(new Error('injected failure'));
      const create = /^CREATE TABLE `?([a-z_]+)`?/.exec(s.sql);
      if (create) {
        if (tables.has(create[1]!)) return Promise.reject(new Error('table exists'));
        tables.add(create[1]!);
      } else if (s.sql.startsWith('INSERT INTO schema_migration')) {
        const p = s.params ?? [];
        rows.push({ version: Number(p[0]), tag: String(p[1]), checksum: String(p[2]), applied_at: Number(p[3]) });
      }
    }
    this.tables = tables;
    this.migrationRows = rows;
    this.writes += 1;
    return Promise.resolve();
  }

  safetyCopy(label: string): Promise<void> {
    if (this.failSafetyCopy) return Promise.reject(new Error('copy failed'));
    this.safetyCopies.push(label);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

export class FakeKeyStore implements KeyStore {
  key: string | null = null;
  throwOnGet = false;
  refuseSet = false;
  sets = 0;

  getKey(): Promise<string | null> {
    return this.throwOnGet ? Promise.reject(new Error('keystore down')) : Promise.resolve(this.key);
  }

  setKey(keyHex: string): Promise<boolean> {
    this.sets += 1;
    if (this.refuseSet) return Promise.resolve(false);
    this.key = keyHex;
    return Promise.resolve(true);
  }
}

export class FakeOpener implements DatabaseOpener {
  openedWith: string[] = [];
  failOpen = false;
  fileExists = false;
  constructor(readonly db: FakeSqlDatabase) {}

  exists(): Promise<boolean> {
    return Promise.resolve(this.fileExists);
  }

  open(keyHex: string): Promise<SqlDatabase> {
    this.openedWith.push(keyHex);
    return this.failOpen ? Promise.reject(new Error('cannot open')) : Promise.resolve(this.db);
  }
}

export function captureLogger(): { entries: LogEntry[]; logger: ReturnType<typeof createRedactingLogger> } {
  const entries: LogEntry[] = [];
  return { entries, logger: createRedactingLogger({ write: (e) => entries.push(e) }) };
}
