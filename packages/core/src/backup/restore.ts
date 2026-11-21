import type { Crypto } from '../ports/crypto';
import { err, ok, type Result } from '../shared/result';
import type { BackupManifest, BackupReadError } from './format';
import { extractBackup, readManifest, type ByteSource, type EntryTarget } from './reader';

/**
 * RestoreBackup (Story 8.8, AD-10, NFR-12): a restore either finishes completely or leaves the phone exactly as it was. The
 * archive is verified into encrypted staging, migrated forward, re-keyed with this device's keys and checked; only then is it
 * swapped in by atomic renames recorded step by step in `restore.journal`, with the data it replaces kept as a safety copy until
 * the next successful start. The file and database work sits behind the ports below, so the whole sequence is tested with fault
 * injection at every step.
 */

/** App-private file operations. `rename` is atomic on one volume; directories are renamed whole. */
export interface RestoreFs {
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  /** A file or a directory with everything inside it; no error when it is absent. */
  remove(path: string): Promise<void>;
  makeDir(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  /** Replaces the file in one step (the adapter writes a temporary file and renames it). */
  writeText(path: string, text: string): Promise<void>;
  freeBytes(): Promise<number>;
}

export interface RestoreLayout {
  /** The live encrypted database file and the live encrypted photo directory. */
  readonly dbPath: string;
  readonly attachmentsDir: string;
  /** Everything a restore builds before the swap lives under `stagingDir`. */
  readonly stagingDir: string;
  /** The staged database once it is migrated and keyed with this device's key, and the staged photos (device-key encrypted). */
  readonly stagingDb: string;
  readonly stagingAttachmentsDir: string;
  /** Where the replaced data waits until the next successful start. */
  readonly safetyDir: string;
  readonly journalPath: string;
}

export interface StagedChecks {
  readonly quickCheckOk: boolean;
  /** The writer's registered invariants pass on the staged data. */
  readonly invariantsOk: boolean;
  /** Each account's balance recomputed from the staged data, in minor units. */
  readonly balances: ReadonlyMap<string, number>;
}

/** What a restore needs from the phone's database and photo storage. */
export interface RestoreDb {
  /** Receives one decrypted entry: `db` goes to a staged file, photos are encrypted with the device file key as they arrive. */
  openEntry(name: string, size: number): Promise<EntryTarget>;
  /** Migrates the staged database forward with the bundled migrations, then re-keys it with this device's key (to `layout.stagingDb`). */
  migrateAndRekey(archiveKeyHex: string): Promise<Result<void, 'BACKUP_TOO_NEW' | 'BACKUP_DAMAGED'>>;
  /** Copies this phone's device settings (app lock, Lock after, hide in recents) from the live database into the staged one. */
  carryDeviceSettings(): Promise<void>;
  verify(): Promise<StagedChecks>;
  /** Size of the live database and photos, for the free-space rule. */
  currentDataBytes(): Promise<number>;
  /** Called right before the swap: the live database is closed so its file can move. From here the app restarts. */
  prepareForSwap?(): Promise<void>;
}

export interface Maintenance {
  enter(): void;
  exit(): void;
}

export interface RestoreDeps {
  readonly crypto: Crypto;
  readonly fs: RestoreFs;
  readonly layout: RestoreLayout;
  readonly db: RestoreDb;
  readonly maintenance: Maintenance;
  /** The newest schema version this app understands. */
  readonly appSchemaVersion: number;
}

export type RestoreBackupError = BackupReadError | 'LOW_SPACE_NEEDS_CONFIRMATION' | 'RESTORE_FAILED';

export interface RestoreDone {
  readonly manifest: BackupManifest;
  /** True when a safety copy of the replaced data was kept until the next successful start. */
  readonly safetyCopyKept: boolean;
}

type Phase = 'swapping' | 'swapped';
interface Journal {
  readonly v: 1;
  readonly phase: Phase;
  readonly withSafety: boolean;
  /** Steps completed so far, in order. */
  readonly steps: readonly Step[];
}
type Step = 'db-to-safety' | 'att-to-safety' | 'db-installed' | 'att-installed';

const SAFETY_DB = (l: RestoreLayout) => `${l.safetyDir}/db`;
const SAFETY_ATT = (l: RestoreLayout) => `${l.safetyDir}/attachments`;

async function writeJournal(deps: RestoreDeps, j: Journal): Promise<void> {
  await deps.fs.writeText(deps.layout.journalPath, JSON.stringify(j));
}

async function readJournal(fs: RestoreFs, layout: RestoreLayout): Promise<Journal | null> {
  const text = await fs.readText(layout.journalPath);
  if (text === null) return null;
  try {
    const j = JSON.parse(text) as Journal;
    return j.v === 1 && (j.phase === 'swapping' || j.phase === 'swapped') && Array.isArray(j.steps) ? j : null;
  } catch {
    return null;
  }
}

async function moveIfPresent(fs: RestoreFs, from: string, to: string): Promise<void> {
  if (await fs.exists(from)) await fs.rename(from, to);
}

/**
 * The swap: the live data moves to the safety copy (unless the person chose to go without one), staging moves into place, each
 * step recorded in the journal after it completes. A crash at any point is recovered by `recoverRestore`.
 */
async function swap(deps: RestoreDeps, withSafety: boolean): Promise<void> {
  const { fs, layout } = deps;
  const steps: Step[] = [];
  const record = async (s: Step) => {
    steps.push(s);
    await writeJournal(deps, { v: 1, phase: 'swapping', withSafety, steps: [...steps] });
  };
  await writeJournal(deps, { v: 1, phase: 'swapping', withSafety, steps: [] });
  if (withSafety) {
    await fs.remove(layout.safetyDir); // a leftover from an earlier restore that never completed its start checks
    await fs.makeDir(layout.safetyDir);
    await moveIfPresent(fs, layout.dbPath, SAFETY_DB(layout));
    await record('db-to-safety');
    await moveIfPresent(fs, layout.attachmentsDir, SAFETY_ATT(layout));
    await record('att-to-safety');
  } else {
    await fs.remove(layout.dbPath);
    await record('db-to-safety');
    await fs.remove(layout.attachmentsDir);
    await record('att-to-safety');
  }
  await fs.rename(layout.stagingDb, layout.dbPath);
  await record('db-installed');
  await moveIfPresent(fs, layout.stagingAttachmentsDir, layout.attachmentsDir);
  await record('att-installed');
  await writeJournal(deps, { v: 1, phase: 'swapped', withSafety, steps: [...steps] });
}

/**
 * Restores a backup (Story 8.8). Wrong passphrase, a damaged or foreign file and a newer schema are refused before any change; a
 * failure while staging, migrating or verifying discards staging and leaves the working data untouched. On success the app must
 * restart: the data on disk is the restored data, and the safety copy waits for the next successful start.
 */
export async function restoreBackup(
  deps: RestoreDeps,
  source: ByteSource,
  passphrase: string,
  options: { readonly withoutSafetyCopy?: boolean } = {},
): Promise<Result<RestoreDone, RestoreBackupError>> {
  const { crypto, fs, layout } = deps;
  const open = { appSchemaVersion: deps.appSchemaVersion };
  const preview = await readManifest(crypto, source, passphrase, open);
  if (!preview.ok) return preview; // nothing has changed

  const withSafety = options.withoutSafetyCopy !== true;
  if (withSafety) {
    const need = (await deps.db.currentDataBytes()) * 2;
    if ((await fs.freeBytes()) < need) return err('LOW_SPACE_NEEDS_CONFIRMATION');
  }

  deps.maintenance.enter();
  let swapped = false;
  try {
    await fs.remove(layout.stagingDir);
    await fs.makeDir(layout.stagingDir);
    const extracted = await extractBackup(crypto, source, passphrase, open, (name, size) => deps.db.openEntry(name, size));
    if (!extracted.ok) return extracted;
    const manifest = extracted.value;

    const migrated = await deps.db.migrateAndRekey(manifest.archiveKey);
    if (!migrated.ok) return err(migrated.code);
    await deps.db.carryDeviceSettings();

    const checks = await deps.db.verify();
    if (!checks.quickCheckOk || !checks.invariantsOk) return err('BACKUP_DAMAGED');
    for (const b of manifest.accountBalances) if (checks.balances.get(b.accountId) !== b.balanceMinor) return err('BACKUP_DAMAGED');

    swapped = true; // from here a failure is recovered by the journal, not by discarding staging
    await deps.db.prepareForSwap?.();
    await swap(deps, withSafety);
    return ok({ manifest, safetyCopyKept: withSafety });
  } catch {
    return err('RESTORE_FAILED');
  } finally {
    if (!swapped) {
      await fs.remove(layout.stagingDir).catch(() => undefined);
      deps.maintenance.exit();
    }
  }
}

export type RecoverOutcome =
  | 'none' // nothing was in progress
  | 'staging-discarded' // died before the swap: the pre-restore data opens intact
  | 'rolled-back' // died during the swap: the safety copy was put back
  | 'rolled-forward' // died during a swap with no safety copy: it was completed
  | 'restored' // the swap finished and the restored data passed the start checks
  | 'restore-failed'; // the restored data failed its start checks: the safety copy was put back

/**
 * Runs at every start, before the database is opened (Story 8.8). It finishes or undoes whatever a killed restore left:
 * - no journal: any staging is discarded and the live data opens as it was;
 * - a swap that was cut short: the safety copy is put back (or, with no safety copy, the swap is completed);
 * - a finished swap: `startChecks` (the database opens, `quick_check` passes, the first query returns) decides. If they pass the
 *   safety copy is deleted; if they fail it is put back and the message reads `The restore didn't finish. Your phone is as it was before.`
 */
export async function recoverRestore(fs: RestoreFs, layout: RestoreLayout, startChecks: () => Promise<boolean>): Promise<RecoverOutcome> {
  const journal = await readJournal(fs, layout);
  if (journal === null) {
    const hadStaging = await fs.exists(layout.stagingDir);
    await fs.remove(layout.stagingDir);
    if (await fs.exists(layout.journalPath)) await fs.remove(layout.journalPath); // a damaged journal is dropped
    return hadStaging ? 'staging-discarded' : 'none';
  }

  // Puts the replaced data back. Only what actually reached the safety copy is replaced: a swap cut short before a step moved the
  // live data leaves that live data alone.
  const restoreFromSafety = async () => {
    if (await fs.exists(SAFETY_DB(layout))) {
      await fs.remove(layout.dbPath);
      await fs.rename(SAFETY_DB(layout), layout.dbPath);
    }
    if (await fs.exists(SAFETY_ATT(layout))) {
      await fs.remove(layout.attachmentsDir);
      await fs.rename(SAFETY_ATT(layout), layout.attachmentsDir);
    } else if (journal.steps.includes('att-to-safety')) {
      await fs.remove(layout.attachmentsDir); // there were no photos before: whatever was installed in their place goes
    }
    await fs.remove(layout.safetyDir);
    await fs.remove(layout.stagingDir);
    await fs.remove(layout.journalPath);
  };

  if (journal.phase === 'swapping') {
    if (journal.withSafety) {
      await restoreFromSafety();
      return 'rolled-back';
    }
    // No safety copy: the old data may already be gone, so the swap is completed from staging. Each step is repeated only if the
    // journal does not show it done.
    const done = new Set<Step>(journal.steps);
    if (!done.has('db-installed') && (await fs.exists(layout.stagingDb))) {
      await fs.remove(layout.dbPath);
      await fs.rename(layout.stagingDb, layout.dbPath);
    }
    if (!done.has('att-installed')) {
      // The photos recorded as removed are gone; otherwise the old ones may still be there and are replaced.
      if (!done.has('att-to-safety')) await fs.remove(layout.attachmentsDir);
      if (await fs.exists(layout.stagingAttachmentsDir)) {
        await fs.remove(layout.attachmentsDir);
        await fs.rename(layout.stagingAttachmentsDir, layout.attachmentsDir);
      }
    }
    await fs.remove(layout.stagingDir);
    await fs.remove(layout.journalPath);
    return 'rolled-forward';
  }

  // swapped: the restored data is in place, waiting for its first successful start.
  const passed = await startChecks().then(
    (v) => v,
    () => false,
  );
  if (passed) {
    await fs.remove(layout.safetyDir);
    await fs.remove(layout.stagingDir);
    await fs.remove(layout.journalPath);
    return 'restored';
  }
  if (journal.withSafety) {
    await restoreFromSafety();
    return 'restore-failed';
  }
  await fs.remove(layout.journalPath); // no safety copy to go back to
  return 'restore-failed';
}

import type { UseCase } from '../writer/ledgerWriter';

/**
 * Run once at the first start after a restore that held: raises `BackupRestored` through the writer, so every query is invalidated
 * and the bill reminders are scheduled again from the restored data (Story 8.8).
 */
export const AnnounceBackupRestored: UseCase<void, void, never> = {
  name: 'AnnounceBackupRestored',
  async execute(ctx) {
    ctx.emit('BackupRestored', { restored: true });
    return ok(undefined);
  },
};

/** The message shown after a restore that did not hold (NFR-12). */
export const RESTORE_REVERTED_MESSAGE = "The restore didn't finish. Your phone is as it was before.";
