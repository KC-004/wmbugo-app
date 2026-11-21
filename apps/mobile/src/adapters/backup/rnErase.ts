import * as RNFS from '@dr.pogodin/react-native-fs';
import type { EraseDeps, EraseLayout, SqlDatabase } from '@wmbugo/core';
import { RECEIPTS_DIR } from '../files/receiptFiles';
import { PRIVATE_DIR } from '../files/rnFileStore';
import { appNotifier } from '../notifier';
import { deleteDatabaseKey } from '../storage/keychainKeyStore';
import { RESTORE_LAYOUT } from './rnRestore';

/** Everything wmbugo keeps in private storage. Backup and export files the person saved elsewhere are not listed: they are theirs. */
export const ERASE_LAYOUT: EraseLayout = {
  dbPath: RESTORE_LAYOUT.dbPath,
  attachmentsDir: RECEIPTS_DIR,
  stagingDir: RESTORE_LAYOUT.stagingDir,
  safetyDir: RESTORE_LAYOUT.safetyDir,
  journalPath: RESTORE_LAYOUT.journalPath,
  logsDir: `${PRIVATE_DIR}/logs`,
  crashesDir: `${PRIVATE_DIR}/crashes`,
  otherPaths: [
    `${PRIVATE_DIR}/restore-notice.txt`,
    // The safety copies taken before a migration, and decrypted photos kept for viewing.
    `${PRIVATE_DIR}/safety`,
    `${RNFS.CachesDirectoryPath}/wmbugo-view`,
    // Everything else in private storage except the marker, which goes last.
    `${PRIVATE_DIR}/post-capture-fixture`,
  ],
  markerPath: `${PRIVATE_DIR}/erase.marker`,
};

/** The file operations erase needs. `remove` of something absent is not an error: an erase may be run twice. */
export const rnEraseFs: EraseDeps['fs'] = {
  exists: (path) => RNFS.exists(path),
  async remove(path) {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  },
  writeText: (path, text) => RNFS.writeFile(path, text, 'utf8'),
};

/** What runs at a start that finds `erase.marker`: no database is open, so there is nothing to close and no writer to pause. */
export function interruptedEraseDeps(): Omit<EraseDeps, 'maintenance'> {
  return {
    fs: rnEraseFs,
    layout: ERASE_LAYOUT,
    cancelNotifications: async () => {
      if (!appNotifier.available) return; // nothing was ever scheduled
      // A notifier that cannot cancel would leave reminders firing against deleted data: fail the erase instead of reporting success.
      if (!appNotifier.cancelAll) throw new Error('notifier cannot cancel');
      await appNotifier.cancelAll();
    },
    closeDatabase: async () => undefined,
    deleteKey: deleteDatabaseKey,
  };
}

/** The deps for an erase the person confirmed: the open database is closed first, and the writer is held in maintenance mode. */
export function eraseDeps(live: SqlDatabase | null, maintenance: EraseDeps['maintenance']): EraseDeps {
  return { ...interruptedEraseDeps(), closeDatabase: async () => void (await live?.close()), maintenance };
}
