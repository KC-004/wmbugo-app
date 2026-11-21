import { eraseAllData } from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';

export interface EraseApi {
  /**
   * Erases everything and restarts the app on Welcome. `failed` if it could not finish (the next start finishes it); `reopen` if
   * everything is erased but the app could not restart itself.
   */
  erase(): Promise<'ok' | 'failed' | 'reopen'>;
}

export const realEraseApi: EraseApi = {
  async erase() {
    const [rn, files] = await Promise.all([import('../../adapters/backup/rnErase'), import('../../adapters/backup/backupFiles')]);
    // In safe mode with an unreadable database there are no services: `Start fresh` still erases the files and the key.
    let s: ReturnType<typeof getServices> | null = null;
    try {
      s = getServices();
    } catch {
      s = null;
    }
    const r = await eraseAllData(rn.eraseDeps(s?.db ?? null, { enter: () => s?.writer.setMaintenance(true), exit: () => s?.writer.setMaintenance(false) }));
    if (!r.ok) return 'failed';
    try {
      await files.restartApp();
    } catch {
      return 'reopen';
    }
    return 'ok';
  },
};
