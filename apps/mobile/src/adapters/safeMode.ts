import {
  classifyStartupFailure,
  integrityCheckDue,
  quickCheckPasses,
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

/**
 * `PRAGMA quick_check` after start (so the splash is not delayed) and once per local day: when the app comes back and the day has
 * changed. A failure puts the app in safe mode; nothing is written either way.
 */
export function scheduleIntegrityChecks(db: SqlDatabase, writer: LedgerWriter, log: Logger, today: () => string | null, onResume: (task: () => void) => () => void): () => void {
  let lastDay: string | null = null;
  const run = () => {
    const day = today();
    if (day === null || !integrityCheckDue(lastDay, day) || writer.inSafeMode) return;
    lastDay = day;
    void quickCheckPasses(db).then((ok) => {
      if (!ok) enterSafeMode(writer, log, 'quick_check_failed');
    });
  };
  return onResume(() => setTimeout(run, 0));
}

export const localToday = (nowMs: number, timezoneId: string): string | null => {
  const d = toLocalDate(nowMs, timezoneId);
  return d.ok ? d.value : null;
};
