import { eraseAllData } from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';

export interface EraseApi {
  /** Erases everything and restarts the app on Welcome. Resolves `failed` if it could not finish (the next start finishes it). */
  erase(): Promise<'ok' | 'failed'>;
}

export const realEraseApi: EraseApi = {
  async erase() {
    const [rn, files] = await Promise.all([import('../../adapters/backup/rnErase'), import('../../adapters/backup/backupFiles')]);
    const { db, writer } = getServices();
    const r = await eraseAllData(rn.eraseDeps(db, { enter: () => writer.setMaintenance(true), exit: () => writer.setMaintenance(false) }));
    if (!r.ok) return 'failed';
    await files.restartApp();
    return 'ok';
  },
};
