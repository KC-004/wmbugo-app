import type { SqlDatabase, SqlStatement } from '../ports/storage';
import { err, ok, type Result } from '../shared/result';
import { sha256Hex } from '../shared/sha256';

/** drizzle-kit (driver: 'expo') bundle shape: journal plus one SQL string per migration. */
export interface BundledMigrations {
  readonly journal: { readonly entries: readonly { readonly idx: number; readonly tag: string }[] };
  readonly migrations: Readonly<Record<string, string>>;
}

export interface Migration {
  /** 1-based, equals journal idx + 1. */
  readonly version: number;
  readonly tag: string;
  readonly statements: readonly string[];
  readonly checksum: string;
}

export type MigrationErrorCode =
  | 'MIGRATION_BUNDLE_INVALID'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'DATABASE_NEWER_THAN_APP'
  | 'MIGRATION_FAILED';

const BREAKPOINT = '--> statement-breakpoint';

/** Turns the bundled drizzle output into ordered migrations with checksums. */
export function loadMigrations(bundle: BundledMigrations): Result<Migration[], 'MIGRATION_BUNDLE_INVALID'> {
  const out: Migration[] = [];
  const entries = [...bundle.journal.entries].sort((a, b) => a.idx - b.idx);
  for (const [i, e] of entries.entries()) {
    if (e.idx !== i) return err('MIGRATION_BUNDLE_INVALID');
    const sql = bundle.migrations[`m${String(e.idx).padStart(4, '0')}`];
    if (typeof sql !== 'string' || sql.trim() === '') return err('MIGRATION_BUNDLE_INVALID');
    out.push({
      version: e.idx + 1,
      tag: e.tag,
      statements: sql
        .split(BREAKPOINT)
        .map((s) => s.trim())
        .filter((s) => s !== ''),
      checksum: sha256Hex(sql),
    });
  }
  return ok(out);
}

export interface MigrationReport {
  readonly appliedVersions: readonly number[];
  readonly currentVersion: number;
}

async function tableExists(db: SqlDatabase, name: string): Promise<boolean> {
  const rows = await db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  return rows.length > 0;
}

/**
 * Applies pending migrations forward-only. Before anything is written to an
 * existing database it takes a safety copy; all pending migrations plus their schema_migration rows go in
 * one transaction. If that transaction throws, the database stays at its
 * previous version and the safety copy is kept.
 */
export async function runMigrations(
  db: SqlDatabase,
  migrations: readonly Migration[],
  nowMs: () => number,
): Promise<Result<MigrationReport, MigrationErrorCode>> {
  const applied = new Map<number, string>();
  if (await tableExists(db, 'schema_migration')) {
    for (const row of await db.query('SELECT version, checksum FROM schema_migration ORDER BY version')) {
      applied.set(Number(row[0]), String(row[1]));
    }
  }
  const latestKnown = migrations.length;
  const highestApplied = applied.size === 0 ? 0 : Math.max(...applied.keys());
  if (highestApplied > latestKnown) return err('DATABASE_NEWER_THAN_APP');
  // Applied versions must be 1..n with no gap; a hole means the database was not built by this runner.
  for (let v = 1; v <= highestApplied; v++) if (!applied.has(v)) return err('MIGRATION_CHECKSUM_MISMATCH');

  for (const m of migrations) {
    const sum = applied.get(m.version);
    if (sum !== undefined && sum !== m.checksum) return err('MIGRATION_CHECKSUM_MISMATCH');
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return ok({ appliedVersions: [], currentVersion: highestApplied });

  const batch: SqlStatement[] = [];
  const at = nowMs();
  for (const m of pending) {
    for (const sql of m.statements) batch.push({ sql });
    batch.push({
      sql: 'INSERT INTO schema_migration (version, tag, checksum, applied_at) VALUES (?, ?, ?, ?)',
      params: [m.version, m.tag, m.checksum, at],
    });
  }

  // SQLite changes a CHECK by rebuilding the table (drizzle-kit writes `PRAGMA foreign_keys=OFF` first). That pragma does
  // nothing inside a transaction, and dropping a parent table that has child rows would then fail. So, outside the
  // transaction, foreign keys go off for the batch and are checked and switched back on afterwards.
  const rebuilds = pending.some((m) => m.statements.some((st) => /PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(st)));
  try {
    // A database with no applied migration is empty: there is nothing to protect yet.
    if (applied.size > 0) await db.safetyCopy(`before-v${pending[0]!.version}`);
    if (rebuilds) await db.query('PRAGMA foreign_keys = OFF');
    try {
      await db.executeBatch(batch);
      if (rebuilds && (await db.query('PRAGMA foreign_key_check')).length > 0) return err('MIGRATION_FAILED');
    } finally {
      if (rebuilds) await db.query('PRAGMA foreign_keys = ON');
    }
  } catch {
    return err('MIGRATION_FAILED');
  }
  return ok({ appliedVersions: pending.map((m) => m.version), currentVersion: latestKnown });
}
