import { authenticate } from '../adapters/appLock';
import { copy } from './copy';
import { isAppLockOn } from './state/lockStore';

/**
 * The shared re-authentication guard for sensitive actions: Delete permanently, turning app lock off, changing Lock after,
 * restore and erase (Story 8.3). It asks `Confirm it's you` only when app lock is on; with app lock off it lets the action
 * through. Every such action calls it after its own confirm sheet and before it writes. Cancelling returns false, and the
 * caller then does nothing and leaves its screen as it was.
 */
export async function requireReauth(): Promise<boolean> {
  if (!isAppLockOn()) return true;
  const outcome = await authenticate(copy.lock.confirmItsYou);
  return outcome.result === 'success';
}
