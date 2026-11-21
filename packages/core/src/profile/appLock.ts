import type { LockAfter } from './settings';

/** How long the app may stay in the background before it locks. */
export const LOCK_AFTER_MS: Readonly<Record<LockAfter, number>> = {
  immediately: 0,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
};

/**
 * Whether wmbugo must show LockGate (Story 8.3). `awayMs` is the time spent in the background measured on the monotonic
 * elapsed-realtime clock, so changing the phone's clock cannot skip the lock; null means a cold start, which always locks.
 * A negative or non-finite value (a clock that went backwards) locks too: the safe side.
 */
export function shouldLock(input: { readonly enabled: boolean; readonly lockAfter: LockAfter; readonly awayMs: number | null }): boolean {
  if (!input.enabled) return false;
  if (input.awayMs === null) return true;
  if (!Number.isFinite(input.awayMs) || input.awayMs < 0) return true;
  return input.awayMs >= LOCK_AFTER_MS[input.lockAfter];
}

/**
 * Holds one intent (a tapped budget alert or bill reminder, a deep link) while LockGate is showing. After unlock the held
 * intent is delivered once; an abandoned unlock drops it without opening anything. This queue is the single entry point
 * the widget, capture notifications and shares use later (persistent queuing of shares is AD-12, Epic 12).
 */
export interface PendingIntentQueue<T> {
  /** Holds the intent when locked; returns true when it was held, false when the caller should open it now. */
  offer(intent: T, locked: boolean): boolean;
  /** After a successful unlock: the held intent, once, or null. */
  release(): T | null;
  /** Unlock abandoned: drops anything held. */
  drop(): void;
  readonly size: number;
}

export function createPendingIntentQueue<T>(): PendingIntentQueue<T> {
  let held: T | null = null;
  return {
    offer(intent, locked) {
      if (!locked) return false;
      held = intent; // the latest tap wins; an older one is not replayed
      return true;
    },
    release() {
      const out = held;
      held = null;
      return out;
    },
    drop() {
      held = null;
    },
    get size() {
      return held === null ? 0 : 1;
    },
  };
}
