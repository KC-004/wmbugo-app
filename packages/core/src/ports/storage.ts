export type SqlParam = string | number | null;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlParam[];
}

/** Statements issued inside one transaction. */
export interface SqlTransaction {
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
  execute(sql: string, params?: readonly SqlParam[]): Promise<void>;
}

/** An open, keyed database. Rows come back as arrays of values. */
export interface SqlDatabase {
  /** Value of `PRAGMA cipher_version`, or null/'' when SQLCipher is not active. */
  cipherVersion(): Promise<string | null>;
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
  /** Runs every statement in ONE transaction; any failure rolls all of it back and rejects. */
  executeBatch(statements: readonly SqlStatement[]): Promise<void>;
  /**
   * Runs `fn` alone in one transaction on the single serialised connection: other
   * statements on this database wait until it commits, so nothing can read a half-written
   * state. If `fn` throws, everything it wrote is rolled back and the error is rethrown.
   */
  transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T>;
  /** Copies the database file somewhere private before a migration. Resolves when the copy is durable. */
  safetyCopy(label: string): Promise<void>;
  close(): Promise<void>;
}

/** Opens (creating if needed) the database with the given key. Adapter-provided. */
export interface DatabaseOpener {
  /** True when a database file already exists on this device (so a missing key must never be replaced). */
  exists(): Promise<boolean>;
  open(keyHex: string): Promise<SqlDatabase>;
}

/** The port the writer uses; the SQLite adapter provides it. */
export type UnitOfWork = Pick<SqlDatabase, 'transaction'>;
