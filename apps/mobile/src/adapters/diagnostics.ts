import * as RNFS from '@dr.pogodin/react-native-fs';
import { NativeModules } from 'react-native';
import { dayMonthLabel, toLocalDate, buildDiagnosticsText, diagnosticsFileName, utf8Encode, type DiagnosticsStatus } from '@wmbugo/core';
import { availableKind } from './appLock';
import { createTextDocument } from './backup/backupFiles';
import { RESTORE_LAYOUT } from './backup/rnRestore';
import { RECEIPTS_DIR } from './files/receiptFiles';
import { appNotifier } from './notifier';
import { permissionState } from './permissions';
import { getCrashRecorder, getServices, LOG_PATH, systemClock } from './startApp';
import { realSettingsApi } from '../features/settings/settingsApi';
import { useLockStore } from '../shared/state/lockStore';
import { useSafeModeStore } from '../shared/state/safeModeStore';

/** Each probe is tried on its own: what cannot be read is reported as Not available, so Diagnostics works without the database open. */
async function probe<T>(fn: () => Promise<T> | T): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** The size of a file or a directory tree; 0 when it does not exist (nothing there yet is a size of nothing). */
async function sizeOf(path: string): Promise<number> {
  if (!(await RNFS.exists(path))) return 0;
  const s = await RNFS.stat(path);
  if (!s.isDirectory()) return Number(s.size);
  let total = 0;
  for (const f of await RNFS.readDir(path)) total += await sizeOf(f.path);
  return total;
}

/** The database and its write-ahead companions, at the path the rest of the app uses; null when there is no database file. */
async function databaseBytes(): Promise<number | null> {
  if (!(await RNFS.exists(RESTORE_LAYOUT.dbPath))) return null;
  return (await sizeOf(RESTORE_LAYOUT.dbPath)) + (await sizeOf(`${RESTORE_LAYOUT.dbPath}-wal`)) + (await sizeOf(`${RESTORE_LAYOUT.dbPath}-shm`));
}

interface AppInfo {
  versionName: string;
  packageName: string;
}

const dateLabel = (ms: number): string | null => {
  const d = toLocalDate(ms, systemClock.timezoneId());
  return d.ok ? dayMonthLabel(d.value) : null;
};

/** Safe mode as Diagnostics shows it: the reason when the app is in it, the failed start's code when there are no services, else Off. */
async function safeModeStatus(): Promise<string | null> {
  const failure = useSafeModeStore.getState().startFailure;
  try {
    const { writer } = getServices();
    return writer.inSafeMode ? (writer.safeReason ?? 'On') : 'Off';
  } catch {
    return failure; // no services: the code of the failed start, or Not available when there is none
  }
}

export async function readStatus(): Promise<DiagnosticsStatus> {
  const info = await probe(async () => (NativeModules.WmbugoPrivacy as { getAppInfo(): Promise<AppInfo> } | undefined)?.getAppInfo() ?? null);
  const settings = await probe(() => realSettingsApi.load());
  const crashes = await probe(async () => {
    const all = await getCrashRecorder().readAll();
    return { count: all.length, lastDate: all[0] ? dateLabel(all[0].t) : null };
  });
  const notification = appNotifier.available ? await probe(() => permissionState('notifications')) : null;
  const kind = await probe(() => availableKind());
  return {
    app: info ? `${info.versionName} (${info.packageName.endsWith('.sms') ? 'sms' : 'nosms'})` : null,
    schemaVersion: await probe(async () => {
      const n = Number((await getServices().db.query('SELECT COALESCE(MAX(version), 0) FROM schema_migration'))[0]?.[0]);
      if (!Number.isFinite(n)) throw new Error('no schema version'); // reported as Not available, not as NaN
      return n;
    }),
    storage: {
      dbBytes: await probe(() => databaseBytes()),
      photoBytes: await probe(() => sizeOf(RECEIPTS_DIR)),
      logBytes: await probe(async () => (await sizeOf(LOG_PATH)) + (await sizeOf(`${LOG_PATH}.1`))),
      freeBytes: await probe(async () => Number((await RNFS.getFSInfo()).freeSpace)),
    },
    notifications: notification === null ? null : notification === 'granted' ? 'allowed' : notification === 'denied' ? 'denied' : 'not asked',
    biometrics: kind === null ? null : kind === 'none' ? 'not available' : 'available',
    // The app lock flag mirrors the saved setting in memory, so it is known even when the database cannot be read.
    appLock: useLockStore.getState().enabled,
    lastBackup: settings ? (settings.settings.lastBackupAt === null ? 'none' : dateLabel(settings.settings.lastBackupAt)) : null,
    crashes,
    safeMode: await safeModeStatus(),
  };
}

/** The full redacted report text: status, the last 500 log lines, the crash records. This exact text is previewed and saved. */
export async function buildReport(): Promise<string> {
  const status = await readStatus();
  const lines: string[] = [];
  for (const path of [`${LOG_PATH}.1`, LOG_PATH]) {
    const text = await probe(async () => ((await RNFS.exists(path)) ? RNFS.readFile(path, 'utf8') : ''));
    if (text) lines.push(...text.split('\n').filter((l) => l.length > 0));
  }
  const crashes = (await probe(() => getCrashRecorder().readAll())) ?? [];
  return buildDiagnosticsText({ status, logLines: lines, crashes });
}

/** The save dialog with `wmbugo-diagnostics-2026-11-08.txt`; the saved bytes are the previewed text. Cancelling writes nothing. */
export async function saveReport(text: string): Promise<'saved' | 'cancelled' | 'failed'> {
  let doc: Awaited<ReturnType<typeof createTextDocument>> = null;
  try {
    const d = toLocalDate(systemClock.nowMs(), systemClock.timezoneId());
    doc = await createTextDocument(diagnosticsFileName(d.ok ? d.value : 'file'));
    if (doc === null) return 'cancelled';
    const bytes = utf8Encode(text);
    let written = 0;
    for (let i = 0; i < bytes.length; i += 32 * 1024) {
      const piece = bytes.subarray(i, i + 32 * 1024);
      await doc.sink.write(piece);
      written += piece.length;
    }
    // The saved bytes are the previewed text: a short write is a failure, not a file that looks saved.
    if (written !== bytes.length) throw new Error('short write');
    await doc.commit();
    return 'saved';
  } catch {
    await doc?.abort().catch(() => undefined);
    return 'failed';
  }
}
