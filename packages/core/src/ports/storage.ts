export type SqlParam = string | number | null;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlParam[];
}

/** An open, keyed database. Rows come back as arrays of values. */
export interface SqlDatabase {
  /** Value of `PRAGMA cipher_version`, or null/'' when SQLCipher is not active. */
  cipherVersion(): Promise<string | null>;
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
  /** Runs every statement in ONE transaction; any failure rolls all of it back and rejects. */
  executeBatch(statements: readonly SqlStatement[]): Promise<void>;
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
