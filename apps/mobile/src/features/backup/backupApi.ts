import { RecordBackupMade, runBackup, type BackupDone, type Result, type RunBackupError } from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';

/** The app id written into the manifest; a restore accepts `app.wmbugo` and `app.wmbugo.sms` on either package (Story 8.8). */
export const BACKUP_APP_ID = 'app.wmbugo';
/** Matches `versionName` in android/app/build.gradle. */
export const BACKUP_APP_VERSION = '1.0';

export interface BackupApi {
  /** Makes one backup. The system save dialog opens first; cancelling it writes nothing. */
  run(passphrase: string, hooks: { onProgress: (fraction: number) => void; isCancelled: () => boolean }): Promise<Result<BackupDone, RunBackupError>>;
}

export const realBackupApi: BackupApi = {
  async run(passphrase, hooks) {
    // Loaded when a backup starts: the native crypto and file modules are not needed to show any screen.
    const [{ createRnCrypto }, { createRnBackupPlatform }] = await Promise.all([import('../../adapters/backup/rnCrypto'), import('../../adapters/backup/rnBackupPlatform')]);
    const { db, writer } = getServices();
    const crypto = createRnCrypto();
    return runBackup(
      {
        crypto,
        db,
        platform: createRnBackupPlatform(db, crypto),
        hold: (fn) => writer.exclusive(fn),
        appId: BACKUP_APP_ID,
        appVersion: BACKUP_APP_VERSION,
        nowMs: () => systemClock.nowMs(),
        timezoneId: () => systemClock.timezoneId(),
        recordBackupMade: async (atMs) => {
          const r = await writer.run(RecordBackupMade, { atMs }, 'user');
          if (!r.ok) throw new Error('last backup not recorded');
        },
        onProgress: hooks.onProgress,
        isCancelled: hooks.isCancelled,
      },
      passphrase,
    );
  },
};
