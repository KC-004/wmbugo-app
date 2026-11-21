import { authenticate } from '../adapters/appLock';
import { copy } from './copy';
import { isAppLockOn } from './state/lockStore';

/**
 * The shared re-authentication guard for sensitive actions: Delete permanently, turning app lock off, changing Lock after,
 * restore and erase (Story 8.3). It asks `Confirm it's you` only when app lock is on; with app lock off it lets the action
 * through. Every such action calls it after its own confirm sheet and before it writes. Cancelling returns false, and the
 * caller then does nothing and leaves its screen as it was.
 *
 * With app lock on but no screen lock left on the phone (`unavailable`), there is nothing to ask: the action goes through, so the
 * person is not stuck unable to turn app lock off or change Lock after (Epic 8 review, D2). A lockout or an error still says no.
 */
export async function requireReauth(): Promise<boolean> {
  if (!isAppLockOn()) return true;
  const outcome = await authenticate(copy.lock.confirmItsYou);
  return outcome.result === 'success' || outcome.result === 'unavailable';
}
