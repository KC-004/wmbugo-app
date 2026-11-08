import type { FileStore } from '../ports/filestore';
import type { LogEntry, LogSink } from './logger';

export interface FileLogSinkOptions {
  readonly path: string;
  /** When the file would exceed this many bytes it is rotated to `<path>.1` (one generation kept). */
  readonly maxBytes: number;
  readonly now: () => number;
}

/**
 * Size-capped log file: JSON lines, one generation of rotation, so total disk
 * use stays under 2 x maxBytes. Entries arrive already redacted by the Logger.
 * Write failures are swallowed: logging must never break a save.
 */
export function createFileLogSink(files: FileStore, options: FileLogSinkOptions): LogSink {
  let chain: Promise<void> = Promise.resolve();
  const write = async (entry: LogEntry): Promise<void> => {
    const line = `${JSON.stringify({ t: options.now(), ...entry })}\n`;
    try {
      const size = (await files.exists(options.path)) ? await files.size(options.path) : 0;
      if (size + line.length > options.maxBytes) {
        if (await files.exists(`${options.path}.1`)) await files.remove(`${options.path}.1`);
        if (size > 0) await files.move(options.path, `${options.path}.1`);
      }
      await files.append(options.path, line);
    } catch {
      /* intentionally ignored */
    }
  };
  return {
    write(entry: LogEntry): void {
      chain = chain.then(() => write(entry));
    },
  };
}
