import { err, ok, type Result } from '../shared/result';
import type { Maintenance, RestoreFs } from './restore';

/**
 * EraseAllData (Story 8.11, SEC-008): removes everything wmbugo keeps on the phone, so the person can leave without a trace. It is
 * restartable: an `erase.marker` is written first and removed last, and a start that finds the marker finishes the erase before
 * anything else and opens Welcome. Backup files saved elsewhere are not touched.
 */
export interface EraseLayout {
  /** The database file (its `-wal` and `-shm` companions go with it) and the encrypted photos. */
  readonly dbPath: string;
  readonly attachmentsDir: string;
  /** Staging, the pre-restore safety copy, the restore journal. */
  readonly stagingDir: string;
  readonly safetyDir: string;
  readonly journalPath: string;
  /** The app log, its rotated file, and the crash records. */
  readonly logsDir: string;
  readonly crashesDir: string;
  /** Anything else wmbugo keeps in private storage (a pending restore notice, safety copies before a migration, caches). */
  readonly otherPaths: readonly string[];
  readonly markerPath: string;
}

export interface EraseDeps {
  readonly fs: Pick<RestoreFs, 'exists' | 'remove' | 'writeText'>;
  readonly layout: EraseLayout;
  readonly maintenance: Maintenance;
  /** Cancels every scheduled and posted notification. */
  readonly cancelNotifications: () => Promise<void>;
  /** Closes the open database so its file can be removed. */
  readonly closeDatabase: () => Promise<void>;
  /** Deletes the Keystore database key. A new key is made only by the next onboarding. */
  readonly deleteKey: () => Promise<void>;
}

export type EraseError = 'ERASE_FAILED';

async function removeAll(deps: EraseDeps): Promise<void> {
  const { fs, layout: l } = deps;
  for (const p of [l.dbPath, `${l.dbPath}-wal`, `${l.dbPath}-shm`, `${l.dbPath}-journal`, l.attachmentsDir, l.stagingDir, l.safetyDir, l.journalPath, l.logsDir, l.crashesDir, ...l.otherPaths]) {
    await fs.remove(p);
  }
}

async function finish(deps: EraseDeps): Promise<void> {
  await deps.cancelNotifications();
  await deps.closeDatabase().catch(() => undefined);
  await removeAll(deps);
  await deps.deleteKey();
  await deps.fs.remove(deps.layout.markerPath); // last: until the key and the files are gone the erase is unfinished
}

/**
 * Erases everything. The writer is held in maintenance mode first; on success it stays so, because the app restarts on Welcome. A
 * failure leaves the marker in place, so the next start finishes the job.
 */
export async function eraseAllData(deps: EraseDeps): Promise<Result<void, EraseError>> {
  deps.maintenance.enter();
  try {
    await deps.fs.writeText(deps.layout.markerPath, 'erase');
    await finish(deps);
    return ok(undefined);
  } catch {
    return err('ERASE_FAILED'); // the marker stays: the next start completes the erase before anything else
  }
}

/** What a start found: no erase in progress, one it finished, or one it could not finish (the marker stays). */
export type InterruptedErase = 'none' | 'finished' | 'failed';

/**
 * Called first at every start, before the database or the key are touched: an erase that was interrupted is finished and the app
 * opens Welcome. A start whose recovery fails must not go on to open the half-erased data: the caller stops with a screen that
 * offers Try again (Epic 8 review, P4).
 */
export async function finishInterruptedErase(deps: Omit<EraseDeps, 'maintenance'>): Promise<InterruptedErase> {
  // null: the file system could not even be asked, which is not the same as "no erase in progress".
  const marker = await deps.fs.exists(deps.layout.markerPath).then(
    (v) => v,
    () => null,
  );
  if (marker === null) return 'failed';
  if (!marker) return 'none';
  try {
    await finish({ ...deps, maintenance: { enter: () => undefined, exit: () => undefined } });
  } catch {
    return 'failed'; // still unfinished: the marker stays and the next start tries again
  }
  return 'finished';
}

/** What the first Erase screen says (Story 8.11). */
export const ERASE_SCOPE_LINES = [
  'This erases from this phone: all entries, accounts, budgets, bills, goals, categories, photos, settings and the app log.',
  "Backup files you saved elsewhere aren't touched. Delete them yourself if you want them gone.",
  "This can't be undone.",
] as const;
