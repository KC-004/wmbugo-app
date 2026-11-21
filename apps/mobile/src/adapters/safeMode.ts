import {
  classifyStartupFailure,
  integrityCheckDue,
  quickCheckVerdict,
  toLocalDate,
  type Logger,
  type SafeModeVariant,
  type SqlDatabase,
  type StartupErrorCode,
  type LedgerWriter,
} from '@wmbugo/core';
import { RESTORE_LAYOUT } from './backup/rnRestore';
import { rnFileStore } from './files/rnFileStore';
import { keychainKeyStore } from './storage/keychainKeyStore';
import { useSafeModeStore } from '../shared/state/safeModeStore';

/** Which safe-mode screen a failed start shows: asks the file system and the Keystore, each on its own. */
export async function describeStartupFailure(code: StartupErrorCode): Promise<SafeModeVariant> {
  const databaseExists = await rnFileStore.exists(RESTORE_LAYOUT.dbPath).catch(() => false);
  // The Keystore could not be asked: not called lost.
  const keyMissing = await keychainKeyStore.getKey().then(
    (k) => k === null,
    () => false,
  );
  return classifyStartupFailure(code, { databaseExists, keyMissing });
}

/**
 * Enters safe mode with a readable database (Story 8.12): the writer refuses everything, scheduled writes stop with it (they run
 * through the same door), the reason is logged (a code only) and shown in Diagnostics, and the banner appears.
 */
export function enterSafeMode(writer: LedgerWriter, log: Logger, reason: string): void {
  writer.setSafeMode(reason);
  useSafeModeStore.getState().setReason(reason);
  log.error('safe_mode', { reason });
}

/** How long a check that could not answer (a busy or locked database) waits before it asks once more. */
const RETRY_AFTER_MS = 3000;

/**
 * Asks `PRAGMA quick_check` once, and once more if the database could not answer: a busy or locked database is not a damaged one.
 * A problem it reports is `quick_check_failed`; two throws in a row are `integrity_check_threw`. Returns null when all is well.
 */
export async function runIntegrityCheck(db: SqlDatabase, retryAfterMs = RETRY_AFTER_MS): Promise<'quick_check_failed' | 'integrity_check_threw' | null> {
  let verdict = await quickCheckVerdict(db);
  if (verdict === 'threw') {
    await new Promise((r) => setTimeout(r, retryAfterMs));
    verdict = await quickCheckVerdict(db);
  }
  return verdict === 'ok' ? null : verdict === 'failed' ? 'quick_check_failed' : 'integrity_check_threw';
}

/**
 * `PRAGMA quick_check` after start (so the splash is not delayed) and once per local day: when the app comes back and the day has
 * changed. A failure puts the app in safe mode; nothing is written either way. The day counts as checked only once the check has
 * answered, so a check cut short is asked again at the next resume.
 */
export function scheduleIntegrityChecks(
  db: SqlDatabase,
  writer: LedgerWriter,
  log: Logger,
  today: () => string | null,
  onResume: (task: () => void) => () => void,
  retryAfterMs = RETRY_AFTER_MS,
): () => void {
  let lastDay: string | null = null;
  let running = false;
  const run = () => {
    const day = today();
    if (running || day === null || !integrityCheckDue(lastDay, day) || writer.inSafeMode) return;
    running = true;
    void runIntegrityCheck(db, retryAfterMs)
      .then((reason) => {
        lastDay = day;
        if (reason !== null) enterSafeMode(writer, log, reason);
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  return onResume(() => setTimeout(run, 0));
}

/**
 * `Check again` on the safe-mode banner: runs `quick_check` on the open database and, if it now answers `ok`, leaves safe mode
 * without a restart. Returns true when it did. A database that still fails stays in safe mode.
 */
export async function recheckWith(db: SqlDatabase, writer: LedgerWriter, log: Logger, retryAfterMs = RETRY_AFTER_MS): Promise<boolean> {
  const reason = await runIntegrityCheck(db, retryAfterMs);
  if (reason !== null) return false;
  writer.setSafeMode(null);
  useSafeModeStore.getState().setReason(null);
  log.info('safe_mode.cleared');
  return true;
}

/** `recheckWith` on the app's own database and writer. Loaded when needed: the start-up module imports this one. */
export async function recheckSafeMode(): Promise<boolean> {
  const { getLogger, getServices } = await import('./startApp');
  const { db, writer } = getServices();
  return recheckWith(db, writer, await getLogger());
}

export const localToday = (nowMs: number, timezoneId: string): string | null => {
  const d = toLocalDate(nowMs, timezoneId);
  return d.ok ? d.value : null;
};
