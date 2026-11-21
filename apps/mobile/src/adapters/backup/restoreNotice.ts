import * as RNFS from '@dr.pogodin/react-native-fs';
import { PRIVATE_DIR } from '../files/rnFileStore';

const NOTICE_PATH = `${PRIVATE_DIR}/restore-notice.txt`;

/** Remembers which backup was restored (`3 Nov`), so Home can say so after the restart. Read and deleted once. */
export async function rememberRestoreNotice(madeLabel: string): Promise<void> {
  await RNFS.writeFile(NOTICE_PATH, madeLabel, 'utf8');
}

export async function takeRestoreNotice(): Promise<string | null> {
  try {
    if (!(await RNFS.exists(NOTICE_PATH))) return null;
    const text = await RNFS.readFile(NOTICE_PATH, 'utf8');
    await RNFS.unlink(NOTICE_PATH);
    return text.trim() === '' ? null : text.trim();
  } catch {
    return null;
  }
}
