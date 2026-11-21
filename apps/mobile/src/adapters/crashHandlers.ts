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
}

/**
 * Captures an uncaught JS error and an unhandled promise rejection into a redacted local crash record (Story 8.1).
 * The previous handler still runs afterwards, so the app crashes or shows its dev red box exactly as before; nothing is
 * sent anywhere. Returns false when called a second time, so handlers never stack.
 */
let installed = false;
export function installCrashHandlers(recorder: CrashRecorder, host: CrashHandlerHost = defaultHost()): boolean {
  if (installed) return false;
  installed = true;
  const record = (kind: CrashKind, error: unknown): void => {
    void recorder.record(kind, error).catch(() => undefined);
  };
  const eu = host.errorUtils;
  if (eu) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      record('js', error);
      previous(error, isFatal);
    });
  }
  host.hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, error) => record('promise', error),
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
