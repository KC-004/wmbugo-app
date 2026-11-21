import type { CrashKind, CrashRecorder } from '@wmbugo/core';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

interface HermesLike {
  enablePromiseRejectionTracker?: (options: { allRejections: boolean; onUnhandled: (id: number, error: unknown) => void }) => void;
}

export interface CrashHandlerHost {
  readonly errorUtils?: ErrorUtilsLike | undefined;
  readonly hermes?: HermesLike | undefined;
  /** The clock for the repeat filter (tests set it). */
  readonly now?: (() => number) | undefined;
}

/** How long a fatal error is given to reach the disk before the previous handler is allowed to end the process. */
const FATAL_FLUSH_MS = 1500;
/** The same non-fatal error again within this window is not recorded again. */
const REPEAT_WINDOW_MS = 60_000;

/**
 * Captures an uncaught JS error and an unhandled promise rejection into a redacted local crash record (Story 8.1).
 * The previous handler still runs afterwards, so the app crashes or shows its dev red box exactly as before; nothing is
 * sent anywhere. Returns false when called a second time, so handlers never stack.
 */
let installed = false;
export function installCrashHandlers(recorder: CrashRecorder, host: CrashHandlerHost = defaultHost()): boolean {
  if (installed) return false;
  installed = true;
  const now = host.now ?? (() => Date.now());
  const lastSeen = new Map<string, number>();
  /** True for an error already recorded a moment ago: a loop of the same non-fatal error must not push real crashes out of the 20. */
  const repeated = (error: unknown): boolean => {
    const e = error as { name?: unknown; stack?: unknown } | null;
    const key = `${String(e?.name ?? typeof error)}|${String(e?.stack ?? '').split('\n').slice(0, 2).join('|')}`;
    const t = now();
    const prev = lastSeen.get(key);
    lastSeen.set(key, t);
    if (lastSeen.size > 50) lastSeen.delete(lastSeen.keys().next().value as string);
    return prev !== undefined && t - prev < REPEAT_WINDOW_MS;
  };
  const record = (kind: CrashKind, error: unknown): Promise<void> => recorder.record(kind, error).catch(() => undefined);
  const eu = host.errorUtils;
  if (eu) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      if (isFatal !== true) {
        if (!repeated(error)) void record('js', error);
        previous(error, isFatal);
        return;
      }
      // A fatal error ends the process: the previous handler runs only after the record has been written (or after a short wait,
      // so a stuck disk cannot keep a dying app alive).
      const done = record('js', error);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FATAL_FLUSH_MS);
      });
      void Promise.race([done, wait]).then(() => {
        if (timer !== undefined) clearTimeout(timer);
        previous(error, isFatal);
      });
    });
  }
  host.hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, error) => {
      if (!repeated(error)) void record('promise', error);
    },
  });
  return true;
}

/** Test hook: lets a test install again. */
export function resetCrashHandlersForTest(): void {
  installed = false;
}

function defaultHost(): CrashHandlerHost {
  const g = globalThis as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike };
  return { errorUtils: g.ErrorUtils, hermes: g.HermesInternal };
}
