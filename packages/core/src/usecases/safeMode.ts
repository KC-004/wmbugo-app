import type { Querier } from '../planning/budgets';
import type { StartupErrorCode } from './startup';

/**
 * Safe mode (Story 8.12, UX-DR72, AD-19, NFR-12): when the data cannot be opened or looks damaged, wmbugo stops changing anything
 * and shows the ways out, so a fault never turns into lost entries.
 *
 * - `unreadable`: the database cannot be opened at all. Full-screen; restore and Diagnostics, backup disabled.
 * - `key-lost`: the database file exists but the Keystore key is gone. A backup is the only way back; `Start fresh` erases.
 * - `migration`: an update rolled back and nothing was lost; `Try again` runs it again and leaves safe mode without a restart.
 * - `readable`: the data opens but failed `quick_check`. The tabs stay browsable, read only, under a persistent banner.
 * - `newer`: the data was saved by a newer wmbugo (a downgrade or an old build): the way out is to update, not to restore or erase.
 * - `erase`: an erase was interrupted and could not be finished; `Try again` finishes it.
 */
export type SafeModeVariant = 'unreadable' | 'key-lost' | 'migration' | 'readable' | 'newer' | 'erase';

/** What the app can tell about the storage when a start failed. */
export interface StartupFacts {
  /** A database file exists on this phone. */
  readonly databaseExists: boolean;
  /** The Keystore answered, and holds no key. False when it could not be asked or holds one. */
  readonly keyMissing: boolean;
}

/** The variant a failed start shows. A missing key is only called lost when a database exists and the Keystore plainly has none. */
export function classifyStartupFailure(code: StartupErrorCode, facts: StartupFacts): SafeModeVariant {
  if (code === 'KEY_UNAVAILABLE' && facts.databaseExists && facts.keyMissing) return 'key-lost';
  if (code === 'MIGRATION_FAILED') return 'migration';
  if (code === 'DATABASE_NEWER_THAN_APP') return 'newer';
  if (code === 'ERASE_UNFINISHED') return 'erase';
  return 'unreadable';
}

/** The reasons recorded (redacted: codes only) when safe mode starts. They appear in the log and in Diagnostics. */
export type SafeModeReason = 'quick_check_failed' | 'integrity_check_threw' | `start_${string}`;

export const SAFE_MODE_BANNER = "wmbugo can't safely change your data right now. Your entries are untouched.";
export const SAFE_MODE_MIGRATION = "wmbugo couldn't finish updating your data. Nothing was lost.";
export const SAFE_MODE_KEY_LOST = "This phone's key for wmbugo is gone, so the data here can't be opened. A backup is the only way to get it back.";
export const SAFE_MODE_NO_BACKUP = "The data can't be read, so it can't be backed up.";
export const SAFE_MODE_NEWER = 'This data was saved by a newer version of wmbugo. Update wmbugo to open it. Your entries are untouched.';
export const SAFE_MODE_ERASE = "wmbugo couldn't finish erasing this phone's data. Try again to finish. Nothing new was added.";

/**
 * What `PRAGMA quick_check` said: `ok`, `failed` (it reported a problem) or `threw` (it could not answer, for example a busy or
 * locked database). A throw is not proof of damage, so the daily check tries once more before entering safe mode.
 */
export type QuickCheckVerdict = 'ok' | 'failed' | 'threw';

export async function quickCheckVerdict(db: Querier): Promise<QuickCheckVerdict> {
  try {
    const rows = await db.query('PRAGMA quick_check');
    return rows.length === 1 && String(rows[0]![0]) === 'ok' ? 'ok' : 'failed';
  } catch {
    return 'threw';
  }
}

/**
 * `PRAGMA quick_check` on the open database: true when it says `ok`. It reads only. A database that cannot answer counts as failed,
 * because safe mode is the cautious side.
 */
export async function quickCheckPasses(db: Querier): Promise<boolean> {
  try {
    const rows = await db.query('PRAGMA quick_check');
    return rows.length === 1 && String(rows[0]![0]) === 'ok';
  } catch {
    return false;
  }
}

/** True once per local day: the daily integrity check runs after Home's first frame and again when the day changes. */
export function integrityCheckDue(lastCheckedDay: string | null, today: string): boolean {
  return lastCheckedDay !== today;
}
