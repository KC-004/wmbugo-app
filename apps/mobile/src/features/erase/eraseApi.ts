import { eraseAllData } from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';

export interface EraseApi {
  /** Erases everything and restarts the app on Welcome. Resolves `failed` if it could not finish (the next start finishes it). */
  erase(): Promise<'ok' | 'failed'>;
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
    await files.restartApp();
    return 'ok';
  },
};
