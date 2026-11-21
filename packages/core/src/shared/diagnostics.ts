import { redactEntry, scrubFrame, scrubText, type LogLevel, type LogValue } from './logger';
import type { CrashRecord } from './crashRecord';

/**
 * The Diagnostics report (Story 8.10, SEC-007, AD-19): a status list, the last redacted log lines and the redacted crash records.
 * It is built as plain text so the person can read exactly what would be saved; the saved bytes are the previewed text. Every log
 * line and crash record is redacted again here, so a file written by an older build cannot carry anything the allowlist forbids.
 */
export interface DiagnosticsStatus {
  /** `1.0.0 (nosms)` */
  readonly app: string | null;
  readonly schemaVersion: number | null;
  /** Bytes of the database file, the photos and the log, and the free space. */
  readonly storage: { readonly dbBytes: number | null; readonly photoBytes: number | null; readonly logBytes: number | null; readonly freeBytes: number | null };
  readonly notifications: 'allowed' | 'denied' | 'not asked' | null;
  readonly biometrics: 'available' | 'not available' | null;
  readonly appLock: boolean | null;
  /** The last backup date as shown in the Data summary (`3 Nov`), `none` for never, or null when unreadable. */
  readonly lastBackup: string | null;
  readonly crashes: { readonly count: number; readonly lastDate: string | null } | null;
  /** `Off`, or the redacted reason. */
  readonly safeMode: string | null;
}

export const NOT_AVAILABLE = 'Not available';
export const LOG_LINES_IN_REPORT = 500;

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** `12.4 MB`, `9.2 GB`: bytes as people read them. */
export function sizeLabel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return NOT_AVAILABLE;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** The status list as lines of `label: value`; a value that could not be read is `Not available`. */
export function statusLines(s: DiagnosticsStatus): string[] {
  const na = (v: string | number | null): string => (v === null ? NOT_AVAILABLE : String(v));
  const storage = s.storage;
  const storageText = [`Entries and settings ${sizeLabel(storage.dbBytes)}`, `Photos ${sizeLabel(storage.photoBytes)}`, `Log ${sizeLabel(storage.logBytes)}`, `Free ${sizeLabel(storage.freeBytes)}`].join(' · ');
  const crashes = s.crashes === null ? NOT_AVAILABLE : s.crashes.count === 0 ? 'None' : `${s.crashes.count} recorded${s.crashes.lastDate ? `, ${s.crashes.lastDate}` : ''}`;
  return [
    `App: ${na(s.app)}`,
    `Database schema: ${na(s.schemaVersion)}`,
    `Storage: ${storageText}`,
    `Permissions: Notifications: ${na(s.notifications)} · Biometrics: ${na(s.biometrics)}`,
    `App lock: ${s.appLock === null ? NOT_AVAILABLE : s.appLock ? 'On' : 'Off'}`,
    `Last backup: ${s.lastBackup === null ? NOT_AVAILABLE : s.lastBackup === 'none' ? 'None yet' : s.lastBackup}`,
    `Crash records: ${crashes}`,
    `Safe mode: ${na(s.safeMode)}`,
  ];
}

/**
 * Redacts one stored log line again: its time and level are kept, its fields go through the allowlist, and a line that is not the
 * expected JSON is scrubbed as text.
 */
export function redactLogLine(line: string): string {
  try {
    const v = JSON.parse(line) as { t?: unknown; level?: unknown; event?: unknown; fields?: unknown };
    if (typeof v !== 'object' || v === null || typeof v.event !== 'string') return scrubText(line);
    const level: LogLevel = v.level === 'debug' || v.level === 'info' || v.level === 'warn' || v.level === 'error' ? v.level : 'info';
    const fields = typeof v.fields === 'object' && v.fields !== null ? (v.fields as Record<string, LogValue>) : {};
    const e = redactEntry(level, v.event, fields);
    return JSON.stringify({ ...(typeof v.t === 'number' ? { t: v.t } : {}), level: e.level, event: e.event, fields: e.fields });
  } catch {
    return scrubText(line);
  }
}

/** One crash record on one line, scrubbed again. */
export function crashLine(r: CrashRecord): string {
  const frames = r.frames.slice(0, 30).map(scrubFrame).join(' | ');
  return JSON.stringify({ t: r.t, kind: scrubText(String(r.kind)), appVersion: scrubText(r.appVersion), schemaVersion: r.schemaVersion, errorType: scrubText(r.errorType), message: scrubText(r.message), frames });
}

export interface DiagnosticsInput {
  readonly status: DiagnosticsStatus;
  /** The log lines oldest first; the report keeps the last 500. */
  readonly logLines: readonly string[];
  /** Newest first. */
  readonly crashes: readonly CrashRecord[];
}

/** The exact text that is previewed and, once the person consents, saved. */
export function buildDiagnosticsText(input: DiagnosticsInput): string {
  const log = input.logLines.slice(-LOG_LINES_IN_REPORT).map(redactLogLine);
  return [
    'wmbugo diagnostics',
    'Nothing below contains entries, amounts, merchants, notes, accounts, SMS text or images.',
    '',
    '== Status ==',
    ...statusLines(input.status),
    '',
    `== Log (last ${LOG_LINES_IN_REPORT} lines, redacted) ==`,
    ...(log.length === 0 ? ['(empty)'] : log),
    '',
    '== Crash records (redacted) ==',
    ...(input.crashes.length === 0 ? ['(none)'] : input.crashes.map(crashLine)),
    '',
  ].join('\n');
}

/** `wmbugo-diagnostics-2026-11-08.txt` */
export function diagnosticsFileName(localDate: string): string {
  return `wmbugo-diagnostics-${localDate}.txt`;
}
