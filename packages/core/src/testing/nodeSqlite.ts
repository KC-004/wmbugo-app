import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { SqlDatabase, SqlParam, SqlStatement, SqlTransaction } from '../ports/storage';

/**
 * TEST ONLY. A real SQLite engine (node:sqlite) behind the SqlDatabase port, loaded with the app's real
 * drizzle migrations, so use cases are tested against the true schema, constraints and SQL. Not exported
 * from the package index and never imported by shipped code.
 */
export class NodeSqliteDatabase implements SqlDatabase {
  readonly raw = new DatabaseSync(':memory:');
  transactions = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor() {
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  /** Applies every bundled migration in order (the same SQL the app ships). */
  applyRealMigrations(): this {
    const dir = resolve(__dirname, '../../../../apps/mobile/drizzle');
    const journal = JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    for (const e of journal.entries) {
      const sql = readFileSync(resolve(dir, `${e.tag}.sql`), 'utf8');
      for (const stmt of sql.split('--> statement-breakpoint')) if (stmt.trim() !== '') this.raw.exec(stmt);
    }
    return this;
  }

  cipherVersion(): Promise<string | null> {
    return Promise.resolve('test');
  }

  private run(sql: string, params: readonly SqlParam[] = []): SqlParam[][] {
    const stmt = this.raw.prepare(sql);
    stmt.setReturnArrays(true);
    return stmt.all(...params) as unknown as SqlParam[][];
  }

  query(sql: string, params: readonly SqlParam[] = []): Promise<SqlParam[][]> {
    try {
      return Promise.resolve(this.run(sql, params));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  executeBatch(statements: readonly SqlStatement[]): Promise<void> {
    try {
      this.raw.exec('BEGIN');
      for (const s of statements) this.run(s.sql, s.params);
      this.raw.exec('COMMIT');
      return Promise.resolve();
    } catch (e) {
      this.raw.exec('ROLLBACK');
      return Promise.reject(e);
    }
  }

  /** Transactions run one at a time, like the real adapter's lock queue. */
  transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      this.transactions += 1;
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn({
          query: (sql, params) => this.query(sql, params),
          execute: async (sql, params) => {
            this.run(sql, params);
          },
        });
        this.raw.exec('COMMIT');
        return out;
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  safetyCopy(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.raw.close();
    return Promise.resolve();
  }
}
