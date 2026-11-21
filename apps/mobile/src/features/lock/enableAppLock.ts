import { authenticate, isDeviceSecure } from '../../adapters/appLock';
import { copy } from '../../shared/copy';
import type { SettingsApi } from '../settings/settingsApi';

export type EnableAppLockResult =
  | { readonly status: 'enabled' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'needs-screen-lock' }
  /** `reason`: the prompt failed (its own message, or a fallback) or the setting could not be saved. The message is never empty. */
  | { readonly status: 'failed'; readonly reason: 'prompt' | 'save'; readonly message: string };

/**
 * Turning app lock on (Story 8.3, reused by the one-time offer in Story 8.4): the phone needs a secure screen lock, the system
 * prompt `Turn on app lock` must succeed, and only then is anything saved (the flag with an audit row; the app-switcher hiding
 * comes on with it). A cancelled prompt saves nothing.
 */
export async function enableAppLock(api: Pick<SettingsApi, 'setAppLock' | 'changeSetting'>): Promise<EnableAppLockResult> {
  if (!(await isDeviceSecure())) return { status: 'needs-screen-lock' };
  const out = await authenticate(copy.lock.turnOnPrompt);
  if (out.result === 'unavailable') return { status: 'needs-screen-lock' };
  if (out.result === 'cancelled') return { status: 'cancelled' };
  if (out.result !== 'success') return { status: 'failed', reason: 'prompt', message: out.message || copy.lock.couldntTurnOn };
  const r = await api.setAppLock(true);
  if (!r.ok) return { status: 'failed', reason: 'save', message: copy.lock.couldntSave };
  // The app switcher is hidden natively while app lock is on whatever this says, so a failed write here changes only the switch.
  await api.changeSetting('device.hide_in_recents', true).catch(() => undefined);
  return { status: 'enabled' };
}
