import type { Crypto } from '../ports/crypto';
import type { Querier } from '../planning/budgets';
import { err, ok, type Result } from '../shared/result';
import { readBackupFacts } from './facts';
import { toHex } from './format';
import { passphraseHint, suggestedBackupName } from './policy';
import { writeBackup, type BackupEntrySource, type ByteSink } from './writer';

/** The staged database export: a SQLCipher file keyed with the archive key, deleted by `cleanup`. */
export interface StagedDatabase {
  readonly entry: BackupEntrySource;
  cleanup(): Promise<void>;
}

/** The chosen document (Android's save dialog). Nothing is final until `commit`; `abort` deletes the partial file. */
export interface BackupDocument {
  readonly sink: ByteSink;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

/** What a backup needs from the platform. The phone's implementation lives in apps/mobile. */
export interface BackupPlatform {
  /** Exports the live database into a staged database keyed with `archiveKeyHex` (SQLCipher export). Called inside the writer hold. */
  exportDatabase(archiveKeyHex: string): Promise<StagedDatabase>;
  /**
   * The receipt photos as plain streams, never staged on disk. Called inside the writer hold. A photo that is missing or cannot be
   * read is left out (and counted in `photosSkipped`) instead of failing the whole backup. `isCancelled` is polled between photos.
   */
  photos(isCancelled?: () => boolean): Promise<BackupEntrySource[]>;
  /** How many photos the last `photos()` left out. Absent means none were. */
  photosSkipped?(): number;
  /** The system save dialog; null when it is cancelled. */
  createDocument(suggestedName: string): Promise<BackupDocument | null>;
}

export interface RunBackupDeps {
  readonly crypto: Crypto;
  readonly db: Querier;
  readonly platform: BackupPlatform;
  /** Holds new use cases while `fn` runs; held work runs afterwards and nothing is rejected (`LedgerWriter.exclusive`). */
  readonly hold: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly appId: string;
  readonly appVersion: string;
  readonly nowMs: () => number;
  readonly timezoneId: () => string;
  /** Sets `last_backup_at` (use case `RecordBackupMade`). */
  readonly recordBackupMade: (atMs: number) => Promise<void>;
  /** 0 to 1, rising as encrypted bytes are written. */
  readonly onProgress?: (fraction: number) => void;
  /** Polled between chunks; true stops the backup and deletes the partial document. */
  readonly isCancelled?: () => boolean;
  readonly kdf?: { readonly opslimit: number; readonly memlimit: number };
}

export type RunBackupError = 'DOCUMENT_CANCELLED' | 'CANCELLED' | 'BACKUP_FAILED' | 'PASSPHRASE_TOO_WEAK';

export interface BackupDone {
  readonly counts: { readonly entries: number; readonly accounts: number; readonly photos: number };
  readonly bytes: number;
  /** Photos that could not be read and are not in the backup. */
  readonly photosSkipped: number;
  /** False when the file was saved but `last_backup_at` could not be recorded: the backup is good, the summary line is not updated. */
  readonly recorded: boolean;
}

class Cancelled extends Error {}

/**
 * Makes one encrypted backup (Story 8.7, BKP-001): the person picks where it goes, the writer is held while the database is
 * exported so the snapshot is consistent, then only encrypted bytes are written to the chosen document. On any failure, or a
 * cancel, the partial document is deleted and staging is cleaned up; on success `last_backup_at` is recorded.
 */
export async function runBackup(deps: RunBackupDeps, passphrase: string): Promise<Result<BackupDone, RunBackupError>> {
  const { crypto, platform } = deps;
  // The same rule as the screen, enforced here: a weak passphrase never reaches the save dialog.
  if (passphraseHint(passphrase) !== 'strong-enough') return err('PASSPHRASE_TOO_WEAK');
  let doc: BackupDocument | null;
  try {
    doc = await platform.createDocument(suggestedBackupName(deps.nowMs(), deps.timezoneId()));
  } catch {
    return err('BACKUP_FAILED'); // the dialog or the first write failed: the platform removes a document it created
  }
  if (doc === null) return err('DOCUMENT_CANCELLED'); // nothing was written
  let staged: StagedDatabase | null = null;
  let finished = false;
  try {
    // A place is chosen: from here the screen shows progress with Cancel, through the export and the photo pass, not only the write.
    deps.onProgress?.(0);
    const archiveKey = crypto.randomBytes(32);
    const held = await deps.hold(async () => {
      if (deps.isCancelled?.()) throw new Cancelled();
      const facts = await readBackupFacts(deps.db);
      staged = await platform.exportDatabase(toHex(archiveKey));
      if (deps.isCancelled?.()) throw new Cancelled();
      const photos = await platform.photos(deps.isCancelled);
      return { facts, photos, skipped: platform.photosSkipped?.() ?? 0 };
    });
    const entries = [staged!.entry, ...held.photos];
    const total = entries.reduce((n, e) => n + e.size, 0) || 1;
    let written = 0;
    const sink: ByteSink = {
      async write(chunk) {
        if (deps.isCancelled?.()) throw new Cancelled();
        await doc.sink.write(chunk);
        written += chunk.length;
        deps.onProgress?.(Math.min(1, written / (total + 2048)));
      },
    };
    const r = await writeBackup(
      crypto,
      {
        passphrase,
        schemaVersion: held.facts.schemaVersion,
        appId: deps.appId,
        appVersion: deps.appVersion,
        createdAt: { utcMs: deps.nowMs(), timezoneId: deps.timezoneId() },
        counts: { ...held.facts.counts, photos: held.photos.length },
        accountBalances: held.facts.accountBalances,
        archiveKey,
        entries,
        ...(deps.kdf ? { kdf: deps.kdf } : {}),
      },
      sink,
    );
    if (!r.ok) return err(deps.isCancelled?.() ? 'CANCELLED' : 'BACKUP_FAILED');
    await doc.commit();
    finished = true;
    deps.onProgress?.(1);
    // The file is saved and good. Failing to note the time must not turn that into "Couldn't save the backup".
    let recorded = true;
    try {
      await deps.recordBackupMade(deps.nowMs());
    } catch {
      recorded = false;
    }
    return ok({ counts: { ...held.facts.counts, photos: held.photos.length }, bytes: r.value.bytes, photosSkipped: held.skipped, recorded });
  } catch (e) {
    return err(e instanceof Cancelled || deps.isCancelled?.() ? 'CANCELLED' : 'BACKUP_FAILED');
  } finally {
    if (!finished) await doc.abort().catch(() => undefined);
    const s = staged as StagedDatabase | null;
    if (s) await s.cleanup().catch(() => undefined);
  }
}
