import { createPendingIntentQueue } from '@wmbugo/core';
import { isAppLocked } from './state/lockStore';

/** Where a tapped notification, deep link or (later) widget or share wants to go. */
export interface AppIntent {
  readonly kind: 'open';
  /** A screen name the shell understands, such as `bills`. */
  readonly target: string;
  readonly data?: Readonly<Record<string, string>>;
}

type Handler = (intent: AppIntent) => void;

let handler: Handler | null = null;
export const pendingIntents = createPendingIntentQueue<AppIntent>();

/** The shell registers how an intent is opened. Returns the unregister function. */
export function registerIntentHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/**
 * The single entry point for everything that wants to open a screen from outside the app (Story 8.3). While LockGate is
 * showing the intent is held; after unlock it opens once; an abandoned unlock drops it without opening anything.
 */
export function deliverIntent(intent: AppIntent): void {
  if (pendingIntents.offer(intent, isAppLocked())) return;
  handler?.(intent);
}

/** After a successful unlock: opens what was held. */
export function releasePendingIntent(): void {
  const held = pendingIntents.release();
  if (held) handler?.(held);
}
