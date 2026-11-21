import type { FileStore } from '../ports/filestore';
import { scrubText, type Logger } from './logger';

export type CrashKind = 'js' | 'promise' | 'native';

/** What a crash record holds: no entry, amount, merchant, note or account, only the fault itself. */
export interface CrashRecord {
  readonly t: number;
  readonly appVersion: string;
  readonly schemaVersion: number | null;
  readonly kind: CrashKind;
  readonly errorType: string;
  /** Scrubbed: digit runs, emails, UPI ids and masked accounts are gone. */
  readonly message: string;
  /** Code locations only (function, file, line, column), so a record can be symbolicated offline. */
  readonly frames: readonly string[];
}

export interface CrashContext {
  readonly now: number;
  readonly appVersion: string;
  readonly schemaVersion: number | null;
}

export const MAX_CRASH_RECORDS = 20;
const MAX_FRAMES = 30;
const MAX_FRAME_LENGTH = 300;
const MAX_MESSAGE_LENGTH = 300;
const FRAME_LINE = /^\s*(?:at\s+\S|\S*@\S)/;

function errorParts(error: unknown): { type: string; message: string; stack: string } {
  if (error instanceof Error) return { type: error.name || 'Error', message: error.message, stack: error.stack ?? '' };
  if (typeof error === 'string') return { type: 'string', message: error, stack: '' };
  return { type: typeof error, message: '', stack: '' };
}

/** Pure: builds the redacted record for one error. */
export function buildCrashRecord(ctx: CrashContext, kind: CrashKind, error: unknown): CrashRecord {
  const { type, message, stack } = errorParts(error);
  const frames = stack
    .split('\n')
    .filter((l) => FRAME_LINE.test(l))
    .slice(0, MAX_FRAMES)
    .map((l) => l.trim().slice(0, MAX_FRAME_LENGTH));
  return {
    t: ctx.now,
    appVersion: ctx.appVersion,
    schemaVersion: ctx.schemaVersion,
    kind,
    errorType: scrubText(type).slice(0, 80),
    message: scrubText(message).slice(0, MAX_MESSAGE_LENGTH),
    frames,
  };
}

export interface CrashRecorderOptions {
  /** App-private directory for the records (never shared or external storage). */
  readonly dir: string;
  readonly context: () => CrashContext;
  readonly logger?: Logger;
  readonly maxRecords?: number;
}

export interface CrashRecorder {
  record(kind: CrashKind, error: unknown): Promise<void>;
  /** Newest first. */
  readAll(): Promise<CrashRecord[]>;
}

/**
 * Writes one record per crash into `dir` through the FileStore, keeping the newest `maxRecords` (20). Nothing is sent
 * anywhere. A failure to write is swallowed: a crash handler must never crash.
 */
export function createCrashRecorder(files: FileStore, options: CrashRecorderOptions): CrashRecorder {
  const max = options.maxRecords ?? MAX_CRASH_RECORDS;
  const nameOf = (t: number, n: number) => `crash-${String(Math.max(0, t)).padStart(15, '0')}-${n}.json`;
  let counter = 0;
  const list = async (): Promise<string[]> => (await files.list(options.dir)).filter((n) => /^crash-\d+-\d+\.json$/.test(n)).sort();
  let chain: Promise<void> = Promise.resolve();
  const write = async (kind: CrashKind, error: unknown): Promise<void> => {
    try {
      const rec = buildCrashRecord(options.context(), kind, error);
      await files.write(`${options.dir}/${nameOf(rec.t, counter++)}`, JSON.stringify(rec));
      const names = await list();
      for (const old of names.slice(0, Math.max(0, names.length - max))) await files.remove(`${options.dir}/${old}`);
      options.logger?.error('crash.recorded', { kind, errorType: rec.errorType });
    } catch {
      /* intentionally ignored */
    }
  };
  return {
    record(kind, error) {
      chain = chain.then(() => write(kind, error));
      return chain;
    },
    async readAll() {
      const out: CrashRecord[] = [];
      for (const n of (await list()).reverse()) {
        try {
          out.push(JSON.parse(await files.read(`${options.dir}/${n}`)) as CrashRecord);
        } catch {
          /* a damaged record is skipped */
        }
      }
      return out;
    },
  };
}
