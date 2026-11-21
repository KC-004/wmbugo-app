import { authenticate, isDeviceSecure } from '../../adapters/appLock';
import { copy } from '../../shared/copy';
import type { SettingsApi } from '../settings/settingsApi';

export type EnableAppLockResult =
  | { readonly status: 'enabled' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'needs-screen-lock' }
  | { readonly status: 'failed'; readonly message: string };

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
  if (out.result !== 'success') return { status: 'failed', message: out.message };
  const r = await api.setAppLock(true);
  if (!r.ok) return { status: 'failed', message: copy.lock.couldntSave };
  await api.changeSetting('device.hide_in_recents', true);
  return { status: 'enabled' };
}
