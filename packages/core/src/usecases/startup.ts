import type { KeyStore } from '../ports/keystore';
import type { DatabaseOpener, SqlDatabase } from '../ports/storage';
import type { Clock } from '../shared/clock';
import type { Logger } from '../shared/logger';
import { err, ok, type Result } from '../shared/result';
import type { RandomSource } from '../shared/uuid';
import { loadMigrations, runMigrations, type BundledMigrations, type MigrationErrorCode } from './migrations';

export type StartupErrorCode = 'KEY_UNAVAILABLE' | 'DATABASE_OPEN_FAILED' | 'STORAGE_UNSAFE' | MigrationErrorCode;

export type StartRoute = 'onboarding' | 'home';

export interface StartupDeps {
  readonly keyStore: KeyStore;
  readonly random: RandomSource;
  readonly opener: DatabaseOpener;
  readonly migrations: BundledMigrations;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface StartupOk {
  readonly db: SqlDatabase;
  readonly route: StartRoute;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** Loads the key, creating a random 256-bit one on first launch. The key never reaches the logger. */
export async function loadOrCreateKey(
  keyStore: KeyStore,
  random: RandomSource,
  canCreate = true,
): Promise<Result<string, 'KEY_UNAVAILABLE'>> {
  try {
    const existing = await keyStore.getKey();
    if (existing !== null) return KEY_PATTERN.test(existing) ? ok(existing) : err('KEY_UNAVAILABLE');
    // A database already exists but its key is missing: never replace the key. A new
    // one could not open the data and would overwrite a good key after a transient failure.
    if (!canCreate) return err('KEY_UNAVAILABLE');
    const bytes = random.bytes(32);
    if (bytes.length !== 32) return err('KEY_UNAVAILABLE');
    const key = toHex(bytes);
    return (await keyStore.setKey(key)) ? ok(key) : err('KEY_UNAVAILABLE');
  } catch {
    return err('KEY_UNAVAILABLE');
  }
}

/**
 * Startup sequence: key, open, SQLCipher check, migrations, then "does a
 * profile exist?". It performs no write until the SQLCipher check has passed,
 * and it ends as soon as the first query returns (never on a timer).
 */
export async function startStorage(deps: StartupDeps): Promise<Result<StartupOk, StartupErrorCode>> {
  const { logger } = deps;
  let databaseExists: boolean;
  try {
    databaseExists = await deps.opener.exists();
  } catch {
    logger.error('startup.open_failed');
    return err('DATABASE_OPEN_FAILED');
  }
  const key = await loadOrCreateKey(deps.keyStore, deps.random, !databaseExists);
  if (!key.ok) {
    logger.error('startup.key_unavailable', { databaseExists });
    return key;
  }

  let db: SqlDatabase;
  try {
    db = await deps.opener.open(key.value);
  } catch {
    logger.error('startup.open_failed');
    return err('DATABASE_OPEN_FAILED');
  }

  let cipher: string | null;
  try {
    cipher = await db.cipherVersion();
  } catch {
    cipher = null;
  }
  if (cipher === null || cipher.trim() === '') {
    logger.error('startup.sqlcipher_missing');
    await db.close().catch(() => undefined);
    return err('STORAGE_UNSAFE');
  }

  const bundle = loadMigrations(deps.migrations);
  if (!bundle.ok) {
    await db.close().catch(() => undefined);
    return bundle;
  }
  let migrated: Awaited<ReturnType<typeof runMigrations>>;
  try {
    migrated = await runMigrations(db, bundle.value, () => deps.clock.nowMs());
  } catch {
    // Reads fail when the key does not match the file: treat as unopenable, change nothing.
    logger.error('startup.open_failed');
    await db.close().catch(() => undefined);
    return err('DATABASE_OPEN_FAILED');
  }
  if (!migrated.ok) {
    logger.error('startup.migration_failed', { code: migrated.code });
    await db.close().catch(() => undefined);
    return migrated;
  }

  let present: boolean;
  try {
    present = await profileExists(db);
  } catch {
    logger.error('startup.open_failed');
    await db.close().catch(() => undefined);
    return err('DATABASE_OPEN_FAILED');
  }
  logger.info('startup.ready', { route: present ? 'home' : 'onboarding', migrationsApplied: migrated.value.appliedVersions.length });
  return ok({ db, route: present ? 'home' : 'onboarding' });
}

async function profileExists(db: SqlDatabase): Promise<boolean> {
  const table = await db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'profile'");
  if (table.length === 0) return false;
  const rows = await db.query('SELECT 1 FROM profile LIMIT 1');
  return rows.length > 0;
}
