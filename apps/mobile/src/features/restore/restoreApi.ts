import {
  inspectBackupHeader,
  madeAtLabel,
  readBackupFacts,
  readManifest,
  restoreBackup,
  type BackupManifest,
  type BackupReadError,
  type ByteSource,
  type Result,
  type RestoreBackupError,
} from '@wmbugo/core';
import migrations from '../../../drizzle/migrations';
import { getServices, systemClock } from '../../adapters/startApp';

/** A picked backup file: its bytes, and a way to release it. */
export interface PickedBackup {
  readonly source: ByteSource;
  close(): Promise<void>;
}

export interface ThisPhone {
  readonly entries: number;
  readonly accounts: number;
  readonly photos: number;
}

export interface RestoreApi {
  /** The system file picker (no permission); null when cancelled. */
  pick(): Promise<PickedBackup | null>;
  /** Looks at the header only: is it a wmbugo backup? Needs no passphrase. */
  inspect(source: ByteSource): Promise<Result<{ size: number }, 'NOT_A_WMBUGO_BACKUP' | 'FILE_TOO_LARGE'>>;
  /** Opens the manifest with the passphrase (a preview never extracts the rest). */
  openManifest(source: ByteSource, passphrase: string): Promise<Result<BackupManifest, BackupReadError>>;
  /** What is on this phone now, or null for nothing yet (the Welcome screen). */
  thisPhone(): Promise<ThisPhone | null>;
  /** True when free space is below twice the current data size, so there is no room for the safety copy. */
  lowSpace(): Promise<boolean>;
  /** The restore itself. On success the data on disk is the restored data and `finish` restarts the app. */
  restore(source: ByteSource, passphrase: string, options: { withoutSafetyCopy: boolean }): Promise<Result<{ manifest: BackupManifest }, RestoreBackupError>>;
  /** Remembers what Home says after the restart, then restarts the app. */
  finish(manifest: BackupManifest): Promise<void>;
  /** The profile timezone for `Made 3 Nov 2026, 9:14 pm`. */
  timezoneId(): Promise<string>;
}

const APP_SCHEMA = migrations.journal.entries.length;

export const realRestoreApi: RestoreApi = {
  async pick() {
    const { pickBackupFile } = await import('../../adapters/backup/backupFiles');
    return pickBackupFile();
  },
  inspect: (source) => inspectBackupHeader(source),
  async openManifest(source, passphrase) {
    const { createRnCrypto } = await import('../../adapters/backup/rnCrypto');
    return readManifest(createRnCrypto(), source, passphrase, { appSchemaVersion: APP_SCHEMA });
  },
  async thisPhone() {
    const facts = await readBackupFacts(getServices().db);
    const { entries, accounts, photos } = facts.counts;
    return entries === 0 && accounts === 0 && photos === 0 ? null : { entries, accounts, photos };
  },
  async lowSpace() {
    const { rnRestoreFs, createRnRestoreDb } = await import('../../adapters/backup/rnRestore');
    const need = (await createRnRestoreDb(getServices().db).currentDataBytes()) * 2;
    return (await rnRestoreFs.freeBytes()) < need;
  },
  async restore(source, passphrase, options) {
    const [{ createRnCrypto }, rn] = await Promise.all([import('../../adapters/backup/rnCrypto'), import('../../adapters/backup/rnRestore')]);
    const { db, writer } = getServices();
    const r = await restoreBackup(
      {
        crypto: createRnCrypto(),
        fs: rn.rnRestoreFs,
        layout: rn.RESTORE_LAYOUT,
        db: rn.createRnRestoreDb(db),
        maintenance: { enter: () => writer.setMaintenance(true), exit: () => writer.setMaintenance(false) },
        appSchemaVersion: APP_SCHEMA,
      },
      source,
      passphrase,
      { withoutSafetyCopy: options.withoutSafetyCopy },
    );
    return r.ok ? { ok: true, value: { manifest: r.value.manifest } } : r;
  },
  async finish(manifest) {
    const { rememberRestoreNotice } = await import('../../adapters/backup/restoreNotice');
    const { restartApp } = await import('../../adapters/backup/backupFiles');
    await rememberRestoreNotice(madeAtLabel(manifest.createdAt.utcMs, manifest.createdAt.timezoneId).replace(/ \d{4}.*$/, ''));
    await restartApp();
  },
  async timezoneId() {
    return systemClock.timezoneId();
  },
};
