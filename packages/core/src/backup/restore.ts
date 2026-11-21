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
  /**
   * Replaces the file. The adapter writes `<path>.tmp` completely, then moves it over the file; a kill between the two steps can
   * leave only the `.tmp`, which `recoverRestore` reads when it is complete (P1 of the Epic 8 review).
   */
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

export type RestoreBackupError =
  | BackupReadError
  | 'LOW_SPACE_NEEDS_CONFIRMATION'
  /** Even without a safety copy there is no room to stage this backup. Nothing changed. */
  | 'NO_ROOM'
  | 'RESTORE_FAILED'
  /** The failure came after the live database was closed: the data was put back, but wmbugo must be reopened. */
  | 'RESTART_REQUIRED';

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

const JOURNAL_TMP = (l: RestoreLayout) => `${l.journalPath}.tmp`;

function parseJournal(text: string | null): Journal | null {
  if (text === null) return null;
  try {
    const j = JSON.parse(text) as Journal;
    return j.v === 1 && (j.phase === 'swapping' || j.phase === 'swapped') && Array.isArray(j.steps) ? j : null;
  } catch {
    return null;
  }
}

/**
 * The journal, or the newer complete `.tmp` beside it. The adapter writes the temporary file in full and then unlinks the journal
 * and moves the temporary file over it; a kill in between leaves only the `.tmp`. A partly written `.tmp` does not parse, so the
 * older complete journal is used.
 */
async function readJournal(fs: RestoreFs, layout: RestoreLayout): Promise<Journal | null> {
  return parseJournal(await fs.readText(JOURNAL_TMP(layout))) ?? parseJournal(await fs.readText(layout.journalPath));
}

async function dropJournal(fs: RestoreFs, layout: RestoreLayout): Promise<void> {
  await fs.remove(layout.journalPath);
  await fs.remove(JOURNAL_TMP(layout));
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
  // Staging holds the decrypted database, its re-keyed copy and the photos: about twice the archive. The safety copy needs room for
  // the data it replaces, twice over for the rename and the first start.
  const free = await fs.freeBytes();
  const stagingNeed = source.size * 2;
  if (withSafety) {
    const need = (await deps.db.currentDataBytes()) * 2 + stagingNeed;
    if (free < need) return err(free < stagingNeed ? 'NO_ROOM' : 'LOW_SPACE_NEEDS_CONFIRMATION');
  } else if (free < stagingNeed) {
    return err('NO_ROOM');
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
    // An account in the staged data that the manifest does not list is not what was backed up.
    if (checks.balances.size !== manifest.accountBalances.length) return err('BACKUP_DAMAGED');

    swapped = true; // from here a failure is recovered by the journal, not by discarding staging
    await deps.db.prepareForSwap?.();
    await swap(deps, withSafety);
    return ok({ manifest, safetyCopyKept: withSafety });
  } catch {
    if (swapped) {
      // The live database may already be closed, so the writer stays in maintenance. What the swap had moved is put back from the
      // journal; the app must be reopened to open it (never a mixture).
      await recoverRestore(fs, layout, async () => false).catch(() => undefined);
      return err('RESTART_REQUIRED');
    }
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
  | 'restore-failed' // the restored data failed its start checks: the safety copy was put back
  | 'restore-unverified'; // it failed them and there was no safety copy: the restored data stays and cannot be checked

/**
 * Runs at every start, before the database is opened (Story 8.8). It finishes or undoes whatever a killed restore left:
 * - no journal: any staging is discarded and the live data opens as it was;
 * - a swap that was cut short: the safety copy is put back (or, with no safety copy, the swap is completed);
 * - a finished swap: `startChecks` (the database opens, `quick_check` passes, the first query returns) decides. If they pass the
 *   safety copy is deleted; if they fail it is put back and the message reads `The restore didn't finish. Your phone is as it was before.` (with no safety copy: `restore-unverified`, which says the restored data could not be checked)
 */
export async function recoverRestore(fs: RestoreFs, layout: RestoreLayout, startChecks: () => Promise<boolean>): Promise<RecoverOutcome> {
  const journal = await readJournal(fs, layout);
  if (journal === null) {
    const hadStaging = await fs.exists(layout.stagingDir);
    await fs.remove(layout.stagingDir);
    await dropJournal(fs, layout); // a damaged journal, or a partly written temporary one, is dropped
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
    await dropJournal(fs, layout);
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
    await dropJournal(fs, layout);
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
    await dropJournal(fs, layout);
    return 'restored';
  }
  if (journal.withSafety) {
    await restoreFromSafety();
    return 'restore-failed';
  }
  await dropJournal(fs, layout); // no safety copy to go back to: the restored data stays
  return 'restore-unverified';
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

/** The restored data failed its start checks and there was no safety copy to go back to (NFR-12: say what is true). */
export const RESTORE_UNVERIFIED_MESSAGE = "The restored data couldn't be checked, and there was no copy to go back to. Restore again, or open Diagnostics.";
